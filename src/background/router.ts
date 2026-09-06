/**
 * Message router: the single entry into background state (SPEC §6.1, §8.3).
 * Adapter-agnostic — `index.ts` gives it the real environment, tests give it the memory one.
 */
import type { BackgroundEnv, MessageHandler, MessageSender } from '../shared/adapters/types.js';
import type { Envelope } from '../shared/messages.js';
import { isRequest } from '../shared/messages.js';

export const EXTENSION_VERSION = '0.1.0';

export interface RouterDeps {
  env: BackgroundEnv;
}

export function createRouter(_deps: RouterDeps): MessageHandler {
  return async (message: unknown, _sender: MessageSender): Promise<Envelope<unknown>> => {
    if (!isRequest(message)) {
      return { ok: false, error: 'jobfill: malformed request' };
    }
    try {
      switch (message.t) {
        case 'ping':
          return { ok: true, data: { pong: true, version: EXTENSION_VERSION } };
        default:
          return { ok: false, error: `jobfill: unknown request "${String(message.t)}"` };
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };
}
