/**
 * Popup entrypoint — one of the few files allowed to name `browser` directly (CLAUDE.md
 * seam): it builds the PopupEnv from real APIs and hands it to the adapter-agnostic App.
 */
import { render } from 'preact';
import { createBrowserScripting } from '../shared/adapters/browser.js';
import { CONTENT_FILES } from '../background/invoke.js';
import { App, type PopupEnv } from './App.js';

const scripting = createBrowserScripting();

/** Single-origin match pattern for optional host permission (SPEC §8.2). */
function originPattern(url: string): string {
  const u = new URL(url);
  return `${u.protocol}//${u.host}/*`;
}

const env: PopupEnv = {
  async getActiveTab() {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    return tab;
  },
  fillPage(tabId) {
    // The toolbar click that opened this popup granted activeTab for that tab. Called
    // synchronously from the button gesture (SPEC §8.5).
    return scripting
      .executeScript({ tabId, allFrames: true, files: CONTENT_FILES })
      .then((results) => results.some((r) => r.ok));
  },
  hasSitePermission(url) {
    return browser.permissions.contains({ origins: [originPattern(url)] });
  },
  requestSitePermission(url) {
    // Must be reached synchronously from the gesture — see App.tsx.
    return browser.permissions.request({ origins: [originPattern(url)] });
  },
  removeSitePermission(url) {
    return browser.permissions.remove({ origins: [originPattern(url)] });
  },
  async openOptions() {
    await browser.runtime.openOptionsPage();
  },
  close() {
    window.close();
  },
  // FF-only nuance either way: coarse pointer = Android (full-window popup, no shortcuts).
  isTouch: window.matchMedia('(pointer: coarse)').matches,
};

const root = document.getElementById('app');
if (root) render(<App env={env} />, root);
