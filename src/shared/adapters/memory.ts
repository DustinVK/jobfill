/**
 * In-memory adapter implementations.
 *
 * These are not test scaffolding bolted on afterwards — they are how the options app runs
 * under `npm run dev:options` and how the e2e harness drives the real content bundle
 * without a loaded extension (OVERNIGHT_PLAN §7).
 */
import type {
  BlobStoreAdapter,
  InjectionResult,
  MessageHandler,
  MessageSender,
  MessageServer,
  MessageTransport,
  PermissionsAdapter,
  RegisteredScript,
  RuntimeAdapter,
  ScriptingAdapter,
  StorageAdapter,
  StorageArea,
} from './types.js';

class MemoryStorageArea implements StorageArea {
  private readonly map = new Map<string, string>();

  async get<T>(key: string): Promise<T | undefined> {
    const raw = this.map.get(key);
    return raw === undefined ? undefined : (JSON.parse(raw) as T);
  }

  async set(key: string, value: unknown): Promise<void> {
    // Serialize on write so callers cannot mutate stored state by holding a reference,
    // matching how the real storage backend behaves.
    this.map.set(key, JSON.stringify(value));
  }

  async remove(key: string): Promise<void> {
    this.map.delete(key);
  }
}

export function createMemoryStorage(): StorageAdapter {
  return { local: new MemoryStorageArea(), session: new MemoryStorageArea() };
}

export class MemoryBlobStore implements BlobStoreAdapter {
  private readonly map = new Map<string, Blob>();

  async put(key: string, blob: Blob): Promise<void> {
    this.map.set(key, blob);
  }

  async get(key: string): Promise<Blob | undefined> {
    return this.map.get(key);
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }

  async keys(): Promise<string[]> {
    return [...this.map.keys()];
  }
}

/**
 * A direct client↔host channel. `transport.send` invokes the served handler in-process,
 * structured-cloning both the request and the reply — exactly what Firefox's real
 * `runtime.sendMessage` does. `File`/`Blob` survive (they are structured-cloneable, which
 * is the Firefox advantage SPEC §6.2 relies on); functions/symbols throw here just as they
 * would in a real extension, so tests can't pass payloads production would reject.
 */
export class MemoryChannel implements MessageTransport, MessageServer {
  private handler: MessageHandler | undefined;
  readonly sender: MessageSender;

  constructor(sender: MessageSender = { tabId: 1, frameId: 0, origin: 'http://localhost' }) {
    this.sender = sender;
  }

  serve(handler: MessageHandler): void {
    this.handler = handler;
  }

  async send(message: unknown): Promise<unknown> {
    if (!this.handler) throw new Error('MemoryChannel: no handler served');
    const reply = await this.handler(structuredClone(message), this.sender);
    return structuredClone(reply);
  }
}

export function createMemoryScripting(): ScriptingAdapter & {
  injected: string[][];
  registered: Map<string, RegisteredScript>;
} {
  const injected: string[][] = [];
  const registered = new Map<string, RegisteredScript>();
  return {
    injected,
    registered,
    async executeScript(opts): Promise<InjectionResult[]> {
      injected.push(opts.files);
      return [{ frameId: 0, ok: true }];
    },
    async registerContentScripts(scripts): Promise<void> {
      for (const script of scripts) {
        if (registered.has(script.id)) throw new Error(`duplicate script id ${script.id}`);
        registered.set(script.id, script);
      }
    },
    async unregisterContentScripts(ids): Promise<void> {
      for (const id of ids) registered.delete(id);
    },
    async getRegisteredContentScripts(): Promise<RegisteredScript[]> {
      return [...registered.values()];
    },
  };
}

export function createMemoryPermissions(initialOrigins: string[] = []): PermissionsAdapter & {
  origins: Set<string>;
  grant(origin: string): void;
  revoke(origin: string): void;
} {
  const origins = new Set(initialOrigins);
  const added: ((o: string[]) => void)[] = [];
  const removed: ((o: string[]) => void)[] = [];
  return {
    origins,
    grant(origin) {
      origins.add(origin);
      for (const cb of added) cb([origin]);
    },
    revoke(origin) {
      origins.delete(origin);
      for (const cb of removed) cb([origin]);
    },
    async getAll() {
      return { origins: [...origins] };
    },
    onAdded(cb) {
      added.push(cb);
    },
    onRemoved(cb) {
      removed.push(cb);
    },
  };
}

export function createMemoryRuntime(): RuntimeAdapter & {
  fireCommand(command: string, tabId?: number): void;
} {
  const commandCbs: ((command: string, tabId: number | undefined) => void)[] = [];
  return {
    getURL: (path) => `/${path.replace(/^\//, '')}`,
    onCommand(cb) {
      commandCbs.push(cb);
    },
    onActionClicked() {
      /* no toolbar in memory mode */
    },
    fireCommand(command, tabId) {
      for (const cb of commandCbs) cb(command, tabId);
    },
  };
}
