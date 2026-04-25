/**
 * Broadlink LAN protocol helpers based on homebridge-broadlink-heater-cooler
 * (makleso6). AES-128-CBC with fixed key/IV for older firmware AC devices.
 */

import { createCipheriv, createDecipheriv } from 'crypto';

// Default AES key and IV for Broadlink devices (older firmware)
const DEFAULT_KEY = Buffer.from([
  0x09, 0x76, 0x28, 0x34, 0x3f, 0xe9, 0x9e, 0x23,
  0x76, 0x5c, 0x15, 0x13, 0xac, 0xcf, 0x8b, 0x02,
]);

const DEFAULT_IV = Buffer.from([
  0x56, 0x2e, 0x17, 0x99, 0x6d, 0x09, 0x3d, 0x28,  // byte 3: 0x99 (not 0x09)
  0xdd, 0xb3, 0xba, 0x69, 0x5a, 0x2e, 0x6f, 0x58,
]);

export enum BroadlinkCommand {
  Auth = 0x65,
  Packet = 0x6a,
  // Responses
  ResponseFixation = 0xe9,
  ResponseState = 0xee,
}

export enum BroadlinkPower {
  Off = 0,
  On = 1,
}

export enum BroadlinkMode {
  Cooling = 0,
  Heating = 1,
  Dry = 2,
  Fan = 3,
  Auto = 4,
}

export enum BroadlinkFanSpeed {
  Auto = 0,
  Low = 1,
  Medium = 2,
  High = 3,
  Turbo = 4,
  Mute = 5,
}

export interface BroadlinkAState {
  power: BroadlinkPower;
  temp: number;
  mode: BroadlinkMode;
  fanspeed: BroadlinkFanSpeed;
  verticalFixation: number;
  horizontalFixation: number;
  turbo: number;
  mute: number;
  health: number;
  clean: number;
  display: number;
  mildew: number;
  sleep: number;
  ambientTemp?: number;
}

// Packet header magic bytes
const HEADER_MAGIC = Buffer.from([
  0x5a, 0xa5, 0xaa, 0x55,
  0x5a, 0xa5, 0xaa, 0x55,
]);

/**
 * Calculate 16-bit checksum (byte sum starting from 0xbeaf, wrapped to 16 bits).
 * This is what the device firmware expects for both inner payload and outer packet checksums.
 */
export function calculateChecksum(data: Buffer): number {
  let sum = 0xbeaf;
  for (let i = 0; i < data.length; i++) {
    sum = (sum + data[i]) & 0xffff;
  }
  return sum;
}

/**
 * Encrypt payload with AES-128-CBC (zero padding, no auto padding).
 */
export function encryptPayload(payload: Buffer): Buffer {
  const cipher = createCipheriv('aes-128-cbc', DEFAULT_KEY, DEFAULT_IV);
  cipher.setAutoPadding(false);
  const encrypted = cipher.update(payload);
  const final = cipher.final();
  return final.length > 0 ? Buffer.concat([encrypted, final]) : encrypted;
}

/**
 * Decrypt response from device.
 * Accepts optional device-specific key obtained from auth response.
 */
export function decryptPayload(response: Buffer, key: Buffer = DEFAULT_KEY): Buffer {
  const encPayload = response.subarray(0x38);
  if (encPayload.length === 0) return Buffer.alloc(0);
  const decipher = createDecipheriv('aes-128-cbc', key, DEFAULT_IV);
  decipher.setAutoPadding(false);
  const payload = decipher.update(encPayload);
  const final = decipher.final();
  return final.length > 0 ? Buffer.concat([payload, final]) : payload;
}

/**
 * Parse auth response (0xe9) to extract device-specific key and ID.
 * Returns null if response has no payload (some devices omit key exchange).
 */
export interface AuthResult {
  key: Buffer;
  id: Buffer;
}

export function parseAuthResponse(response: Buffer): AuthResult | null {
  const payload = decryptPayload(response, DEFAULT_KEY);
  if (payload.length < 0x14) return null;
  const key = Buffer.alloc(0x10, 0);
  payload.copy(key, 0, 0x04, 0x14);
  const id = Buffer.alloc(4, 0);
  payload.copy(id, 0, 0x00, 0x04);
  return { key, id };
}

/**
 * Build a Broadlink UDP packet wrapper.
 * Payload is encrypted with AES-128-CBC using the provided key (default key for auth).
 * Format matches broadlink-aircon-api reference implementation exactly.
 */
export function buildPacket(
  payload: Buffer,
  command: BroadlinkCommand,
  mac: Buffer,
  id: Buffer = Buffer.alloc(4, 0),
  count: number = 1,
  key: Buffer = DEFAULT_KEY,
): Buffer {
  const header = Buffer.alloc(0x38, 0);

  // Header magic
  HEADER_MAGIC.copy(header, 0);

  // Required fields (0x24-0x25) — present in reference implementation
  header[0x24] = 0x2a;
  header[0x25] = 0x27;

  // Command type
  header[0x26] = command;

  // Packet count
  header[0x28] = count & 0xff;
  header[0x29] = (count >> 8) & 0xff;

  // MAC address
  mac.copy(header, 0x2a, 0, 6);

  // Device ID
  id.copy(header, 0x30, 0, 4);

  // Inner checksum of plaintext payload (stored before encryption, at 0x34-0x35)
  const innerChk = calculateChecksum(payload);
  header[0x34] = innerChk & 0xff;
  header[0x35] = (innerChk >> 8) & 0xff;

  // Encrypt payload with AES-128-CBC (cipher.update only — avoids unwanted PKCS#7 padding block)
  const cipher = createCipheriv('aes-128-cbc', key, DEFAULT_IV);
  const encryptedPayload = cipher.update(payload);

  const packet = Buffer.concat([header, encryptedPayload]);

  // Outer checksum over the entire packet (byte sum from 0xbeaf, little-endian)
  const outerChk = calculateChecksum(packet);
  packet[0x20] = outerChk & 0xff;
  packet[0x21] = (outerChk >> 8) & 0xff;

  return packet;
}

