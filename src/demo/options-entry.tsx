/**
 * Demo options entrypoint (built to demo/, never shipped, no `browser.*`).
 *
 * The real options app over the in-memory transport + in-process router, with the vault in
 * the page's localStorage, pre-seeded from ai/examples/sample-import.json — so the phone
 * demo can browse/edit the fictional sample profile and the form views (same origin, same
 * localStorage) pick the edits up on refresh.
 */
import { render } from 'preact';
import {
  MemoryBlobStore,
  MemoryChannel,
  createMemoryRuntime,
  createMemoryScripting,
} from '../shared/adapters/memory.js';
import { createWebStorage } from '../shared/adapters/web-storage.js';
import type { BackgroundEnv } from '../shared/adapters/types.js';
import { createRouter } from '../background/router.js';
import { ProtocolClient } from '../shared/messages.js';
import { App } from '../options/App.js';
import { seedDemoVault } from './seed.js';

async function main(): Promise<void> {
  // Options is an extension page in production; model that so vault.* requests are allowed.
  const channel = new MemoryChannel({ origin: 'moz-extension://demo-options' });
  const storage = createWebStorage();
  const blobs = new MemoryBlobStore();
  await seedDemoVault(storage, blobs);

  const env: BackgroundEnv = {
    storage,
    blobs,
    server: channel,
    scripting: createMemoryScripting(),
    runtime: createMemoryRuntime(),
  };
  env.server.serve(createRouter({ env }));

  const root = document.getElementById('app');
  if (root) render(<App client={new ProtocolClient(channel)} />, root);
}

void main();
