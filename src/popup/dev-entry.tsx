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
      affordanceShown: boolean;
    };
  }
}

const record: NonNullable<Window['__popupHarness']> = {
  closed: false,
  permissionRequests: [],
  optionsOpened: false,
  affordanceShown: false,
};
window.__popupHarness = record;

let granted = false; // stateful permission backing for the harness

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
    return granted;
  },
  async requestSitePermission(url) {
    record.permissionRequests.push(url);
    granted = true;
    return true;
  },
  async removeSitePermission() {
    granted = false;
    return true;
  },
  async showAffordance() {
    record.affordanceShown = true;
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
