import { gcm } from '@noble/ciphers/aes.js';
import { bytesToUtf8, utf8ToBytes } from '@noble/ciphers/utils.js';
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';

/**
 * Authenticated encryption for secret items and password-protected backups
 * (AES-256-GCM via the audited @noble libraries; keys never leave the device).
 */

type RandomSource = (length: number) => Uint8Array;

let randomSource: RandomSource = (length) => {
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (!c?.getRandomValues) throw new Error('No secure random number generator available');
  return c.getRandomValues(new Uint8Array(length));
};

/** Lets the app plug in expo-crypto when the runtime has no Web Crypto. */
export function setRandomSource(source: RandomSource) {
  randomSource = source;
}

export function randomBytes(length: number): Uint8Array {
  return randomSource(length);
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? B64[n & 63] : '=';
  }
  return out;
}

const B64_LOOKUP = (() => {
  const t = new Int16Array(256).fill(-1);
  for (let i = 0; i < B64.length; i++) t[B64.charCodeAt(i)] = i;
  t['-'.charCodeAt(0)] = 62; // tolerate URL-safe input
  t['_'.charCodeAt(0)] = 63;
  return t;
})();

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/\-_]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (B64_LOOKUP[clean.charCodeAt(i)] << 18) |
      (B64_LOOKUP[clean.charCodeAt(i + 1)] << 12) |
      ((i + 2 < clean.length ? B64_LOOKUP[clean.charCodeAt(i + 2)] : 0) << 6) |
      (i + 3 < clean.length ? B64_LOOKUP[clean.charCodeAt(i + 3)] : 0);
    out[o++] = (n >> 16) & 255;
    if (i + 2 < clean.length) out[o++] = (n >> 8) & 255;
    if (i + 3 < clean.length) out[o++] = n & 255;
  }
  return out.slice(0, o);
}

export class DecryptionError extends Error {
  constructor(message = 'Could not decrypt — wrong key or damaged data.') {
    super(message);
    this.name = 'DecryptionError';
  }
}

const VERSION = 'v1';

/** AES-256-GCM with a random 96-bit nonce per message. */
export class SecretBox {
  constructor(private readonly key: Uint8Array) {
    if (key.length !== 32) throw new Error('SecretBox key must be 32 bytes');
  }

  static generateKey(): Uint8Array {
    return randomBytes(32);
  }

  encryptBytes(plain: Uint8Array): Uint8Array {
    const nonce = randomBytes(12);
    const sealed = gcm(this.key, nonce).encrypt(plain);
    const out = new Uint8Array(12 + sealed.length);
    out.set(nonce, 0);
    out.set(sealed, 12);
    return out;
  }

  decryptBytes(data: Uint8Array): Uint8Array {
    if (data.length < 12 + 16) throw new DecryptionError();
    try {
      return gcm(this.key, data.subarray(0, 12)).decrypt(data.subarray(12));
    } catch {
      throw new DecryptionError();
    }
  }

  encryptText(plain: string): string {
    return `${VERSION}:${bytesToBase64(this.encryptBytes(utf8ToBytes(plain)))}`;
  }

  decryptText(sealed: string): string {
    if (!sealed.startsWith(`${VERSION}:`)) throw new DecryptionError('Unknown encryption format.');
    return bytesToUtf8(this.decryptBytes(base64ToBytes(sealed.slice(VERSION.length + 1))));
  }
}

export const BACKUP_KDF_ITERATIONS = 210_000;

export async function deriveKeyFromPassword(password: string, salt: Uint8Array, iterations = BACKUP_KDF_ITERATIONS) {
  return pbkdf2Async(sha256, utf8ToBytes(password.normalize('NFKC')), salt, { c: iterations, dkLen: 32, asyncTick: 20 });
}

export interface EncryptedEnvelope {
  format: 'pocketvault-backup-encrypted';
  version: 1;
  kdf: { alg: 'pbkdf2-sha256'; iterations: number; salt: string };
  cipher: 'aes-256-gcm';
  data: string;
}

export async function encryptWithPassword(plain: string, password: string, iterations = BACKUP_KDF_ITERATIONS): Promise<string> {
  const salt = randomBytes(16);
  const box = new SecretBox(await deriveKeyFromPassword(password, salt, iterations));
  const envelope: EncryptedEnvelope = {
    format: 'pocketvault-backup-encrypted',
    version: 1,
    kdf: { alg: 'pbkdf2-sha256', iterations, salt: bytesToBase64(salt) },
    cipher: 'aes-256-gcm',
    data: bytesToBase64(box.encryptBytes(utf8ToBytes(plain))),
  };
  return JSON.stringify(envelope);
}

export function isEncryptedEnvelope(json: string): boolean {
  return /^\s*\{\s*"format"\s*:\s*"pocketvault-backup-encrypted"/.test(json);
}

export async function decryptWithPassword(json: string, password: string): Promise<string> {
  let env: EncryptedEnvelope;
  try {
    env = JSON.parse(json);
  } catch {
    throw new DecryptionError('This file is not a valid encrypted backup.');
  }
  if (env.format !== 'pocketvault-backup-encrypted' || env.kdf?.alg !== 'pbkdf2-sha256') {
    throw new DecryptionError('Unsupported encrypted backup format.');
  }
  const key = await deriveKeyFromPassword(password, base64ToBytes(env.kdf.salt), env.kdf.iterations);
  try {
    return bytesToUtf8(new SecretBox(key).decryptBytes(base64ToBytes(env.data)));
  } catch {
    throw new DecryptionError('Wrong password, or the backup is damaged.');
  }
}
