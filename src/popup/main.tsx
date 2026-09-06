/**
 * Popup entrypoint — one of the few files allowed to name `browser` directly (CLAUDE.md
 * seam): it builds the PopupEnv from real APIs and hands it to the adapter-agnostic App.
 */
import { render } from 'preact';
import { createBrowserScripting } from '../shared/adapters/browser.js';
import { CONTENT_FILES } from '../background/invoke.js';
import { App, type PopupEnv } from './App.js';

const scripting = createBrowserScripting();

const env: PopupEnv = {
  async getActiveTab() {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    return tab;
  },
  async fillPage(tabId) {
    // The toolbar click that opened this popup granted activeTab for that tab.
    const results = await scripting.executeScript({
      tabId,
      allFrames: true,
      files: CONTENT_FILES,
    });
    return results.some((r) => r.ok);
  },
  async openOptions() {
    await browser.runtime.openOptionsPage();
  },
  close() {
    window.close();
  },
};

const root = document.getElementById('app');
if (root) render(<App env={env} />, root);
