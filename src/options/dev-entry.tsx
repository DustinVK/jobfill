/**
 * `npm run dev:options` / options-e2e entrypoint (never shipped; built to dist-harness/).
 * Same options app, wired to an in-process background router. Vault storage is backed by
 * the page's localStorage so reloads keep data (the e2e's edit→reload→still-there check);
 * file BYTES use the in-memory blob store and do not survive reload here — file persistence
 * is exercised against the real IndexedDB store in unit tests instead.
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
import { App } from './App.js';

const channel = new MemoryChannel({ origin: location.origin });
const env: BackgroundEnv = {
  storage: createWebStorage(),
  blobs: new MemoryBlobStore(),
  server: channel,
  scripting: createMemoryScripting(),
  runtime: createMemoryRuntime(),
};
env.server.serve(createRouter({ env }));

const root = document.getElementById('app');
if (root) render(<App client={new ProtocolClient(channel)} />, root);
