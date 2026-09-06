/**
 * e2e harness entrypoint (never shipped; built to dist-harness/).
 *
 * Same content bundle as production, wired to the in-memory transport with an in-process
 * background router behind it. This is what makes scanner → classifier → overlay → fillers
 * testable in a plain page without a loaded extension (OVERNIGHT_PLAN §7).
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
import { bootstrap, type ContentSession } from './bootstrap.js';

export interface HarnessHandle {
  session: ContentSession;
  shadow: ShadowRoot;
  env: BackgroundEnv;
}

declare global {
  interface Window {
    __jobfillHarness?: HarnessHandle;
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
  const env: BackgroundEnv = {
    storage: createMemoryStorage(),
    blobs: new MemoryBlobStore(),
    server: channel,
    scripting: createMemoryScripting(),
    runtime: createMemoryRuntime(),
  };
  env.server.serve(createRouter({ env }));

  const session = bootstrap({ transport: channel });
  window.__jobfillHarness = { session, shadow: session.overlay.shadow, env };
}
