/**
 * Minimal ambient typing for the slice of the WebExtension API this extension uses.
 *
 * Hand-written on purpose: `@types/firefox-webext-browser` is not in the approved dependency
 * set, and a narrow declaration doubles as documentation of exactly which browser surface
 * we depend on. Anything not declared here is, by construction, not used.
 */
declare namespace browser {
  namespace runtime {
    const id: string;
    const lastError: { message?: string } | undefined;
    function getURL(path: string): string;
    function openOptionsPage(): Promise<void>;
    function sendMessage(message: unknown): Promise<unknown>;
    const onMessage: {
      addListener(
        cb: (
          message: unknown,
          sender: {
            tab?: { id?: number; url?: string };
            frameId?: number;
            origin?: string;
            url?: string;
          },
        ) => Promise<unknown> | true | undefined,
      ): void;
    };
  }

  namespace storage {
    interface StorageAreaApi {
      get(key: string | string[] | null): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(key: string | string[]): Promise<void>;
    }
    const local: StorageAreaApi;
    const session: StorageAreaApi;
  }

  namespace scripting {
    function executeScript(injection: {
      target: { tabId: number; allFrames?: boolean };
      files: string[];
    }): Promise<{ frameId: number; result?: unknown; error?: unknown }[]>;
  }

  namespace commands {
    const onCommand: {
      addListener(cb: (command: string, tab?: { id?: number }) => void): void;
    };
  }

  namespace action {
    const onClicked: {
      addListener(cb: (tab: { id?: number }) => void): void;
    };
  }

  namespace tabs {
    function query(q: {
      active: boolean;
      currentWindow: boolean;
    }): Promise<{ id?: number; url?: string; title?: string }[]>;
  }

  namespace permissions {
    function request(p: { origins?: string[]; permissions?: string[] }): Promise<boolean>;
    function remove(p: { origins?: string[]; permissions?: string[] }): Promise<boolean>;
    function getAll(): Promise<{ origins?: string[]; permissions?: string[] }>;
  }
}

/** FF-only: content scripts see the page compartment through this (SPEC §7.5). */
interface Window {
  wrappedJSObject?: {
    DataTransfer?: new () => DataTransfer;
  };
}

interface Element {
  /** FF-only: reaches closed shadow roots (SPEC §7.1). Chrome has an equivalent for a future port. */
  openOrClosedShadowRoot?: ShadowRoot | null;
}
