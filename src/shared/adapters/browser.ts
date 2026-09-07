/**
 * The real `browser.*` adapters. This file and the thin entrypoints are the ONLY places
 * in the codebase that may name `browser` (CLAUDE.md invariant; enforced by eslint config).
 */
import type {
  BlobStoreAdapter,
  InjectionResult,
  MessageHandler,
  MessageServer,
  MessageTransport,
  PermissionsAdapter,
  RegisteredScript,
  RuntimeAdapter,
  ScriptingAdapter,
  StorageAdapter,
  StorageArea,
} from './types.js';

class BrowserStorageArea implements StorageArea {
  constructor(private readonly area: typeof browser.storage.local) {}

  async get<T>(key: string): Promise<T | undefined> {
    const got = await this.area.get(key);
    return got[key] as T | undefined;
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.area.set({ [key]: value });
  }

  async remove(key: string): Promise<void> {
    await this.area.remove(key);
  }
}

export function createBrowserStorage(): StorageAdapter {
  return {
    local: new BrowserStorageArea(browser.storage.local),
    // FF-only: storage.session stays at the default TRUSTED_CONTEXTS access level so content
    // scripts can never read the unlocked key (SPEC §6.2).
    session: new BrowserStorageArea(browser.storage.session),
  };
}

/** Client side of `runtime.sendMessage` (content scripts, options, popup). */
export class BrowserMessageTransport implements MessageTransport {
  async send(message: unknown): Promise<unknown> {
    return browser.runtime.sendMessage(message);
  }
}

/** Background side of `runtime.onMessage`. */
export class BrowserMessageServer implements MessageServer {
  private served = false;

  serve(handler: MessageHandler): void {
    // One listener per server: two promise-returning listeners would both claim every
    // message in Firefox, and the loser's reply is dropped.
    if (this.served) throw new Error('jobfill: BrowserMessageServer.serve called twice');
    this.served = true;
    browser.runtime.onMessage.addListener((message, sender) => {
      // Returning a promise is the Firefox-native reply channel (no sendResponse dance).
      // origin/url come from the sending FRAME only (SPEC §8.3: site memory is keyed by the
      // sender frame's origin, never the top tab's) — no tab-level fallback; site-scoped
      // handlers must reject requests that arrive without an origin.
      return handler(message, {
        tabId: sender.tab?.id,
        frameId: sender.frameId,
        origin: sender.origin ?? originOf(sender.url),
        url: sender.url,
      });
    });
  }
}

function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

const DB_NAME = 'jobfill';
const DB_VERSION = 1;
const STORE = 'files';

/**
 * IndexedDB blob store. Background context only — a content script's IndexedDB belongs to the
 * host page's origin, so file bytes travel by messaging instead (SPEC §6.2).
 */
export class IndexedDbBlobStore implements BlobStoreAdapter {
  private dbPromise: Promise<IDBDatabase> | undefined;

  constructor(private readonly factory: IDBFactory = indexedDB) {}

