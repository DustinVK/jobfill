/**
 * Popup e2e harness entrypoint (dist-harness/popup.dev.js, never shipped). The real popup
 * App over a mock env whose fillPage ACTUALLY injects the content harness bundle into this
 * very page — proving the popup → executeScript → overlay loop end to end (SPEC §8.5: on
 * Android the popup is the only invocation surface).
 */
import { render } from 'preact';
import { App, type PopupEnv } from './App.js';

declare global {
  interface Window {
    __popupHarness?: {
      closed: boolean;
      permissionRequests: string[];
      optionsOpened: boolean;
    };
  }
}

const record: NonNullable<Window['__popupHarness']> = {
  closed: false,
  permissionRequests: [],
  optionsOpened: false,
};
window.__popupHarness = record;

function injectContentHarness(): Promise<boolean> {
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = '/content.harness.js';
    script.addEventListener('load', () => resolve(Boolean(window.__jobfillHarness)));
    script.addEventListener('error', () => resolve(false));
    document.head.append(script);
  });
}

const env: PopupEnv = {
  async getActiveTab() {
    return { id: 1, url: 'https://jobs.example.com/apply' };
  },
  fillPage() {
    return injectContentHarness();
  },
  async hasSitePermission() {
    return false;
  },
  async requestSitePermission(url) {
    record.permissionRequests.push(url);
    return true;
  },
  async removeSitePermission() {
    return true;
  },
  async openOptions() {
    record.optionsOpened = true;
  },
  close() {
    record.closed = true; // window.close() is a no-op on a plain tab — record instead
  },
  isTouch: window.matchMedia('(pointer: coarse)').matches,
};

const root = document.getElementById('app');
if (root) render(<App env={env} />, root);
