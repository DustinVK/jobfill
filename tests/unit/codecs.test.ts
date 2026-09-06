import { describe, expect, it } from 'vitest';
import {
  AesGcmCodec,
  PlainCodec,
  VaultDecodeError,
  base64ToBytes,
  bytesToBase64,
  isStoredEnvelope,
} from '../../src/background/codecs.js';
import { createEmptyVault } from '../../src/shared/vault.js';

// Real PBKDF2 at 600k iterations is deliberately slow; tests dial it down. The codec keeps
// the iteration count in the envelope, so decode honors whatever encode used.
const FAST_ITERATIONS = 1000;

describe('PlainCodec', () => {
  it('round-trips a vault', async () => {
    const codec = new PlainCodec();
    const vault = createEmptyVault();
    vault.profile.identity.firstName = 'Maya';
    const envelope = await codec.encode(vault);
    expect(envelope.enc).toBe('none');
    const decoded = await codec.decode(envelope);
    expect(decoded.profile.identity.firstName).toBe('Maya');
  });

  it('refuses an encrypted envelope with a clean error', async () => {
    const plain = new PlainCodec();
    const aes = new AesGcmCodec('pw', FAST_ITERATIONS);
    const envelope = await aes.encode(createEmptyVault());
    await expect(plain.decode(envelope)).rejects.toThrow(VaultDecodeError);
  });
});

describe('AesGcmCodec', () => {
  it('round-trips a vault', async () => {
    const codec = new AesGcmCodec('correct horse battery staple', FAST_ITERATIONS);
    const vault = createEmptyVault();
    vault.profile.identity.firstName = 'Maya';
    const envelope = await codec.encode(vault);
    expect(envelope.enc).toBe('aes-gcm');
    if (envelope.enc !== 'aes-gcm') throw new Error('unreachable');
    expect(envelope.kdf.iterations).toBe(FAST_ITERATIONS);
    const decoded = await codec.decode(envelope);
    expect(decoded.profile.identity.firstName).toBe('Maya');
  });

  it('ciphertext is not plaintext and differs per encode (random salt/iv)', async () => {
    const codec = new AesGcmCodec('pw', FAST_ITERATIONS);
    const vault = createEmptyVault();
    vault.profile.identity.firstName = 'FINDME';
    const a = await codec.encode(vault);
    const b = await codec.encode(vault);
    if (a.enc !== 'aes-gcm' || b.enc !== 'aes-gcm') throw new Error('unreachable');
    expect(a.ct).not.toContain('FINDME');
    expect(a.ct).not.toBe(b.ct);
    expect(a.iv).not.toBe(b.iv);
  });

  it('wrong passphrase yields a clean error, never partial state', async () => {
    const envelope = await new AesGcmCodec('right', FAST_ITERATIONS).encode(createEmptyVault());
    const wrong = new AesGcmCodec('wrong', FAST_ITERATIONS);
    const error = await wrong.decode(envelope).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VaultDecodeError);
    expect((error as VaultDecodeError).reason).toBe('wrong-passphrase-or-tampered');
  });

  it('tampered ciphertext yields a clean error', async () => {
    const codec = new AesGcmCodec('pw', FAST_ITERATIONS);
    const envelope = await codec.encode(createEmptyVault());
    if (envelope.enc !== 'aes-gcm') throw new Error('unreachable');
    const bytes = base64ToBytes(envelope.ct);
    const flipped = bytes[10];
    if (flipped === undefined) throw new Error('ciphertext too short');
    bytes[10] = flipped ^ 0xff;
    const tampered = { ...envelope, ct: bytesToBase64(bytes) };
    const error = await codec.decode(tampered).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VaultDecodeError);
    expect((error as VaultDecodeError).reason).toBe('wrong-passphrase-or-tampered');
  });

  it('malformed base64 yields a clean error', async () => {
    const codec = new AesGcmCodec('pw', FAST_ITERATIONS);
    const envelope = await codec.encode(createEmptyVault());
    if (envelope.enc !== 'aes-gcm') throw new Error('unreachable');
    const error = await codec
      .decode({ ...envelope, iv: '!!!not-base64!!!' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VaultDecodeError);
    expect((error as VaultDecodeError).reason).toBe('malformed-envelope');
  });
});

describe('base64 helpers', () => {
  it('round-trip binary including >0x7f bytes and large buffers', () => {
    const bytes = new Uint8Array(70_000).map((_, i) => i % 256);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });
});

describe('isStoredEnvelope', () => {
  it('accepts both envelope kinds and rejects garbage', () => {
    expect(isStoredEnvelope({ v: 1, enc: 'none', data: {} })).toBe(true);
    expect(isStoredEnvelope({ v: 1, enc: 'aes-gcm', kdf: {}, iv: 'a', ct: 'b' })).toBe(true);
    expect(isStoredEnvelope({ v: 2, enc: 'none', data: {} })).toBe(false);
    expect(isStoredEnvelope({ enc: 'none' })).toBe(false);
    expect(isStoredEnvelope('vault')).toBe(false);
    expect(isStoredEnvelope(null)).toBe(false);
  });
});
