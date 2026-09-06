import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDbBlobStore } from '../../src/shared/adapters/browser.js';

describe('IndexedDbBlobStore (fake-indexeddb)', () => {
  it('round-trips blobs through put/get/keys/delete', async () => {
    const store = new IndexedDbBlobStore(new IDBFactory());
    await store.put('a', new Blob(['resume bytes'], { type: 'application/pdf' }));
    await store.put('b', new Blob(['cover letter']));

    expect((await store.keys()).sort()).toEqual(['a', 'b']);
    const blob = await store.get('a');
    expect(blob?.type).toBe('application/pdf');
    expect(await blob?.text()).toBe('resume bytes');

    await store.delete('a');
    expect(await store.get('a')).toBeUndefined();
    expect(await store.keys()).toEqual(['b']);
  });

  it('returns undefined for a missing key', async () => {
    const store = new IndexedDbBlobStore(new IDBFactory());
    expect(await store.get('nope')).toBeUndefined();
  });

  it('overwrites an existing key', async () => {
    const store = new IndexedDbBlobStore(new IDBFactory());
    await store.put('k', new Blob(['v1']));
    await store.put('k', new Blob(['v2']));
    expect(await (await store.get('k'))?.text()).toBe('v2');
    expect(await store.keys()).toEqual(['k']);
  });

  it('does not poison itself after a failed open', async () => {
    let failNext = true;
    const real = new IDBFactory();
    const flaky = {
      open(name: string, version?: number) {
        if (failNext) {
          failNext = false;
          // A request whose error event fires asynchronously, like a real quota failure.
          const request = real.open(name, version);
          setTimeout(() => {
            Object.defineProperty(request, 'error', {
              value: new DOMException('boom', 'UnknownError'),
              configurable: true,
            });
            request.onerror?.(new Event('error'));
          }, 0);
          // Neuter success so only the error path runs.
          Object.defineProperty(request, 'onsuccess', { set: () => undefined });
          return request;
        }
        return real.open(name, version);
      },
    } as unknown as IDBFactory;

    const store = new IndexedDbBlobStore(flaky);
    await expect(store.keys()).rejects.toThrow();
    // Second call must reopen cleanly rather than replaying the cached rejection.
    await store.put('k', new Blob(['ok']));
    expect(await store.keys()).toEqual(['k']);
  });
});
