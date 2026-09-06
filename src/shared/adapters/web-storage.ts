/**
 * StorageAdapter over the page's `localStorage`/`sessionStorage`.
 *
 * Dev/harness only (never wired in the extension — there the vault lives in
 * `browser.storage.local`): gives `npm run dev:options` and the options e2e real
 * reload-persistence so "edit → reload → still there" is actually exercised.
 */
import type { StorageAdapter, StorageArea } from './types.js';

const PREFIX = 'jobfill:';

class WebStorageArea implements StorageArea {
  constructor(private readonly backing: Storage) {}

  async get<T>(key: string): Promise<T | undefined> {
    const raw = this.backing.getItem(PREFIX + key);
    return raw === null ? undefined : (JSON.parse(raw) as T);
  }

  async set(key: string, value: unknown): Promise<void> {
    this.backing.setItem(PREFIX + key, JSON.stringify(value));
  }

  async remove(key: string): Promise<void> {
    this.backing.removeItem(PREFIX + key);
  }
}

export function createWebStorage(win: Window & typeof globalThis = window): StorageAdapter {
  return {
    local: new WebStorageArea(win.localStorage),
    session: new WebStorageArea(win.sessionStorage),
  };
}
