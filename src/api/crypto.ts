import { createCipheriv } from 'crypto';

export function encryptAesCbcZeroPadding(iv: Buffer, key: Buffer, data: Buffer): Buffer {
  const blockSize = 16;
  const paddingNeeded = (blockSize - (data.length % blockSize)) % blockSize;
  const padded = paddingNeeded === 0
    ? data
    : Buffer.concat([data, Buffer.alloc(paddingNeeded)]);

  const cipher = createCipheriv('aes-128-cbc', key, iv);
  cipher.setAutoPadding(false);

  const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]);
  return encrypted;
}
