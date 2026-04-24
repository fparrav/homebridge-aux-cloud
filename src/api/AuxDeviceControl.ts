/**
 * AuxDeviceControl — Abstracción que encapsula la lógica de selección local/cloud.
 * Intenta control LAN si está habilitado y hay IP/MAC; si falla, fallback a cloud.
 */

import { createSocket } from 'dgram';
import type { Logger } from 'homebridge';

import { AuxCloudClient, type AuxDevice } from './AuxCloudClient';
import type { DiscoveredDevice } from './broadlink/DeviceDiscovery';
import { BroadlinkCommand, buildCommandPayload, buildPacket, decryptPayload, parseAuthResponse } from './broadlink/Protocol';

export interface DeviceMapping {
  endpointId?: string;
  mac?: string;
  ip?: string;
  name?: string;
  controlStrategy?: 'local' | 'cloud';
}

export interface AuxDeviceControlOptions {
  region?: 'eu' | 'usa' | 'cn';
  logger?: Logger;
  commandTimeoutMs?: number;
  commandRetryCount?: number;
  localControlEnabled?: boolean;
  devices?: DeviceMapping[];
  cloudClient?: AuxCloudClient;
}

const LAN_FAILURE_THRESHOLD = 3;

interface LanSession {
  socket: ReturnType<typeof createSocket>;
  key: Buffer;
  id: Buffer;
  count: number;
  authenticated: boolean;
  stateResolvers: Array<(buf: Buffer) => void>;
  authResolver: ((buf: Buffer) => void) | null;
}

export class AuxDeviceControl {
  private client: AuxCloudClient;
  private deviceMappings = new Map<string, DeviceMapping>(); // keyed by normalized MAC
  private discoveredDevices = new Map<string, DiscoveredDevice>(); // keyed by normalized MAC
  private consecutiveFailures = new Map<string, number>();
  private lanSessions = new Map<string, LanSession>();
  private logger?: Logger;

  constructor(options: AuxDeviceControlOptions) {
    this.logger = options.logger;
    this.client = options.cloudClient ?? new AuxCloudClient({
      region: options.region ?? 'eu',
      logger: options.logger,
      requestTimeoutMs: options.commandTimeoutMs ?? 5000,
    });
    this.loadMappings(options.devices ?? []);
  }

  private loadMappings(devices: DeviceMapping[]): void {
    this.deviceMappings.clear();
    for (const device of devices) {
      if (device.mac) {
        // Devices without endpointId are LAN-only: force local strategy
        const controlStrategy = device.controlStrategy ?? (device.endpointId ? undefined : 'local');
        this.deviceMappings.set(device.mac.toLowerCase(), { ...device, controlStrategy });
      }
    }
  }

  getLanOnlyMappings(): Array<DeviceMapping & { mac: string; name: string }> {
    return Array.from(this.deviceMappings.values()).filter(
      (m): m is DeviceMapping & { mac: string; name: string } =>
        Boolean(m.mac && m.name && !m.endpointId),
    );
  }

  registerDiscoveredDevice(device: DiscoveredDevice): void {
    const key = device.mac.toLowerCase();
    if (!this.discoveredDevices.has(key)) {
      this.discoveredDevices.set(key, device);
    }
  }

  /**
   * Obtiene el mapeo IP/MAC para un MAC address.
   * Prioridad: manual (con IP fija) > discovered (IP dinámica).
   */
  public getDeviceMapping(mac: string): { ip: string; mac: string } | null {
    const key = mac.toLowerCase();
    const manual = this.deviceMappings.get(key);
    if (manual?.ip) {
      return { ip: manual.ip, mac: key };
    }
    const discovered = this.discoveredDevices.get(key);
    if (discovered) {
      return { ip: discovered.ip, mac: discovered.mac };
    }
    return null;
  }

  public shouldUseLocalControl(mac: string, globalStrategy?: 'local-first' | 'cloud-only'): boolean {
    const manual = this.deviceMappings.get(mac.toLowerCase());
    if (manual?.controlStrategy === 'cloud') return false;
    if (manual?.controlStrategy === 'local') return true;
    if (globalStrategy === 'cloud-only') return false;
    if (globalStrategy === 'local-first') return true;
    return false;
  }

  /**
   * Incrementa contador de fallos consecutivos para un dispositivo.
   */
  recordFailure(endpointId: string): void {
    const current = this.consecutiveFailures.get(endpointId) ?? 0;
    this.consecutiveFailures.set(endpointId, current + 1);
  }

  /**
   * Reinicia contador de fallos (éxito).
   */
  recordSuccess(endpointId: string): void {
    this.consecutiveFailures.delete(endpointId);
  }

