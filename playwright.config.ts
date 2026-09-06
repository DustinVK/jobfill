import { defineConfig } from '@playwright/test';

/**
 * Playwright cannot load a WebExtension into Firefox (OVERNIGHT_PLAN §7). We do not try.
 * Harness pages are plain localhost pages; tests inject the built content bundle wired to
 * the in-memory adapters, exercising scanner → classifier → overlay → fillers as shipped.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  // The visual-QA capture spec is opt-in (`npm run shots`) — never part of the e2e gate.
  testIgnore: process.env.SHOTS ? [] : ['**/screenshots.spec.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'list' : [['list']],
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:5178',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'firefox', use: { browserName: 'firefox' } }],
  webServer: {
    command: 'PORT=5178 node scripts/dev-server.mjs',
    url: 'http://localhost:5178/index.html',
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
  },
});
