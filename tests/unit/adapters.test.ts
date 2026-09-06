import { describe, expect, it } from 'vitest';
import {
  MemoryBlobStore,
  MemoryChannel,
  createMemoryRuntime,
  createMemoryScripting,
  createMemoryStorage,
} from '../../src/shared/adapters/memory.js';
import { createRouter } from '../../src/background/router.js';
import { ProtocolClient } from '../../src/shared/messages.js';
import type { BackgroundEnv } from '../../src/shared/adapters/types.js';

function makeEnv(): { env: BackgroundEnv; channel: MemoryChannel } {
  const channel = new MemoryChannel();
  const env: BackgroundEnv = {
    storage: createMemoryStorage(),
    blobs: new MemoryBlobStore(),
    server: channel,
    scripting: createMemoryScripting(),
    runtime: createMemoryRuntime(),
  };
  env.server.serve(createRouter({ env }));
  return { env, channel };
}

describe('memory storage adapter', () => {
  it('round-trips values and isolates stored state from caller mutation', async () => {
    const storage = createMemoryStorage();
    const value = { a: 1, nested: { b: 2 } };
    await storage.local.set('k', value);
    value.nested.b = 99;
    expect(await storage.local.get('k')).toEqual({ a: 1, nested: { b: 2 } });
    await storage.local.remove('k');
    expect(await storage.local.get('k')).toBeUndefined();
  });

  it('keeps local and session areas separate', async () => {
    const storage = createMemoryStorage();
    await storage.local.set('k', 'local');
    await storage.session.set('k', 'session');
    expect(await storage.local.get('k')).toBe('local');
    expect(await storage.session.get('k')).toBe('session');
  });
});

describe('protocol', () => {
  it('answers ping through the router', async () => {
    const { channel } = makeEnv();
    const client = new ProtocolClient(channel);
    const reply = await client.send({ t: 'ping' });
    expect(reply.pong).toBe(true);
    expect(typeof reply.version).toBe('string');
  });

  it('clones messages like real structured-clone messaging (uncloneable payloads throw)', async () => {
    const { channel } = makeEnv();
    await expect(channel.send({ t: 'ping', cb: () => 1 })).rejects.toThrow();
  });

  it('surfaces unknown requests as errors instead of silent undefined', async () => {
    const { channel } = makeEnv();
    const client = new ProtocolClient(channel);
    await expect(client.send({ t: 'nope' } as never)).rejects.toThrow(/unknown request/);
  });

  it('rejects malformed messages', async () => {
    const { channel } = makeEnv();
    await expect(channel.send('not-a-request')).resolves.toEqual({
      ok: false,
      error: 'jobfill: malformed request',
    });
  });
});

describe('memory blob store', () => {
  it('stores, lists and deletes blobs', async () => {
    const store = new MemoryBlobStore();
    await store.put('a', new Blob(['hello']));
    expect(await store.keys()).toEqual(['a']);
    expect(await (await store.get('a'))?.text()).toBe('hello');
    await store.delete('a');
    expect(await store.get('a')).toBeUndefined();
  });
});