  /**
   * Build auth payload for LAN device authentication.
   * Matches broadlink-aircon-api reference exactly.
   */
  private buildAuthPayload(): Buffer {
    const payload = Buffer.alloc(0x50, 0);
    for (let i = 0x04; i <= 0x12; i++) payload[i] = 0x31;   // 15 bytes (0x04–0x12)
    payload[0x1e] = 0x01;
    payload[0x2d] = 0x01;
    payload[0x30] = 'T'.charCodeAt(0);
    payload[0x31] = 'e'.charCodeAt(0);
    payload[0x32] = 's'.charCodeAt(0);
    payload[0x33] = 't'.charCodeAt(0);
    payload[0x34] = ' '.charCodeAt(0);
    payload[0x35] = ' '.charCodeAt(0);
    payload[0x36] = '1'.charCodeAt(0);
    return payload;
  }

  /**
   * Parse decrypted LAN response into params map.
   */
  private parseDecryptedState(decrypted: Buffer): Record<string, number> | null {
    if (decrypted.length < 23) return null;
    return {
      pwr:          (decrypted[20] >> 5) & 0x01,
      temp:         (8 + (decrypted[12] >> 3)) * 10,
      ac_vdir:   decrypted[12] & 0x07,
      ac_mode:      (decrypted[17] >> 5) & 0x0f,
      ac_slp:       (decrypted[17] >> 2) & 0x01,
      scrdisp:      (decrypted[22] >> 4) & 0x01,
      mldprf:       (decrypted[22] >> 3) & 0x01,
      ac_health: (decrypted[20] >> 1) & 0x01,
      ac_hdir:   decrypted[12] & 0x07,
      ac_mark:      (decrypted[15] >> 5) & 0x07,
      mute:         (decrypted[16] >> 7) & 0x01,
      turbo:        (decrypted[16] >> 6) & 0x01,
      ac_clean:     (decrypted[20] >> 2) & 0x01,
    };
  }

  private createLanSocket(): ReturnType<typeof createSocket> {
    return createSocket('udp4');
  }

  private bindSocket(socket: ReturnType<typeof createSocket>): Promise<void> {
    return new Promise((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(0, () => { socket.removeListener('error', reject); resolve(); });
    });
  }

  private sendPacket(socket: ReturnType<typeof createSocket>, pkt: Buffer, ip: string): void {
    socket.send(pkt, 0, pkt.length, 80, ip);
  }

  private async getOrCreateSession(ip: string, mac: string): Promise<LanSession> {
    const key = mac.toLowerCase();
    let session = this.lanSessions.get(key);
    if (session && session.authenticated) return session;
    if (session) {
      try { session.socket.close(); } catch { /* ignore */ }
    }

    const socket = this.createLanSocket();
    await this.bindSocket(socket);
    socket.setBroadcast(true);

    const newSession: LanSession = {
      socket,
      key: Buffer.from([0x09, 0x76, 0x28, 0x34, 0x3f, 0xe9, 0x9e, 0x23, 0x76, 0x5c, 0x15, 0x13, 0xac, 0xcf, 0x8b, 0x02]),
      id: Buffer.alloc(4, 0),
      count: 1,
      authenticated: false,
      stateResolvers: [],
      authResolver: null,
    };

    // Register persistent listener for this session
    const onMessage = (msg: Buffer) => {
      const cmd = msg[0x26];
      if (cmd === 0xe9) {
        // auth response
        if (newSession.authResolver) {
          const resolver = newSession.authResolver;
          newSession.authResolver = null;
          resolver(msg);
        }
      } else if (cmd === 0xee && msg.length > 0x38) {
        // state response — dispatch to first waiting resolver
        const resolver = newSession.stateResolvers.shift();
        if (resolver) resolver(msg);
      }
    };

    socket.on('message', onMessage);
    socket.on('error', () => {
      newSession.authenticated = false;
    });

    await this.doSessionAuth(newSession, ip, Buffer.from(mac.split(':').map((b) => parseInt(b, 16))));

    this.lanSessions.set(key, newSession);
    return newSession;
  }

  /**
   * Perform auth handshake on a persistent session.
   * Uses default key for auth; device responds with session key.
   */
  private async doSessionAuth(session: LanSession, ip: string, macBuf: Buffer): Promise<void> {
    const authMsg = await new Promise<Buffer | null>((resolve) => {
      const timeout = setTimeout(() => resolve(null), 5000);
      session.authResolver = (msg) => { clearTimeout(timeout); resolve(msg); };
      const authPayload = this.buildAuthPayload();
      const authPacket = buildPacket(authPayload, BroadlinkCommand.Auth, macBuf, Buffer.alloc(4, 0), session.count++);
      session.socket.send(authPacket, 0, authPacket.length, 80, ip);
    });

    if (authMsg === null) throw new Error(`LAN auth timeout for ${ip}`);
    this.logger?.debug('[LAN] Auth OK for %s', ip);

    const auth = parseAuthResponse(authMsg);
    if (auth) {
      session.key = auth.key;
      session.id = auth.id;
    }
    session.authenticated = true;
  }

