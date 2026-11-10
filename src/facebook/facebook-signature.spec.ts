import { createHmac } from 'node:crypto';
import { isValidMetaSignature } from './facebook-signature.js';

describe('isValidMetaSignature', () => {
  const appSecret = 'test-secret';
  const body = Buffer.from('{"object":"page"}');
  const signature = `sha256=${createHmac('sha256', appSecret)
    .update(body)
    .digest('hex')}`;

  it('accepts a valid SHA-256 signature for the raw payload', () => {
    expect(isValidMetaSignature(body, signature, appSecret)).toBe(true);
  });

  it('rejects missing, malformed, or mismatched signatures', () => {
    expect(isValidMetaSignature(body, undefined, appSecret)).toBe(false);
    expect(isValidMetaSignature(body, 'sha1=invalid', appSecret)).toBe(false);
    expect(isValidMetaSignature(body, signature, 'wrong-secret')).toBe(false);
    expect(
      isValidMetaSignature(Buffer.from('different body'), signature, appSecret),
    ).toBe(false);
  });
});
