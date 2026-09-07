/**
 * Background entrypoint (Firefox MV3 event page — no service workers, SPEC §8.1).
 * Wires the real adapters; all logic lives behind the seam.
 */
import {
  BrowserMessageServer,
  IndexedDbBlobStore,
  createBrowserPermissions,
  createBrowserRuntime,
  createBrowserScripting,
  createBrowserStorage,
} from '../shared/adapters/browser.js';
import type { BackgroundEnv } from '../shared/adapters/types.js';
import { createRouter } from './router.js';
import { registerInvocations } from './invoke.js';

const env: BackgroundEnv = {
  storage: createBrowserStorage(),
  blobs: new IndexedDbBlobStore(),
  server: new BrowserMessageServer(),
  scripting: createBrowserScripting(),
  runtime: createBrowserRuntime(),
  permissions: createBrowserPermissions(),
};

env.server.serve(createRouter({ env }));
registerInvocations(env);
