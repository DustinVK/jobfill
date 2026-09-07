import { describe, expect, it } from 'vitest';
import {
  createMemoryPermissions,
  createMemoryRuntime,
  createMemoryScripting,
  createMemoryStorage,
  MemoryBlobStore,
  MemoryChannel,
} from '../../src/shared/adapters/memory.js';
import type { BackgroundEnv, InjectionResult } from '../../src/shared/adapters/types.js';
import {
  injectContent,
  registerInvocations,
  syncAutoRunRegistration,
} from '../../src/background/invoke.js';

function makeEnv(grantedOrigins: string[] = []) {
  const scripting = createMemoryScripting();
  const runtime = createMemoryRuntime();
  const permissions = createMemoryPermissions(grantedOrigins);
  const env: BackgroundEnv = {
    storage: createMemoryStorage(),
    blobs: new MemoryBlobStore(),
    server: new MemoryChannel(),
    scripting,
    runtime,
    permissions,
  };
  return { env, scripting, runtime, permissions };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

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
      ...createMemoryScripting(),
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
      ...createMemoryScripting(),
      async executeScript(): Promise<InjectionResult[]> {
        return [{ frameId: 0, ok: false, error: 'quarantined domain' }];
      },
    };
    expect(await injectContent(env, 1)).toBe(false);
  });
});

describe('auto-run registration (SPEC §8.5)', () => {
  it('registers the affordance bundle for granted origins, persistent across sessions', async () => {
    const { env, scripting } = makeEnv(['https://jobs.example.com/*']);
    await syncAutoRunRegistration(env);
    const scripts = [...scripting.registered.values()];
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toMatchObject({
      matches: ['https://jobs.example.com/*'],
      js: ['content-auto.js'],
      allFrames: true,
      runAt: 'document_idle',
      persistAcrossSessions: true,
    });
  });

  it('is idempotent — a wake-time re-sync with unchanged grants re-registers nothing', async () => {
    const { env, scripting } = makeEnv(['https://jobs.example.com/*']);
    await syncAutoRunRegistration(env);
    // memory adapter throws on duplicate ids, so a sloppy re-register would fail here
    await syncAutoRunRegistration(env);
    expect(scripting.registered.size).toBe(1);
  });

  it('permission grant via the popup triggers registration; revoking the last grant unregisters', async () => {
    const { env, scripting, permissions } = makeEnv();
    registerInvocations(env);
    await settle();
    expect(scripting.registered.size).toBe(0);

    permissions.grant('https://greenhouse.io/*');
    await settle();
    expect([...scripting.registered.values()][0]?.matches).toEqual(['https://greenhouse.io/*']);

    permissions.grant('https://jobs.example.com/*');
    await settle();
    expect([...scripting.registered.values()][0]?.matches).toEqual([
      'https://greenhouse.io/*',
      'https://jobs.example.com/*',
    ]);

    permissions.revoke('https://greenhouse.io/*');
    permissions.revoke('https://jobs.example.com/*');
    await settle();
    expect(scripting.registered.size).toBe(0);
  });

  it('an env without a permissions surface (harness/demo) is a quiet no-op', async () => {
    const { env, scripting } = makeEnv();
    delete env.permissions;
    await syncAutoRunRegistration(env);
    expect(scripting.registered.size).toBe(0);
  });
});
