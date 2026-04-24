/**
* AuxDeviceControl — Abstracción que encapsula la lógica de selección local/cloud.
* Intenta control LAN si está habilitado y hay IP/MAC; si falla, fallback a cloud.
*/

import type { Logger } from 'homebridge';

import { AuxCloudClient, type AuxDevice } from './AuxCloudClient';
import type { DiscoveredDevice } from './broadlink/DeviceDiscovery';
import { buildCommandPayload, decryptPayload } from './broadlink/Protocol';

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
    * Build auth payload for LAN device authentication.
    */
  private buildAuthPayload(): Buffer {
    const payload = Buffer.alloc(0x50, 0);
    for (let i = 0x04; i <= 0x0f; i++) payload[i] = 0x31;
    payload[0x1e] = 0x01;
    payload[0x2d] = 0x01;
    payload[0x30] = 'T'.charCodeAt(0);
    payload[0x31] = 'e'.charCodeAt(0);
    payload[0x32] = 's'.charCodeAt(0);
    payload[0x33] = ' '.charCodeAt(0);
    payload[0x34] = ' '.charCodeAt(0);
    payload[0x35] = '1'.charCodeAt(0);
    return payload;
   }

   /**
    * Parse decrypted LAN response into params map.
    */
  private parseDecryptedState(decrypted: Buffer): Record<string, number> | null {
    if (decrypted.length < 23) return null;
    return {
      pwr:         (decrypted[20] >> 5) & 0x01,
      temp:        (8 + (decrypted[12] >> 3)) * 10,
      ac_vdir:   decrypted[12] & 0x07,
      ac_mode:     (decrypted[17] >> 5) & 0x0f,
      ac_slp:      (decrypted[17] >> 2) & 0x01,
      scrdisp:     (decrypted[22] >> 4) & 0x01,
      mldprf:      (decrypted[22] >> 3) & 0x01,
      ac_health: (decrypted[20] >> 1) & 0x01,
      ac_hdir:   decrypted[12] & 0x07,
      ac_mark:     (decrypted[15] >> 5) & 0x07,
      mute:        (decrypted[16] >> 7) & 0x01,
      turbo:       (decrypted[16] >> 6) & 0x01,
      ac_clean:    (decrypted[20] >> 2) & 0x01,
     };
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
       * Envía comando LAN con retry y two-step auth (auth wait → command send).
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

      const macBuf = Buffer.from(mac.split(':').map((b) => parseInt(b, 16)));

         // PASO 1: Auth — registrar listener ANTES de enviar, esperar 0xe9
      const authResponse = await new Promise<Buffer | null>((resolve) => {
        const timeout = setTimeout(() => resolve(null), 3000);
        socket.socket.on('message', (msg) => {
          if (msg[0x26] === 0xe9) { clearTimeout(timeout); resolve(msg); }
         });
        const authPayload = this.buildAuthPayload();
        const authPacket = this.buildPacket(authPayload, 0x65, macBuf);
        socket.send(authPacket, 0, authPacket.length, 80, ip);
       });

      if (authResponse === null) {
        throw new Error(`LAN auth timeout for ${ip}`);
       }

         // PASO 2: Command send — registrar listener ANTES de enviar, esperar 0xee
      const commandResponse = await new Promise<Buffer | null>((resolve) => {
        const timeout = setTimeout(() => resolve(null), 3000);
        socket.socket.on('message', (msg) => {
          if (msg[0x26] === 0xee) { clearTimeout(timeout); resolve(msg); }
         });
        // Use Protocol.buildCommandPayload (no double-wrap — returns just the 23-byte AC payload)
        const commandPayload = buildCommandPayload(params);
        const cmdPacket = this.buildPacket(commandPayload, 0x6a, macBuf);
        socket.send(cmdPacket, 0, cmdPacket.length, 80, ip);
       });

      if (commandResponse === null) {
        throw new Error(`LAN command timeout for ${ip}`);
       }
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
       * Polls device state via LAN UDP with two-step auth.
       * Returns params map or null on failure.
       */
  async pollLocalState(ip: string, mac: string): Promise<Record<string, number> | null> {
    const { DgramAsPromised } = await import('dgram-as-promised');
    const socket = DgramAsPromised.createSocket('udp4');

    try {
      await socket.bind(0);
      socket.setBroadcast(true);

      const macBuf = Buffer.from(mac.split(':').map((b) => parseInt(b, 16)));

       // PASO 1: Auth — registrar listener ANTES de enviar, esperar 0xe9
      const authResponse = await new Promise<Buffer | null>((resolve) => {
        const timeout = setTimeout(() => resolve(null), 3000);
        socket.socket.on('message', (msg) => {
          if (msg[0x26] === 0xe9) { clearTimeout(timeout); resolve(msg); }
         });
        const authPayload = this.buildAuthPayload();
        const authPacket = this.buildPacket(authPayload, 0x65, macBuf);
        socket.send(authPacket, 0, authPacket.length, 80, ip);
       });

      if (authResponse === null) {
        this.logger?.debug('[LAN] Auth timeout for %s', ip);
        return null;
       }
      this.logger?.debug('[LAN] Auth OK for %s', ip);

       // PASO 2: State query — registrar listener ANTES de enviar, esperar 0xee
      const stateResponse = await new Promise<Buffer | null>((resolve) => {
        const timeout = setTimeout(() => resolve(null), 3000);
        socket.socket.on('message', (msg) => {
          if (msg[0x26] === 0xee && msg.length >= 0x38 + 16) {
            clearTimeout(timeout); resolve(msg);
           }
         });
        const statePayload = Buffer.from('0C00BB0006800000020011012B7E0000', 'hex');
        const statePacket = this.buildPacket(statePayload, 0x6a, macBuf);
        socket.send(statePacket, 0, statePacket.length, 80, ip);
       });

      if (stateResponse === null) {
        this.logger?.debug('[LAN] State query timeout for %s', ip);
        return null;
       }

      const decrypted = decryptPayload(stateResponse);
      this.logger?.debug('[LAN] Decrypted state (%d bytes): %s', decrypted.length, decrypted.toString('hex'));

       // Parse state from decrypted payload
      const params = this.parseDecryptedState(decrypted);
      if (params === null) {
        this.logger?.debug('[LAN] Decrypted payload too short (%d bytes) for %s', decrypted.length, ip);
        return null;
       }

      return params;
       }
    catch (err) {
      this.logger?.debug('[LAN] pollLocalState error: %s', err);
      return null;
       }
      }
}