  private open(): Promise<IDBDatabase> {
    this.dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = this.factory.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => {
        // If the DB is deleted/upgraded elsewhere, drop the cached handle so the next call reopens.
        req.result.onversionchange = () => {
          req.result.close();
          this.dbPromise = undefined;
        };
        resolve(req.result);
      };
      req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
    }).catch((err: unknown) => {
      // Never cache a rejected open — a transient failure would poison the store forever.
      this.dbPromise = undefined;
      throw err;
    });
    return this.dbPromise;
  }

  private async tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = run(transaction.objectStore(STORE));
      let result: T;
      request.onsuccess = () => {
        result = request.result;
        // Reads can resolve on request success; writes must wait for the COMMIT — the
        // success event fires before the transaction is durable, and an abort after it
        // (quota, event-page teardown) would otherwise be silent data loss.
        if (mode === 'readonly') resolve(result);
      };
      transaction.oncomplete = () => {
        if (mode !== 'readonly') resolve(result);
      };
      const fail = () =>
        reject(transaction.error ?? request.error ?? new Error('indexedDB failed'));
      transaction.onabort = fail;
      transaction.onerror = fail;
    });
  }

  async put(key: string, blob: Blob): Promise<void> {
    await this.tx('readwrite', (s) => s.put(blob, key) as IDBRequest<IDBValidKey>);
  }

  async get(key: string): Promise<Blob | undefined> {
    const value = await this.tx<unknown>('readonly', (s) => s.get(key) as IDBRequest<unknown>);
    return value instanceof Blob ? value : undefined;
  }

  async delete(key: string): Promise<void> {
    await this.tx('readwrite', (s) => s.delete(key) as IDBRequest<undefined>);
  }

  async keys(): Promise<string[]> {
    const keys = await this.tx<IDBValidKey[]>(
      'readonly',
      (s) => s.getAllKeys() as IDBRequest<IDBValidKey[]>,
    );
    return keys.map(String);
  }
}

export function createBrowserScripting(): ScriptingAdapter {
  return {
    async executeScript(opts): Promise<InjectionResult[]> {
      try {
        const results = await browser.scripting.executeScript({
          target: { tabId: opts.tabId, allFrames: opts.allFrames ?? false },
          files: opts.files,
        });
        return results.map((r) => ({
          frameId: r.frameId,
          ok: r.error === undefined,
          error: r.error === undefined ? undefined : String(r.error),
        }));
      } catch (err) {
        // Cross-origin frames fail silently under activeTab; a whole-call failure means the
        // top frame was refused (quarantined domain, privileged page). Report it honestly.
        return [{ frameId: 0, ok: false, error: err instanceof Error ? err.message : String(err) }];
      }
    },
    async registerContentScripts(scripts): Promise<void> {
      await browser.scripting.registerContentScripts(scripts);
    },
    async updateContentScripts(scripts): Promise<void> {
      await browser.scripting.updateContentScripts(scripts);
    },
    async unregisterContentScripts(ids): Promise<void> {
      await browser.scripting.unregisterContentScripts({ ids });
    },
    async getRegisteredContentScripts(): Promise<RegisteredScript[]> {
      const scripts = await browser.scripting.getRegisteredContentScripts();
      // Reflect the browser's actual values, don't fabricate (rung-5 review P2).
      // persistAcrossSessions/allFrames pass through; runAt is a free string in the API but
      // RegisteredScript narrows it — jobfill only ever manages its own 'document_idle'
      // script, so anything else is coerced (and would be a bug upstream, not a silent lie).
      return scripts.map((s) => ({
        id: s.id,
        matches: s.matches ?? [],
        js: s.js ?? [],
        allFrames: s.allFrames ?? false,
        runAt: 'document_idle',
        persistAcrossSessions: s.persistAcrossSessions ?? true,
      }));
    },
  };
}

export function createBrowserPermissions(): PermissionsAdapter {
  return {
    async getAll() {
      const { origins = [] } = await browser.permissions.getAll();
      return { origins };
    },
    onAdded(cb) {
      browser.permissions.onAdded.addListener((p) => cb(p.origins ?? []));
    },
    onRemoved(cb) {
      browser.permissions.onRemoved.addListener((p) => cb(p.origins ?? []));
    },
  };
}

export function createBrowserRuntime(): RuntimeAdapter {
  return {
    getURL: (path) => browser.runtime.getURL(path),
    onCommand(cb) {
      // FF-only: Firefox passes the active tab to commands.onCommand, which is what grants activeTab.
      browser.commands.onCommand.addListener((command, tab) => cb(command, tab?.id));
    },
    onActionClicked(cb) {
      browser.action.onClicked.addListener((tab) => {
        if (tab.id !== undefined) cb(tab.id);
      });
    },
    openOptionsPage: () => browser.runtime.openOptionsPage(),
  };
}
