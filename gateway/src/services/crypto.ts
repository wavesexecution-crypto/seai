import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/**
 * At-rest encryption + signing for the gateway.
 *
 * - AES-256-GCM for Shopify access tokens and SEAI machine tokens at rest.
 * - HMAC-SHA256 for ticket/claim signatures and webhook verification.
 *
 * The encryption key is derived (SHA-256) from SESSION_STORAGE_KEY, which is
 * supplied only through the environment / platform secrets store. Keys never
 * appear in logs, cookies, or the browser.
 */

export interface CryptoBox {
  /** AES-256-GCM encrypt a UTF-8 string. Output: base64(iv[12] | tag[16] | ciphertext). */
  encrypt(plaintext: string): Promise<string>;
  /** Decrypt a value produced by {@link encrypt}. Throws CryptoError on tampering. */
  decrypt(ciphertext: string): Promise<string>;
  /** HMAC-SHA256 signature (base64) over a message with the given key. */
  signHmac(key: string, message: string): string;
  /** Timing-safe HMAC verification. */
  verifyHmac(key: string, message: string, expectedBase64: string): boolean;
}

export class CryptoError extends Error {
  override readonly name = 'CryptoError';
}

/**
 * Create a CryptoBox bound to the given master key. The master key can be any
 * non-empty string; the AES-256 key is derived with SHA-256 so a 32-byte
 * entropy source is not strictly required.
 */
export function createCryptoBox(masterKey: string): CryptoBox {
  const encKey = sha256Bytes(masterKey);

  async function encrypt(plaintext: string): Promise<string> {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', encKey, iv);
    const plain = Buffer.from(plaintext, 'utf-8');
    const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ciphertext]).toString('base64');
  }

  async function decrypt(payload: string): Promise<string> {
    let raw: Buffer;
    try {
      raw = Buffer.from(payload, 'base64');
    } catch {
      throw new CryptoError('Invalid ciphertext encoding.');
    }
    if (raw.length < 12 + 16 + 1) {
      throw new CryptoError('Ciphertext is too short.');
    }
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 12 + 16);
    const body = raw.subarray(12 + 16);
    const decipher = createDecipheriv('aes-256-gcm', encKey, iv);
    // Node exposes setAuthTag on GCM deciphers; the strict DecipherGCM type
    // only surfaces it under certain option combos, so narrow explicitly.
    (decipher as unknown as { setAuthTag(tag: Buffer): void }).setAuthTag(tag);
    try {
      const plain = Buffer.concat([decipher.update(body), decipher.final()]);
      return plain.toString('utf-8');
    } catch {
      throw new CryptoError('Decryption failed (tampered or wrong key).');
    }
  }

  function signHmac(key: string, message: string): string {
    return createHmac('sha256', key).update(message).digest('base64');
  }

  function verifyHmac(key: string, message: string, expectedBase64: string): boolean {
    const expected = Buffer.from(expectedBase64, 'base64');
    const actual = createHmac('sha256', key).update(message).digest();
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  return { encrypt, decrypt, signHmac, verifyHmac };
}

function sha256Bytes(value: string): Buffer {
  return createHmac('sha256', 'seai-gateway:v1').update(value).digest();
}

/** Cryptographically-secure random token (url-safe base64, no padding). */
export function randomToken(byteLength = 32): string {
  return randomBytes(byteLength).toString('base64url').replaceAll('=', '');
}