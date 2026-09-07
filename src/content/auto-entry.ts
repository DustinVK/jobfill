/**
 * Auto-run content entrypoint (dist/content-auto.js) — registered on granted origins via
 * `scripting.registerContentScripts` (SPEC §8.4.4/§8.5). Same bundle as content.js plus
 * the affordance flag: quiet corner chip, no takeover. One of the few files allowed to
 * name `browser` directly.
 */
import { BrowserMessageTransport } from '../shared/adapters/browser.js';
import { bootstrap } from './bootstrap.js';

bootstrap({ transport: new BrowserMessageTransport(), autoRun: true });
