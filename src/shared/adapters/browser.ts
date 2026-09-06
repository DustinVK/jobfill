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
  serve(handler: MessageHandler): void {
    browser.runtime.onMessage.addListener((message, sender) => {
      // Returning a promise is the Firefox-native reply channel (no sendResponse dance).
      return handler(message, {
        tabId: sender.tab?.id,
        frameId: sender.frameId,
        origin: sender.origin ?? originOf(sender.url ?? sender.tab?.url),
        url: sender.url ?? sender.tab?.url,
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
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
    });
    return this.dbPromise;
  }

  private async tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = run(transaction.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('indexedDB request failed'));
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
  };
}
