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

// Real PBKDF2 at 600k iterations is deliberately slow; tests dial the count down AND relax
// the decode bounds to match. Production constructors keep the strict defaults (see the
// bounds regression tests at the bottom).
const FAST_ITERATIONS = 1000;
const TEST_BOUNDS = { minIterations: 1, maxIterations: 10_000_000 };
const fastCodec = (passphrase: string) => new AesGcmCodec(passphrase, FAST_ITERATIONS, TEST_BOUNDS);

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
    const aes = fastCodec('pw');
    const envelope = await aes.encode(createEmptyVault());
    await expect(plain.decode(envelope)).rejects.toThrow(VaultDecodeError);
  });
});

describe('AesGcmCodec', () => {
  it('round-trips a vault', async () => {
    const codec = fastCodec('correct horse battery staple');
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
    const codec = fastCodec('pw');
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
    const envelope = await fastCodec('right').encode(createEmptyVault());
    const wrong = fastCodec('wrong');
    const error = await wrong.decode(envelope).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VaultDecodeError);
    expect((error as VaultDecodeError).reason).toBe('wrong-passphrase-or-tampered');
  });

  it('tampered ciphertext yields a clean error', async () => {
    const codec = fastCodec('pw');
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
    const codec = fastCodec('pw');
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

describe('rung-1 review P2 regressions', () => {
  it('production iteration count meets the SPEC §6.3 floor', async () => {
    const { PBKDF2_ITERATIONS } = await import('../../src/background/codecs.js');
    expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(600_000);
  });

  it('a default-bounds codec rejects weakened or hostile iteration counts', async () => {
    const fast = fastCodec('pw');
    const envelope = await fast.encode(createEmptyVault());
    if (envelope.enc !== 'aes-gcm') throw new Error('unreachable');
    const strict = new AesGcmCodec('pw'); // production defaults
    // 1000 iterations is below the floor — a doctored export must be refused cleanly.
    const error = await strict.decode(envelope).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VaultDecodeError);
    expect((error as VaultDecodeError).reason).toBe('unsupported');

    const tooMany = { ...envelope, kdf: { ...envelope.kdf, iterations: 2_000_000_000 } };
    await expect(strict.decode(tooMany)).rejects.toThrow(/bounds/);
  });

  it('kdf: null is rejected as an envelope, not a TypeError', () => {
    expect(isStoredEnvelope({ v: 1, enc: 'aes-gcm', iv: 'a', ct: 'b', kdf: null })).toBe(false);
  });
});
