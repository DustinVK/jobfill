import { describe, expect, it } from 'vitest';
import {
  createMemoryRuntime,
  createMemoryScripting,
  createMemoryStorage,
  MemoryBlobStore,
  MemoryChannel,
} from '../../src/shared/adapters/memory.js';
import type { BackgroundEnv, InjectionResult } from '../../src/shared/adapters/types.js';
import { injectContent, registerInvocations } from '../../src/background/invoke.js';

function makeEnv() {
  const scripting = createMemoryScripting();
  const runtime = createMemoryRuntime();
  const env: BackgroundEnv = {
    storage: createMemoryStorage(),
    blobs: new MemoryBlobStore(),
    server: new MemoryChannel(),
    scripting,
    runtime,
  };
  return { env, scripting, runtime };
}

describe('invocation paths (SPEC §8.4)', () => {
  it('open-palette command injects content.js into all frames of the tab', async () => {
    const { env, scripting, runtime } = makeEnv();
    registerInvocations(env);
    runtime.fireCommand('open-palette', 7);
    await Promise.resolve(); // let the async injection settle
    expect(scripting.injected).toEqual([['content.js']]);
  });

  it('unknown commands and commands without a tab inject nothing', async () => {
    const { env, scripting, runtime } = makeEnv();
    registerInvocations(env);
    runtime.fireCommand('some-other-command', 7);
    runtime.fireCommand('open-palette', undefined);
    await Promise.resolve();
    expect(scripting.injected).toEqual([]);
  });

  it('injectContent reports success when at least one frame loads', async () => {
    const { env } = makeEnv();
    // Simulate a page where the top frame loads but a cross-origin frame is refused.
    env.scripting = {
      async executeScript(): Promise<InjectionResult[]> {
        return [
          { frameId: 0, ok: true },
          { frameId: 3, ok: false, error: 'Missing host permission' },
        ];
      },
    };
    expect(await injectContent(env, 1)).toBe(true);
  });

  it('injectContent reports failure when no frame loads', async () => {
    const { env } = makeEnv();
    env.scripting = {
      async executeScript(): Promise<InjectionResult[]> {
        return [{ frameId: 0, ok: false, error: 'quarantined domain' }];
      },
    };
    expect(await injectContent(env, 1)).toBe(false);
  });
});
