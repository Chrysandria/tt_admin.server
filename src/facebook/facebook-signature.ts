import { createHmac, timingSafeEqual } from 'node:crypto';

export function isValidMetaSignature(
  rawBody: Buffer | undefined,
  signature: string | undefined,
  appSecret: string,
) {
  const match = /^sha256=([a-f0-9]{64})$/i.exec(signature ?? '');
  if (!rawBody || !match || !appSecret) return false;

  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  const received = Buffer.from(match[1], 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}
