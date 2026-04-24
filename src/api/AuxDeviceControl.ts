/**
 * AuxDeviceControl — Abstracción que encapsula la lógica de selección local/cloud.
 * Intenta control LAN si está habilitado y hay IP/MAC; si falla, fallback a cloud.
 */

import type { Logger } from 'homebridge';

import { AuxCloudClient, type AuxDevice } from './AuxCloudClient';
import type { DiscoveredDevice } from './broadlink/DeviceDiscovery';

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
}

const LAN_FAILURE_THRESHOLD = 3;

export class AuxDeviceControl {
  private client: AuxCloudClient;
  private deviceMappings = new Map<string, DeviceMapping>(); // keyed by normalized MAC
  private discoveredDevices = new Map<string, DiscoveredDevice>(); // keyed by normalized MAC
  private consecutiveFailures = new Map<string, number>();
  private logger?: Logger;

  constructor(options: AuxDeviceControlOptions) {
    this.logger = options.logger;
    this.client = new AuxCloudClient({
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
      * Envía comando LAN con retry.
      */
  private async sendLocalCommand(
    ip: string,
    mac: string,
    params: Record<string, number>,
  ): Promise<void> {
    const { DgramAsPromised } = await import('dgram-as-promised');
    const socket = DgramAsPromised.createSocket('udp4');

    try {
      await socket.bind(0);
      socket.setBroadcast(true);

        // Auth first
      const authPayload = Buffer.alloc(0x50, 0);
      authPayload[0x04] = 0x31;
      authPayload[0x05] = 0x31;
      authPayload[0x06] = 0x31;
      authPayload[0x07] = 0x31;
      authPayload[0x08] = 0x31;
      authPayload[0x09] = 0x31;
      authPayload[0x0a] = 0x31;
      authPayload[0x0b] = 0x31;
      authPayload[0x0c] = 0x31;
      authPayload[0x0d] = 0x31;
      authPayload[0x0e] = 0x31;
      authPayload[0x0f] = 0x31;
      authPayload[0x1e] = 0x01;
      authPayload[0x2d] = 0x01;
      authPayload[0x30] = 'T'.charCodeAt(0);
      authPayload[0x31] = 'e'.charCodeAt(0);
      authPayload[0x32] = 's'.charCodeAt(0);
      authPayload[0x33] = ' '.charCodeAt(0);
      authPayload[0x34] = ' '.charCodeAt(0);
      authPayload[0x35] = '1'.charCodeAt(0);

      const macBuf = Buffer.from(mac.split(':').map((b) => parseInt(b, 16)));
      const authPacket = this.buildPacket(authPayload, 0x65, macBuf);
      await socket.send(authPacket, 0, authPacket.length, 80, ip);

        // Send command
      const commandPayload = this.buildCommandPayload(params);
      const cmdLength = commandPayload.length;
      const requestPayload = Buffer.alloc(32, 0);
      requestPayload[0] = cmdLength + 2;
      commandPayload.copy(requestPayload, 2);

      const checksum = 0xbeaf;
      requestPayload[cmdLength + 2] = (checksum >> 8) & 0xff;
      requestPayload[cmdLength + 3] = checksum & 0xff;

      const commandPacket = this.buildPacket(requestPayload, 0x6a, macBuf);
      await socket.send(commandPacket, 0, commandPacket.length, 80, ip);
        } finally {
      await socket.close();
        }
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
      * Helper: build Broadlink packet wrapper.
      */
  private buildPacket(payload: Buffer, command: number, mac: Buffer, id: Buffer = Buffer.alloc(4, 0)): Buffer {
    const count = Buffer.alloc(2, 0);

    const packet = Buffer.alloc(0x38 + payload.length, 0);

     // Header
     Buffer.from([
       0x5a, 0xa5, 0xaa, 0x55,
       0x5a, 0xa5, 0xaa, 0x55,
      ]).copy(packet, 0);

     // Checksum
    let chksum = 0xbeaf;
    for (let i = 0; i < payload.length; i++) {
      chksum = (chksum + payload[i]) & 0xffff;
     }
    packet[0x20] = chksum & 0xff;
    packet[0x21] = (chksum >> 8) & 0xff;

     // Command
    packet[0x26] = command;

     // Count
    packet[0x28] = count[0];
    packet[0x29] = count[1];

     // MAC
    mac.copy(packet, 0x2a, 0, 6);

     // ID
    id.copy(packet, 0x30, 0, 4);

     // Payload
    payload.copy(packet, 0x38);

     // Outer checksum
    let outerChksum = 0xbeaf;
    for (let i = 0; i < packet.length; i++) {
      outerChksum = (outerChksum + packet[i]) & 0xffff;
     }
    packet[0x20] = outerChksum & 0xff;
    packet[0x21] = (outerChksum >> 8) & 0xff;

    return packet;
    }

     /**
      * Helper: build AC command payload.
      */
  private buildCommandPayload(params: Record<string, number>): Buffer {
    const power = params['pwr'] ?? 0;
    // params['temp'] is stored ×10 (e.g. 240 = 24°C); LAN protocol expects raw degrees
    const rawTemp = params['temp'] ?? 240;
    const temp = rawTemp > 100 ? rawTemp / 10 : rawTemp;
    const mode = params['ac_mode'] ?? 0;
    const fanspeed = params['ac_mark'] ?? 0;
    const verticalFixation = params['ac_vdir'] ?? 0;
    const horizontalFixation = params['ac_hdir'] ?? 0;
    const turbo = params['turbo'] ?? 0;
    const mute = params['mute'] ?? 0;
    const health = params['ac_health'] ?? 0;
    const clean = params['ac_clean'] ?? 0;
    const display = params['scrdisp'] ?? 0;
    const mildew = params['mldprf'] ?? 0;

    const temperature = Math.max(0, temp - 8);
    const hasHalfDegree = !Number.isInteger(temp);

    const payload = Buffer.alloc(23, 0);
    payload[0] = 0xbb;
    payload[1] = 0x00;
    payload[2] = 0x06;
    payload[3] = 0x80;
    payload[4] = 0x00;
    payload[5] = 0x00;
    payload[6] = 0x0f;
    payload[7] = 0x00;
    payload[8] = 0x01;
    payload[9] = 0x01;
    payload[10] = (temperature << 3) | (verticalFixation & 0x07);
    payload[11] = (horizontalFixation & 0x07) << 5;
    payload[12] = hasHalfDegree ? 0x80 : 0x00;
    payload[13] = (fanspeed & 0x07) << 5;
    payload[14] = (turbo & 0x01) << 6 | (mute & 0x01) << 7;
    payload[15] = (mode & 0x0f) << 5 | (params['ac_slp'] ?? 0) << 2;
    payload[18] = (power & 0x01) << 5 | (health & 0x01) << 1 | (clean & 0x01) << 2;
    payload[20] = (display & 0x01) << 4 | (mildew & 0x01) << 3;

    const length = payload.length;
    const requestPayload = Buffer.alloc(32, 0);
    requestPayload[0] = length + 2;
    payload.copy(requestPayload, 2);

    const checksum = 0xbeaf;
    requestPayload[length + 2] = (checksum >> 8) & 0xff;
    requestPayload[length + 3] = checksum & 0xff;


    return requestPayload;
  }

      /**
       * Polls device state via LAN UDP.
       * Returns params map or null on failure.
       */
  async pollLocalState(ip: string, mac: string): Promise<Record<string, number> | null> {
    const { DgramAsPromised } = await import('dgram-as-promised');
    const socket = DgramAsPromised.createSocket('udp4');

    try {
      await socket.bind(0);
      socket.setBroadcast(true);

        // Auth first
      const authPayload = Buffer.alloc(0x50, 0);
      authPayload[0x04] = 0x31;
      authPayload[0x05] = 0x31;
      authPayload[0x06] = 0x31;
      authPayload[0x07] = 0x31;
      authPayload[0x08] = 0x31;
      authPayload[0x09] = 0x31;
      authPayload[0x0a] = 0x31;
      authPayload[0x0b] = 0x31;
      authPayload[0x0c] = 0x31;
      authPayload[0x0d] = 0x31;
      authPayload[0x0e] = 0x31;
      authPayload[0x0f] = 0x31;
      authPayload[0x1e] = 0x01;
      authPayload[0x2d] = 0x01;
      authPayload[0x30] = 'T'.charCodeAt(0);
      authPayload[0x31] = 'e'.charCodeAt(0);
      authPayload[0x32] = 's'.charCodeAt(0);
      authPayload[0x33] = ' '.charCodeAt(0);
      authPayload[0x34] = ' '.charCodeAt(0);
      authPayload[0x35] = '1'.charCodeAt(0);

      const macBuf = Buffer.from(mac.split(':').map((b) => parseInt(b, 16)));
      const authPacket = this.buildPacket(authPayload, 0x65, macBuf);
      await socket.send(authPacket, 0, authPacket.length, 80, ip);

        // Send getState
      const statePayload = Buffer.from('0C00BB0006800000020011012B7E0000', 'hex');
      const statePacket = this.buildPacket(statePayload, 0x6a, macBuf);
      await socket.send(statePacket, 0, statePacket.length, 80, ip);

        // Listen for response (raw packet = 0x38 header + encrypted payload, min 88 bytes for state)
      const response = await new Promise<Buffer | null>((resolve) => {
        const timeoutId = setTimeout(() => resolve(null), 3000);
        socket.socket.on('message', (msg) => {
          const command = msg[0x26];
          if (command === 0xee && msg.length >= 0x38 + 16) {
            clearTimeout(timeoutId);
            resolve(msg);
            }
          });
        });

      if (response == null) {
        return null;
        }

        // Decrypt payload (AES-128-CBC with default Broadlink key/IV)
      const { decryptPayload } = await import('./broadlink/Protocol');
      const decrypted = decryptPayload(response);

        // Parse state from decrypted payload (same offsets as Protocol.ts parseStatePayload)
      const params: Record<string, number> = {};
      params['pwr'] = (decrypted[20] >> 5) & 0x01;
      params['temp'] = (8 + (decrypted[12] >> 3)) * 10;  // ×10 to match AUX Cloud format
      params['ac_vdir'] = decrypted[12] & 0x07;
      params['ac_mode'] = (decrypted[17] >> 5) & 0x0f;
      params['ac_slp'] = (decrypted[17] >> 2) & 0x01;
      params['scrdisp'] = (decrypted[22] >> 4) & 0x01;
      params['mldprf'] = (decrypted[22] >> 3) & 0x01;
      params['ac_health'] = (decrypted[20] >> 1) & 0x01;
      params['ac_hdir'] = decrypted[12] & 0x07;
      params['ac_mark'] = (decrypted[15] >> 5) & 0x07;
      params['mute'] = (decrypted[16] >> 7) & 0x01;
      params['turbo'] = (decrypted[16] >> 6) & 0x01;
      params['ac_clean'] = (decrypted[20] >> 2) & 0x01;
      return params;
      }
    catch {
      return null;
      }
     }
}
