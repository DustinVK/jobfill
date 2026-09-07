/**
 * The adapter seam (CLAUDE.md invariant, SPEC §8).
 *
 * Every `browser.*` touch in the codebase lives behind one of these interfaces.
 * Two implementations exist for each: `browser.ts` (real, only loaded by entrypoints)
 * and `memory.ts` (in-memory, used by unit tests, the e2e harness bundle and `dev:options`).
 */

/** One key/value area (`storage.local`, `storage.session`). */
export interface StorageArea {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface StorageAdapter {
  /** Persisted across restarts. Holds the vault envelope. */
  local: StorageArea;
  /** Memory-only, cleared on browser exit. Holds the unlocked crypto key. */
  session: StorageArea;
}

/** Who sent a message. The background verifies this on every site-scoped call (SPEC §8.3). */
export interface MessageSender {
  tabId?: number;
  frameId?: number;
  /** Origin of the sending frame, e.g. `https://boards.greenhouse.io`. */
  origin?: string;
  url?: string;
}

export type MessageHandler = (message: unknown, sender: MessageSender) => Promise<unknown>;

/** Client half of the messaging seam (content scripts, options, popup). */
export interface MessageTransport {
  send(message: unknown): Promise<unknown>;
}

/** Host half of the messaging seam (background only). */
export interface MessageServer {
  serve(handler: MessageHandler): void;
}

/** Blob persistence for file bytes (SPEC §6.2: IndexedDB in the background context). */
export interface BlobStoreAdapter {
  put(key: string, blob: Blob): Promise<void>;
  get(key: string): Promise<Blob | undefined>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export interface InjectionResult {
  frameId: number;
  ok: boolean;
  error?: string;
}

/** A persistent content-script registration (SPEC §8.4.4 / §8.5 auto-run). */
export interface RegisteredScript {
  id: string;
  matches: string[];
  js: string[];
  allFrames: boolean;
  runAt: 'document_idle';
  persistAcrossSessions: boolean;
}

/** Content-script injection (SPEC §8.4). */
export interface ScriptingAdapter {
  executeScript(opts: {
    tabId: number;
    allFrames?: boolean;
    files: string[];
  }): Promise<InjectionResult[]>;
  registerContentScripts(scripts: RegisteredScript[]): Promise<void>;
  /** Atomic in-place update — no unregister/register gap a process kill could fall into. */
  updateContentScripts(scripts: RegisteredScript[]): Promise<void>;
  unregisterContentScripts(ids: string[]): Promise<void>;
  getRegisteredContentScripts(): Promise<RegisteredScript[]>;
}

/** Granted optional permissions — drives auto-run registration (SPEC §8.5). */
export interface PermissionsAdapter {
  getAll(): Promise<{ origins: string[] }>;
  onAdded(cb: (origins: string[]) => void): void;
  onRemoved(cb: (origins: string[]) => void): void;
}

/** Extension-level events and helpers the background needs. */
export interface RuntimeAdapter {
  getURL(path: string): string;
  onCommand(cb: (command: string, tabId: number | undefined) => void): void;
  /** Fires only when no default_popup is set; kept for parity and future use. */
  onActionClicked(cb: (tabId: number) => void): void;
  /** Opens the extension's options page (SPEC §8.1). */
  openOptionsPage(): Promise<void>;
}

/** Everything the background is allowed to reach the browser through. */
export interface BackgroundEnv {
  storage: StorageAdapter;
  blobs: BlobStoreAdapter;
  server: MessageServer;
  scripting: ScriptingAdapter;
  runtime: RuntimeAdapter;
  /** Optional: harness/demo environments run without a permissions surface. */
  permissions?: PermissionsAdapter;
}
