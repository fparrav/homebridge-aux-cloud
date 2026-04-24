/**
 * Discover Broadlink devices on LAN via UDP broadcast.
 * Based on homebridge-broadlink-heater-cooler (makleso6).
 */

import { createSocket } from 'dgram';

export interface DiscoveredDevice {
  ip: string;
  mac: string;
}

export class DeviceDiscovery {
    /**
    * Discover Broadlink devices on the local network.
    * Sends a broadcast auth packet and listens for responses.
      *
      * @param timeoutMs - How long to listen for responses (default: 3000ms)
      * @returns Array of discovered devices with IP and MAC
      */
  static async discover(timeoutMs: number = 3000): Promise<DiscoveredDevice[]> {
    const socket = createSocket('udp4');
    const discovered = new Map<string, DiscoveredDevice>();

    return new Promise((resolve) => {
      socket.on('message', (msg, rinfo) => {
           // Filter for Broadlink responses (command 0xe9 or 0xee)
        const command = msg[0x26];
        if (command === 0xe9 || command === 0xee) {
            const macBuf = msg.slice(0x2a, 0x30);
            const mac = macBuf.toString('hex').match(/.{2}/g)?.join(':') ?? '';

            if (!discovered.has(rinfo.address)) {
              discovered.set(rinfo.address, { ip: rinfo.address, mac });
               }
            }
          });

      socket.bind(() => {
          socket.setBroadcast(true);

           // Send auth broadcast to discover devices
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

          const header = Buffer.from([
            0x5a, 0xa5, 0xaa, 0x55,
            0x5a, 0xa5, 0xaa, 0x55,
           ]);

          const packet = Buffer.concat([header, payload]);
          socket.send(packet, 0, packet.length, 80, '255.255.255.255');

          setTimeout(() => {
            socket.close();
            resolve(Array.from(discovered.values()));
             }, timeoutMs);
          });
        });
     }

    /**
    * Check if a specific device is reachable on LAN.
      * Sends a UDP packet and waits for response.
      *
      * @param ip - Device IP address
     * @param timeoutMs - Timeout in milliseconds
      * @returns true if device is reachable
      */
  static async isReachable(ip: string, timeoutMs: number = 2000): Promise<boolean> {
    const socket = createSocket('udp4');

    return new Promise((resolve) => {
      let timeoutId: NodeJS.Timeout | null = null;

      socket.on('message', () => {
        socket.close();
        if (timeoutId !== null) clearTimeout(timeoutId);
        resolve(true);
        });

      timeoutId = setTimeout(() => {
        socket.close();
        resolve(false);
        }, timeoutMs);

      socket.bind(() => {
          const ping = Buffer.alloc(10, 0);
          socket.send(ping, 0, ping.length, 80, ip);
          });
        });
     }
}
