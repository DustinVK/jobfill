/**
 * e2e harness entrypoint (never shipped; built to dist-harness/).
 *
 * Same content bundle as production, wired to the in-memory transport with an in-process
 * background router behind it, seeded with the sample vault. This exercises scanner →
 * classifier → overlay → fillers exactly as shipped (OVERNIGHT_PLAN §7).
 *
 * It also publishes `window.__jobfillHarness` so tests can reach *inside* the closed shadow
 * root. That hook exists only here — the production bundle keeps the root genuinely closed
 * with no page-reachable reference (SPEC §7.9).
 */
import { createRouter } from '../background/router.js';
import {
  MemoryBlobStore,
  MemoryChannel,
  createMemoryRuntime,
  createMemoryScripting,
  createMemoryStorage,
} from '../shared/adapters/memory.js';
import type { BackgroundEnv } from '../shared/adapters/types.js';
import type { InterchangeDocument } from '../shared/types.js';
import { createEmptyVault } from '../shared/vault.js';
import { mergeAdd } from '../shared/interchange.js';
import { bootstrap, type ContentSession } from './bootstrap.js';
import * as attach from './attach.js';
import sampleImport from '../../ai/examples/sample-import.json';

export interface HarnessHandle {
  session: ContentSession;
  shadow: ShadowRoot;
  env: BackgroundEnv;
  /** The shipped attach module, callable from tests (plain-DataTransfer branch). */
  attach: typeof attach;
}

declare global {
  interface Window {
    __jobfillHarness?: HarnessHandle;
    /** Harness pages record page-side events here so tests assert observable effects. */
    __eventLog?: { type: string; target: string; value?: string }[];
    /** Set BEFORE injection to exercise affordance mode (registered-script auto-run). */
    __jobfillHarnessAutoRun?: boolean;
    /** Set BEFORE injection to boot with an empty vault (import-prompt path). */
    __jobfillHarnessEmptyVault?: boolean;
  }
}

// Re-injection guard: keep ONE background env per page. Without this, a second injection
// would build a fresh channel/env while bootstrap() returns the existing session bound to
// the old one — tests seeding `handle.env` would then talk past `handle.session.client`.
if (window.__jobfillHarness) {
  window.__jobfillHarness.session.activate();
} else {
  main();
}

function main(): void {
  const channel = new MemoryChannel({ tabId: 1, frameId: 0, origin: location.origin });
  const storage = createMemoryStorage();
  const blobs = new MemoryBlobStore();

  // Seed the vault with the sample import so compose has real data behind it. The empty-vault
  // flag exercises the "import your data" prompt (on-device Android finding).
  if (window.__jobfillHarnessEmptyVault === true) {
    void storage.local.set('vault', { v: 1, enc: 'none', data: createEmptyVault() });
  } else {
    const seeded = mergeAdd(createEmptyVault(), sampleImport as unknown as InterchangeDocument);
    // Link the sample resume to the active version so the attach flow has a file to offer.
    const resume = seeded.vault.files.find((f) => f.kind === 'resume');
    const activeVersion = seeded.vault.versions.find(
      (v) => v.id === seeded.vault.settings.activeVersionId,
    );
    if (resume && activeVersion) activeVersion.fileId = resume.id;
    void storage.local.set('vault', { v: 1, enc: 'none', data: seeded.vault });
    for (const payload of seeded.files) {
      void blobs.put(
        payload.record.bytesRef,
        new Blob([payload.bytes as unknown as BlobPart], { type: payload.record.mime }),
      );
    }
  }

  const env: BackgroundEnv = {
    storage,
    blobs,
    server: channel,
    scripting: createMemoryScripting(),
    runtime: createMemoryRuntime(),
  };
  env.server.serve(createRouter({ env }));

  const session = bootstrap({
    transport: channel,
    autoRun: window.__jobfillHarnessAutoRun === true,
  });
  window.__jobfillHarness = { session, shadow: session.overlay.shadow, env, attach };
}
