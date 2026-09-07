/**
 * Rung 5 (SPEC §8.5) — Android-path behaviors, exercised with the standard harness
 * technique. Real-device checks run over Tailscale adb (docs/ANDROID_TESTING.md); these
 * cover the parts Playwright can: affordance mode, and (in later tests) the mobile-viewport
 * overlay render and the popup injection path.
 */
import { expect, test } from '@playwright/test';
import { injectContentBundle, waitForOverlay } from './helpers.js';

test.describe('auto-run affordance mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/plain-form.html');
    // The flag stands in for arriving via the registered content-auto.js bundle.
    await page.evaluate(() => {
      window.__jobfillHarnessAutoRun = true;
    });
    await injectContentBundle(page);
  });

  test('auto-injection shows only a quiet chip — no scan, no bar, no badges', async ({ page }) => {
    await page.waitForFunction(() =>
      window.__jobfillHarness?.shadow.querySelector('[data-jf="chip"]'),
    );
    const state = await page.evaluate(() => {
      const shadow = window.__jobfillHarness!.shadow;
      const chip = shadow.querySelector<HTMLElement>('[data-jf="chip"]')!;
      const rect = chip.getBoundingClientRect();
      return {
        chipText: chip.textContent,
        chipHeight: rect.height,
        barHidden: shadow.querySelector<HTMLElement>('.jf-bar')!.hidden,
        barText: shadow.querySelector('.jf-bar')!.textContent,
        badgeCount: shadow.querySelectorAll('[data-jf-badge]').length,
      };
    });
    expect(state.chipText).toContain('jobfill');
    expect(state.chipHeight).toBeGreaterThanOrEqual(44); // touch target
    expect(state.barHidden).toBe(true);
    expect(state.barText).toBe('');
    expect(state.badgeCount).toBe(0);
  });

  test('tapping the chip upgrades to the full bar and filling works end to end', async ({
    page,
  }) => {
    await page.waitForFunction(() =>
      window.__jobfillHarness?.shadow.querySelector('[data-jf="chip"]'),
    );
    await page.evaluate(() => {
      window.__jobfillHarness!.shadow.querySelector<HTMLButtonElement>('[data-jf="chip"]')!.click();
    });
    await waitForOverlay(page);
    const chipGone = await page.evaluate(
      () => window.__jobfillHarness!.shadow.querySelector('[data-jf="chip"]') === null,
    );
    expect(chipGone).toBe(true);

    // The upgraded session is the real thing: fill-all fills the form.
    await page.evaluate(() => {
      window
        .__jobfillHarness!.shadow.querySelector<HTMLButtonElement>('[data-jf="fill-all"]')!
        .click();
    });
    await expect(page.locator('#first_name')).toHaveValue('Maya');
    expect(await page.evaluate(() => (window as { __submitted?: boolean }).__submitted)).toBe(
      false,
    );
  });
});