/**
 * Build a command payload for AC control (power, temp, mode, fan, swing, etc).
 * Based on the updateModel method from broadlink-aircon-api.
 */
export function buildCommandPayload(
  params: Record<string, number>,
): Buffer {
  const power = params['pwr'] ?? 0;
  const temp = params['temp'] ?? 24;
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

  // Temperature encoding: actual temp - 8, stored in bits 3-7
  let temperature = temp - 8;
  if (temperature < 0) temperature = 0;
  const hasHalfDegree = !Number.isInteger(temp);

  const payload = Buffer.alloc(23, 0);
  payload[0] = 0xbb;
  payload[1] = 0x00;
  payload[2] = 0x06; // Command: 0x06 = set, 0x07 = get info
  payload[3] = 0x80;
  payload[4] = 0x00;
  payload[5] = 0x00;
  payload[6] = 0x0f; // Set status
  payload[7] = 0x00;
  payload[8] = 0x01;
  payload[9] = 0x01;
  // Byte 10: temperature (bits 3-7) | verticalFixation (bits 0-2)
  payload[10] = (temperature << 3) | (verticalFixation & 0x07);
  // Byte 11: horizontalFixation (bits 5-7)
  payload[11] = (horizontalFixation & 0x07) << 5;
  // Byte 12: required marker 0x0F (bits 0-3) | half-degree flag (bit 7)
  // Reference: payload[12] = 0b00001111 | temperature_05 << 7
  // Without 0x0F the device silently discards the command.
  payload[12] = 0x0f | (hasHalfDegree ? 0x80 : 0x00);
  // Byte 13: fanspeed (bits 5-7)
  payload[13] = (fanspeed & 0x07) << 5;
  // Byte 14: turbo (bit 6) | mute (bit 7)
  payload[14] = (turbo & 0x01) << 6 | (mute & 0x01) << 7;
  // Byte 15: mode (bits 5-8) | sleep (bits 2-3)
  payload[15] = (mode & 0x0f) << 5 | (params['ac_slp'] ?? 0) << 2;
  payload[16] = 0x00;
  payload[17] = 0x00;
  // Byte 18: power (bits 0-4) | health (bit 1) | clean (bit 2)
  payload[18] = (power & 0x01) << 5 | (health & 0x01) << 1 | (clean & 0x01) << 2;
  payload[19] = 0x00;
  // Byte 20: display (bit 4) | mildew (bits 3-4)
  payload[20] = (display & 0x01) << 4 | (mildew & 0x01) << 3;
  payload[21] = 0x00;
  payload[22] = 0x00;

  const length = payload.length;
  const requestPayload = Buffer.alloc(32, 0);
  requestPayload[0] = length + 2;
  payload.copy(requestPayload, 2);

  const checksum = calculateChecksum(payload);
  requestPayload[length + 2] = (checksum >> 8) & 0xff;
  requestPayload[length + 3] = checksum & 0xff;

  return requestPayload;
}

/**
 * Build a getState request (magic bytes for querying device state).
 */
export function buildGetStatePacket(mac: Buffer): Buffer {
  const magic = Buffer.from('0C00BB0006800000020011012B7E0000', 'hex');
  return buildPacket(magic, BroadlinkCommand.Packet, mac);
}

/**
 * Build a getInfo request (queries ambient temperature, etc).
 */
export function buildGetInfoPacket(mac: Buffer): Buffer {
  const magic = Buffer.from('0C00BB0006800000020021011B7E0000', 'hex');
  return buildPacket(magic, BroadlinkCommand.Packet, mac);
}

/**
 * Parse a response payload to extract AC state.
 * Based on updateStatus and updateInfo from broadlink-aircon-api.
 */
export function parseStatePayload(payload: Buffer): Partial<BroadlinkAState> {
  const state: Partial<BroadlinkAState> = {};

  if (payload.length === 32) {
    // updateStatus
    state.temp = 8 + (payload[12] >> 3);
    state.power = (payload[20] >> 5) & 0x01;
    state.verticalFixation = payload[12] & 0x07;
    state.mode = (payload[17] >> 5) & 0x0f;
    state.sleep = (payload[17] >> 2) & 0x01;
    state.display = (payload[22] >> 4) & 0x01;
    state.mildew = (payload[22] >> 3) & 0x01;
    state.health = (payload[20] >> 1) & 0x01;
    state.horizontalFixation = (payload[12] & 0x07) << 0;
    state.fanspeed = (payload[15] >> 5) & 0x07;
    state.mute = (payload[16] >> 7) & 0x01;
    state.turbo = (payload[16] >> 6) & 0x01;
    state.clean = (payload[20] >> 2) & 0x01;
  }

  if (payload.length === 48) {
    // updateInfo — ambient temperature
    const amb_05 = payload[33] / 10;
    let amb = payload[17] & 0x1f;
    if (payload[17] > 63) {
      amb += 32;
    }
    state.ambientTemp = amb_05 + amb;
  }

  return state;
}
