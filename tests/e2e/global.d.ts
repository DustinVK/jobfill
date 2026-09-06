import type { HarnessHandle } from '../../src/content/harness-entry.js';

declare global {
  interface Window {
    __jobfillHarness?: HarnessHandle;
    /** Harness pages record page-side events here so tests assert observable effects. */
    __eventLog?: { type: string; target: string; value?: string }[];
  }
}

export {};
