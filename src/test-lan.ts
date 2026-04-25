/**
 * Standalone LAN communication test.
 * Usage: node dist/test-lan.js <ip> <mac>
 * Example: node dist/test-lan.js 192.168.20.180 ec:0b:ae:0b:c4:c8
 *
 * Sequence: auth → SET pwr=1 temp=24 → wait 2s → GET state → assert pwr=1
 */

import { createSocket } from 'dgram';
import {
  buildPacket,
  buildCommandPayload,
  buildGetStatePacket,
  parseAuthResponse,
  decryptPayload,
  BroadlinkCommand,
} from './api/broadlink/Protocol';

const [, , ip, macStr] = process.argv;

if (!ip || !macStr) {
  console.error('Usage: node dist/test-lan.js <ip> <mac>');
  process.exit(1);
}

const macBuf = Buffer.from(macStr.split(':').map(h => parseInt(h, 16)));

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function buildAuthPayload(): Promise<Buffer> {
  const payload = Buffer.alloc(0x50, 0);
  payload[0x04] = 0x31; payload[0x05] = 0x31; payload[0x06] = 0x31;
  payload[0x07] = 0x31; payload[0x08] = 0x31; payload[0x09] = 0x31;
  payload[0x0a] = 0x31; payload[0x0b] = 0x31; payload[0x0c] = 0x31;
  payload[0x0d] = 0x31; payload[0x0e] = 0x31; payload[0x0f] = 0x31;
  payload[0x1e] = 0x01;
  payload[0x2d] = 0x01;
  payload[0x30] = 0x74; payload[0x31] = 0x65; payload[0x32] = 0x73;
  payload[0x33] = 0x74; payload[0x34] = 0x20; payload[0x35] = 0x31;
  return payload;
}

async function run() {
  const socket = createSocket('udp4');

  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject);
    socket.bind(0, () => { socket.removeListener('error', reject); resolve(); });
  });
  socket.setBroadcast(true);

  let sessionKey = Buffer.alloc(0);
  let sessionId = Buffer.alloc(4, 0);
  let count = 1;

  // ─── Auth ────────────────────────────────────────────────────────────────
  console.log(`[AUTH] Sending to ${ip}:80 …`);
  const authPayload = await buildAuthPayload();
  const authPacket = buildPacket(authPayload, BroadlinkCommand.Auth, macBuf, Buffer.alloc(4, 0), count++);

  const authResponse = await new Promise<Buffer | null>((resolve) => {
    const t = setTimeout(() => resolve(null), 5000);
    socket.once('message', (msg) => { clearTimeout(t); resolve(msg); });
    socket.send(authPacket, 0, authPacket.length, 80, ip);
  });

  if (!authResponse) {
    console.error('[AUTH] TIMEOUT — no response in 5s');
    socket.close();
    process.exit(1);
  }

  const cmd = authResponse[0x26];
  console.log(`[AUTH] Response command byte: 0x${cmd.toString(16)}`);

  if (cmd !== 0xe9) {
    console.error(`[AUTH] Expected 0xe9, got 0x${cmd.toString(16)}`);
    socket.close();
    process.exit(1);
  }

  const authResult = parseAuthResponse(authResponse);
  if (authResult) {
    sessionKey = authResult.key;
    sessionId = authResult.id;
    console.log(`[AUTH] OK — got session key (${sessionKey.length} bytes)`);
  } else {
    console.log('[AUTH] OK — no key in payload, using default key');
  }

  // ─── SET command: pwr=1, temp=24 ─────────────────────────────────────────
  const cmdParams = {
    pwr: 1, temp: 24, ac_mode: 0, ac_mark: 0,
    ac_vdir: 0, ac_hdir: 0, ac_slp: 0, scrdisp: 0,
    mldprf: 0, ac_health: 0, ac_clean: 0, mute: 0, turbo: 0,
  };
  const cmdPayload = buildCommandPayload(cmdParams);
  const cmdPacket = buildPacket(cmdPayload, BroadlinkCommand.Packet, macBuf, sessionId, count++, sessionKey.length > 0 ? sessionKey : undefined);

  console.log(`[SET]  Sending pwr=1 temp=24 …`);
  console.log(`[SET]  Packet hex: ${cmdPacket.toString('hex')}`);

  await new Promise<void>((resolve, reject) => {
    socket.send(cmdPacket, 0, cmdPacket.length, 80, ip, (err) => {
      if (err) reject(err); else resolve();
    });
  });
  console.log('[SET]  Sent OK');

  await sleep(2000);

  // ─── GET state ────────────────────────────────────────────────────────────
  console.log('[GET]  Sending getState …');
  void buildGetStatePacket; // available but we use the keyed version below

  const statePacketKeyed = buildPacket(
    Buffer.from('0C00BB0006800000020011012B7E0000', 'hex'),
    BroadlinkCommand.Packet,
    macBuf,
    sessionId,
    count++,
    sessionKey.length > 0 ? sessionKey : undefined,
  );

  const stateResponse = await new Promise<Buffer | null>((resolve) => {
    const t = setTimeout(() => resolve(null), 5000);
    socket.once('message', (msg) => { clearTimeout(t); resolve(msg); });
    socket.send(statePacketKeyed, 0, statePacketKeyed.length, 80, ip);
  });

  if (!stateResponse) {
    console.error('[GET]  TIMEOUT');
    socket.close();
    process.exit(1);
  }

  const stateCmd = stateResponse[0x26];
  console.log(`[GET]  Response command byte: 0x${stateCmd.toString(16)}`);

  const decrypted = decryptPayload(stateResponse, sessionKey.length > 0 ? sessionKey : undefined);
  console.log(`[GET]  Decrypted (${decrypted.length} bytes): ${decrypted.toString('hex')}`);

  if (decrypted.length >= 23) {
    const pwr = (decrypted[20] >> 5) & 0x01;
    const temp = 8 + (decrypted[12] >> 3);
    console.log(`[GET]  pwr=${pwr}  temp=${temp}°C`);
    if (pwr === 1) {
      console.log('\n✅ PASS — device applied SET command (pwr=1)');
    } else {
      console.log('\n❌ FAIL — device still reports pwr=0 after SET');
    }
  } else {
    console.log('[GET]  Payload too short to parse');
  }

  socket.close();
}

run().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
