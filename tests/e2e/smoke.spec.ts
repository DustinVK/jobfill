import { expect, test } from '@playwright/test';
import { injectContentBundle } from './helpers.js';

test('content bundle mounts its overlay on an arbitrary page', async ({ page }) => {
  await page.goto('/blank.html');
  await injectContentBundle(page);

  // The overlay host is page-observable; its contents are not (closed shadow root).
  await expect(page.locator('#jobfill-overlay-host')).toHaveCount(1);
  const shadowRootIsClosed = await page.evaluate(
    () => document.getElementById('jobfill-overlay-host')?.shadowRoot === null,
  );
  expect(shadowRootIsClosed).toBe(true);

  const barPresent = await page.evaluate(() =>
    Boolean(window.__jobfillHarness?.shadow.querySelector('.jf-bar')),
  );
  expect(barPresent).toBe(true);
});

test('re-injection is idempotent — one overlay host, one session', async ({ page }) => {
  await page.goto('/blank.html');
  await injectContentBundle(page);
  await injectContentBundle(page);
  await expect(page.locator('#jobfill-overlay-host')).toHaveCount(1);
});

test('the harness client reaches the background router', async ({ page }) => {
  await page.goto('/blank.html');
  await injectContentBundle(page);
  const pong = await page.evaluate(async () => {
    const handle = window.__jobfillHarness;
    if (!handle) return null;
    return handle.session.client.send({ t: 'ping' });
  });
  expect(pong).toMatchObject({ pong: true });
});
