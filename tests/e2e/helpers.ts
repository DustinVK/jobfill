import type { Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const BUNDLE = fileURLToPath(new URL('../../dist-harness/content.harness.js', import.meta.url));

/**
 * Injects the built content bundle into the page, the way `scripting.executeScript` would.
 * The bundle is an IIFE with no exports, so a plain script tag is a faithful stand-in.
 */
export async function injectContentBundle(page: Page): Promise<void> {
  await page.addScriptTag({ path: BUNDLE });
  await page.waitForFunction(() => Boolean(window.__jobfillHarness));
}
