/**
 * `npm run dev:options` entrypoint (never shipped; built to dist-harness/).
 * Same options app, running on the in-memory adapters against an in-process background
 * router — so the whole UI is workable in a plain browser tab.
 */
import { render } from 'preact';
import {
  MemoryBlobStore,
  MemoryChannel,
  createMemoryRuntime,
  createMemoryScripting,
  createMemoryStorage,
} from '../shared/adapters/memory.js';
import type { BackgroundEnv } from '../shared/adapters/types.js';
import { createRouter } from '../background/router.js';
import { ProtocolClient } from '../shared/messages.js';
import { App } from './App.js';

const channel = new MemoryChannel({ origin: location.origin });
const env: BackgroundEnv = {
  storage: createMemoryStorage(),
  blobs: new MemoryBlobStore(),
  server: channel,
  scripting: createMemoryScripting(),
  runtime: createMemoryRuntime(),
};
env.server.serve(createRouter({ env }));

const root = document.getElementById('app');
if (root) render(<App client={new ProtocolClient(channel)} />, root);
