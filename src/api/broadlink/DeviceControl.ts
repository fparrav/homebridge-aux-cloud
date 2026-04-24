/**
 * Send Broadlink UDP commands to an AC device over LAN.
 * Based on homebridge-broadlink-heater-cooler (makleso6).
 */

import type { SocketAsPromised } from 'dgram-as-promised';

import {
  BroadlinkCommand,
  buildCommandPayload,
  buildGetStatePacket,
  buildPacket,
} from './Protocol';

export interface DeviceControlOptions {
  timeoutMs?: number;
  retryCount?: number;
}

export class DeviceControl {
  private socket: SocketAsPromised | null = null;
  private connected = false;

  constructor(
    private ip: string,
    private mac: Buffer,
   ) {}

   /**
    * Initialize the UDP socket and connect to the device.
    */
  async connect(): Promise<void> {
    const { DgramAsPromised } = await import('dgram-as-promised');
    this.socket = DgramAsPromised.createSocket('udp4');
    await this.socket.bind(0);
    this.socket.setBroadcast(true);
    this.connected = true;
   }

   /**
    * Close the UDP socket.
    */
  async close(): Promise<void> {
    if (this.socket) {
      await this.socket.close();
      this.socket = null;
      this.connected = false;
      }
   }

   /**
    * Send a command payload to the device.
    */
  async sendCommand(params: Record<string, number>): Promise<void> {
    if (!this.connected || !this.socket) {
      throw new Error('DeviceControl not connected');
      }

    const payload = buildCommandPayload(params);

     // Wrap with 2-byte length prefix + payload + checksum
    const length = payload.length;
    const requestPayload = Buffer.alloc(32, 0);
    requestPayload[0] = length + 2;
    payload.copy(requestPayload, 2);

    const checksum = 0xbeaf;
    requestPayload[length + 2] = (checksum >> 8) & 0xff;
    requestPayload[length + 3] = checksum & 0xff;

    const packet = buildPacket(
      requestPayload,
      BroadlinkCommand.Packet,
      this.mac,
     );

    await this.socket.send(packet, 0, packet.length, 80, this.ip);
   }

   /**
    * Query device state (power, temp, mode, etc).
    * Returns the raw response buffer, or null on timeout/error.
    */
  async getState(): Promise<Buffer | null> {
    if (!this.connected || !this.socket) {
      throw new Error('DeviceControl not connected');
      }

    const statePacket = buildGetStatePacket(this.mac);
    await this.socket.send(statePacket, 0, statePacket.length, 80, this.ip);

    try {
      const result = await this.socket.recv();
      return result?.msg ?? null;
      } catch {
      return null;
      }
   }

   /**
    * Send authentication packet to discover device ID and update key.
    * This is called on connect to authenticate with the device.
    */
  async auth(): Promise<void> {
    if (!this.connected || !this.socket) {
      throw new Error('DeviceControl not connected');
      }

     // Auth payload: 80 bytes with test string
    const payload = Buffer.alloc(0x50, 0);
    payload[0x04] = 0x31;
    payload[0x05] = 0x31;
    payload[0x06] = 0x31;
    payload[0x07] = 0x31;
    payload[0x08] = 0x31;
    payload[0x09] = 0x31;
    payload[0x0a] = 0x31;
    payload[0x0b] = 0x31;
    payload[0x0c] = 0x31;
    payload[0x0d] = 0x31;
    payload[0x0e] = 0x31;
    payload[0x0f] = 0x31;
    payload[0x1e] = 0x01;
    payload[0x2d] = 0x01;
    payload[0x30] = 'T'.charCodeAt(0);
    payload[0x31] = 'e'.charCodeAt(0);
    payload[0x32] = 's'.charCodeAt(0);
    payload[0x33] = ' '.charCodeAt(0);
    payload[0x34] = ' '.charCodeAt(0);
    payload[0x35] = '1'.charCodeAt(0);

    const authPacket = buildPacket(payload, BroadlinkCommand.Auth, this.mac);
    await this.socket.send(authPacket, 0, authPacket.length, 80, this.ip);
   }
}
