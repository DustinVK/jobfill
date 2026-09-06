/**
 * Content-script entrypoint. One of the few files allowed to name `browser` directly:
 * it wires the real adapters and hands them to the adapter-agnostic bootstrap.
 */
import { BrowserMessageTransport } from '../shared/adapters/browser.js';
import { bootstrap } from './bootstrap.js';

bootstrap({ transport: new BrowserMessageTransport() });