  /**
   * Envía comando LAN con session persistente.
   */
  private async sendLocalCommand(
    ip: string,
    mac: string,
    params: Record<string, number>,
  ): Promise<void> {
    const session = await this.getOrCreateSession(ip, mac);

    const normalizedParams = { ...params };
    if (normalizedParams['temp'] !== undefined && normalizedParams['temp'] > 100) {
      normalizedParams['temp'] = normalizedParams['temp'] / 10;
    }
    const macBuf = Buffer.from(mac.split(':').map((b) => parseInt(b, 16)));
    const commandPayload = buildCommandPayload(normalizedParams);
    const cmdPacket = buildPacket(commandPayload, BroadlinkCommand.Packet, macBuf, session.id, session.count++, session.key);
    session.socket.send(cmdPacket, 0, cmdPacket.length, 80, ip);
    // fire-and-forget, no response expected
  }

  /**
   * Envía comando cloud con retry.
   */
  private async sendCloudCommand(
    device: AuxDevice,
    params: Record<string, number>,
    retryCount: number = 2,
  ): Promise<void> {
    const attempts = retryCount + 1;

    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        await this.client.setDeviceParams(device, params);
        return;
      } catch (error) {
        if (attempt < retryCount) {
          const delayMs = Math.min(500 * Math.pow(2, attempt), 3000);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }

    const message = `Failed to control ${device.endpointId} after ${attempts} cloud attempts`;
    throw new Error(message);
  }

  async sendCommand(
    device: AuxDevice,
    params: Record<string, number>,
    options?: {
      globalStrategy?: 'local-first' | 'cloud-only';
      localRetryCount?: number;
      cloudRetryCount?: number;
    },
  ): Promise<void> {
    const endpointId = device.endpointId;
    const mac = device.mac?.toLowerCase();
    const useLocal = mac ? this.shouldUseLocalControl(mac, options?.globalStrategy) : false;

    if (!useLocal) {
      await this.sendCloudCommand(device, params, options?.cloudRetryCount ?? 2);
      this.recordSuccess(endpointId);
      return;
    }

    const mapping = mac ? this.getDeviceMapping(mac) : null;
    if (mapping) {
      const deviceStrategy = mac ? this.deviceMappings.get(mac)?.controlStrategy : undefined;
      try {
        await this.sendLocalCommand(mapping.ip, mapping.mac, params);
        this.recordSuccess(endpointId);
        return;
      } catch {
        this.recordFailure(endpointId);
        const failures = this.consecutiveFailures.get(endpointId) ?? 0;
        if (deviceStrategy === 'local') {
          throw new Error(`LAN command failed for ${endpointId} (device is local-only, no cloud fallback)`);
        }
        if (failures < LAN_FAILURE_THRESHOLD) {
          throw new Error(`LAN command failed for ${endpointId} (attempt ${failures}/${LAN_FAILURE_THRESHOLD})`);
        }
        this.logger?.debug('LAN failed %d times for %s, falling back to cloud', failures, endpointId);
        await this.sendCloudCommand(device, params, options?.cloudRetryCount ?? 2);
        this.recordSuccess(endpointId);
        return;
      }
    }

    // Sin mapping LAN → cloud
    await this.sendCloudCommand(device, params, options?.cloudRetryCount ?? 2);
    this.recordSuccess(endpointId);
  }

  /**
   * Polls device state via LAN UDP with persistent session.
   * Returns params map or null on failure.
   */
  async pollLocalState(ip: string, mac: string): Promise<Record<string, number> | null> {
    let session: LanSession;
    try {
      session = await this.getOrCreateSession(ip, mac);
    } catch {
      this.logger?.debug('[LAN] Auth failed for %s', ip);
      return null;
    }

    const stateResponse = await new Promise<Buffer | null>((resolve) => {
      const timeout = setTimeout(() => resolve(null), 5000);
      session.stateResolvers.push((msg) => { clearTimeout(timeout); resolve(msg); });
      const macBuf = Buffer.from(mac.split(':').map((b) => parseInt(b, 16)));
      const statePayload = Buffer.from('0C00BB0006800000020011012B7E0000', 'hex');
      const statePacket = buildPacket(statePayload, BroadlinkCommand.Packet, macBuf, session.id, session.count++, session.key);
      session.socket.send(statePacket, 0, statePacket.length, 80, ip);
    });

    if (stateResponse === null) {
      session.authenticated = false;
      return null;
    }

    const decrypted = decryptPayload(stateResponse, session.key);
    this.logger?.debug('[LAN] Decrypted state (%d bytes): %s', decrypted.length, decrypted.toString('hex'));

    const params = this.parseDecryptedState(decrypted);
    if (params === null) {
      this.logger?.debug('[LAN] Decrypted payload too short (%d bytes) for %s', decrypted.length, ip);
      return null;
    }
    return params;
  }
}
