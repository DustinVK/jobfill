/**
 * Vault codecs — the crypto boundary (SPEC §6.3).
 *
 * `PlainCodec` is the v1 default. `AesGcmCodec` (PBKDF2-SHA256 → AES-256-GCM, WebCrypto only)
 * ships implemented and tested from day one; the settings UI to enable it is post-v1.
 * Wrong passphrase and tampered ciphertext both surface as clean `VaultDecodeError`s —
 * never partial state.
 */
import type { Vault } from '../shared/types.js';

export interface KdfParams {
  alg: 'PBKDF2-SHA256';
  iterations: number;
  /** base64 */
  salt: string;
}

export type StoredEnvelope =
  | { v: 1; enc: 'none'; data: unknown }
  | { v: 1; enc: 'aes-gcm'; kdf: KdfParams; iv: string; ct: string };

export interface VaultCodec {
  encode(vault: Vault): Promise<StoredEnvelope>;
  decode(env: StoredEnvelope): Promise<Vault>;
}

export class VaultDecodeError extends Error {
  constructor(
    message: string,
    readonly reason: 'wrong-passphrase-or-tampered' | 'malformed-envelope' | 'unsupported',
  ) {
    super(message);
    this.name = 'VaultDecodeError';
  }
}

// SPEC §6.3: iterations ≥ 600_000.
export const PBKDF2_ITERATIONS = 600_000;

export class PlainCodec implements VaultCodec {
  async encode(vault: Vault): Promise<StoredEnvelope> {
    return { v: 1, enc: 'none', data: vault };
  }

  async decode(env: StoredEnvelope): Promise<Vault> {
    if (env.enc !== 'none') {
      throw new VaultDecodeError('Vault is encrypted; unlock it before use.', 'unsupported');
    }
    if (typeof env.data !== 'object' || env.data === null) {
      throw new VaultDecodeError('Stored vault data is not an object.', 'malformed-envelope');
    }
    return env.data as Vault;
  }
}

// ---------------------------------------------------------------------------
// base64 helpers (binary-safe, chunked to dodge call-stack limits on big vaults)
// ---------------------------------------------------------------------------

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ---------------------------------------------------------------------------
// AES-GCM codec
// ---------------------------------------------------------------------------

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export class AesGcmCodec implements VaultCodec {
  constructor(
    private readonly passphrase: string,
    private readonly iterations: number = PBKDF2_ITERATIONS,
  ) {}

  async encode(vault: Vault): Promise<StoredEnvelope> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(this.passphrase, salt, this.iterations);
    const plaintext = new TextEncoder().encode(JSON.stringify(vault));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      plaintext as BufferSource,
    );
    return {
      v: 1,
      enc: 'aes-gcm',
      kdf: { alg: 'PBKDF2-SHA256', iterations: this.iterations, salt: bytesToBase64(salt) },
      iv: bytesToBase64(iv),
      ct: bytesToBase64(new Uint8Array(ciphertext)),
    };
  }

  async decode(env: StoredEnvelope): Promise<Vault> {
    if (env.enc !== 'aes-gcm') {
      throw new VaultDecodeError('Envelope is not AES-GCM encrypted.', 'unsupported');
    }
    if (env.kdf.alg !== 'PBKDF2-SHA256') {
      throw new VaultDecodeError(`Unsupported KDF: ${String(env.kdf.alg)}`, 'unsupported');
    }
    let salt: Uint8Array;
    let iv: Uint8Array;
    let ct: Uint8Array;
    try {
      salt = base64ToBytes(env.kdf.salt);
      iv = base64ToBytes(env.iv);
      ct = base64ToBytes(env.ct);
    } catch {
      throw new VaultDecodeError('Envelope fields are not valid base64.', 'malformed-envelope');
    }
    const key = await deriveKey(this.passphrase, salt, env.kdf.iterations);
    let plaintext: ArrayBuffer;
    try {
      plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv as BufferSource },
        key,
        ct as BufferSource,
      );
    } catch {
      // WebCrypto throws an opaque OperationError for both bad key and bad tag — one message.
      throw new VaultDecodeError(
        'Could not decrypt the vault: wrong passphrase or corrupted data.',
        'wrong-passphrase-or-tampered',
      );
    }
    try {
      return JSON.parse(new TextDecoder().decode(plaintext)) as Vault;
    } catch {
      throw new VaultDecodeError('Decrypted vault is not valid JSON.', 'malformed-envelope');
    }
  }
}

export function isStoredEnvelope(value: unknown): value is StoredEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const env = value as Record<string, unknown>;
  if (env.v !== 1) return false;
  if (env.enc === 'none') return 'data' in env;
  if (env.enc === 'aes-gcm') {
    return typeof env.iv === 'string' && typeof env.ct === 'string' && typeof env.kdf === 'object';
  }
  return false;
}
