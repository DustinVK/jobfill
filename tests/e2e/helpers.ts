import type { Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const BUNDLE = fileURLToPath(new URL('../../dist-harness/content.harness.js', import.meta.url));

/**
 * Injects the built harness bundle via a script tag. Known gap vs. a real extension: this
 * runs in the PAGE world, not the content-script sandbox — the `openOrClosedShadowRoot` and
 * `wrappedJSObject` branches cannot be exercised here and are flagged for manual QA
 * (OVERNIGHT_PLAN §7).
 */
export async function injectContentBundle(page: Page): Promise<void> {
  await page.addScriptTag({ path: BUNDLE });
  await page.waitForFunction(() => Boolean(window.__jobfillHarness));
}

/** Injected overlay is up: bar rendered and the initial scan/compose round-trip settled. */
export async function waitForOverlay(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const shadow = window.__jobfillHarness?.shadow;
    return Boolean(shadow?.querySelector('.jf-bar')?.textContent);
  });
}
