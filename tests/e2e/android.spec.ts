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

test.describe('popup "Fill this page" injection path', () => {
  test('the real popup App injects the bundle and the overlay comes up on the page', async ({
    page,
  }) => {
    await page.goto('/popup-dev.html');
    const fillButton = page.locator('[data-testid="fill-page"]');
    await expect(fillButton).toBeEnabled();
    await fillButton.click();
    // The mock env's fillPage loaded the content harness into this page — full loop.
    await waitForOverlay(page);
    const closed = await page.evaluate(() => window.__popupHarness?.closed);
    expect(closed).toBe(true);
    // The injected session is live: fill-all fills the page's form.
    await page.evaluate(() => {
      window
        .__jobfillHarness!.shadow.querySelector<HTMLButtonElement>('[data-jf="fill-all"]')!
        .click();
    });
    await expect(page.locator('#first_name')).toHaveValue('Maya');
  });

  test('"Always run on this site" flows through the permission request', async ({ page }) => {
    await page.goto('/popup-dev.html');
    const autoRun = page.locator('[data-testid="auto-run"]');
    await expect(autoRun).toContainText('Always run on jobs.example.com');
    await autoRun.click();
    await expect(autoRun).toContainText('Auto-runs on jobs.example.com');
    const record = await page.evaluate(() => window.__popupHarness);
    expect(record?.permissionRequests).toEqual(['https://jobs.example.com/apply']);
    // A fresh grant shows the chip on the already-open page (no reload needed).
    expect(record?.affordanceShown).toBe(true);
  });
});

test.describe('mobile-viewport overlay render (Pixel-ish, touch)', () => {
  test.use({ viewport: { width: 393, height: 745 }, hasTouch: true });

  test.beforeEach(async ({ page }) => {
    await page.goto('/plain-form.html');
    await injectContentBundle(page);
    await waitForOverlay(page);
    // hasTouch flips navigator.maxTouchPoints in the harness browser; if this engine build
    // doesn't emulate it, force the class — the detection branch is exercised on-device.
    await page.evaluate(() => {
      window.__jobfillHarness!.shadow.querySelector('.jf-layer')!.classList.add('jf-touch');
    });
  });

  test('fill bar fits the phone viewport with ≥44px touch targets', async ({ page }) => {
    const bar = await page.evaluate(() => {
      const shadow = window.__jobfillHarness!.shadow;
      const rect = shadow.querySelector('.jf-bar')!.getBoundingClientRect();
      const targets = [...shadow.querySelectorAll<HTMLElement>('.jf-bar .jf-btn, .jf-bar select')]
        .filter((n) => n.offsetParent !== null || n.getBoundingClientRect().height > 0)
        .map((n) => ({
          label: n.textContent?.slice(0, 12) ?? n.tagName,
          height: n.getBoundingClientRect().height,
        }));
      return { left: rect.left, right: rect.right, targets };
    });
    expect(bar.left).toBeGreaterThanOrEqual(0);
    expect(bar.right).toBeLessThanOrEqual(393);
    expect(bar.targets.length).toBeGreaterThan(0);
    for (const target of bar.targets) {
      expect(target.height, `target "${target.label}"`).toBeGreaterThanOrEqual(44);
    }
  });

  test('palette fits the viewport, rows are touch-sized, and tracks --jf-vvh (keyboard)', async ({
    page,
  }) => {
    await page.evaluate(() => {
      window
        .__jobfillHarness!.shadow.querySelector<HTMLButtonElement>('[data-jf="palette"]')!
        .click();
    });
    await page.waitForFunction(
      () =>
        (window.__jobfillHarness?.shadow.querySelectorAll('[data-jf="palette-results"] .jf-option')
          .length ?? 0) > 0,
    );
    const palette = await page.evaluate(() => {
      const shadow = window.__jobfillHarness!.shadow;
      const rect = shadow.querySelector('[data-jf="palette-dialog"]')!.getBoundingClientRect();
      const rows = [...shadow.querySelectorAll<HTMLElement>('.jf-option, .jf-cat')].map(
        (n) => n.getBoundingClientRect().height,
      );
      return { left: rect.left, right: rect.right, rows };
    });
    expect(palette.left).toBeGreaterThanOrEqual(0);
    expect(palette.right).toBeLessThanOrEqual(393);
    for (const height of palette.rows) expect(height).toBeGreaterThanOrEqual(44);

    // Simulate the on-screen keyboard: the vv var shrinks → the palette must follow.
    const squeezed = await page.evaluate(() => {
      const shadow = window.__jobfillHarness!.shadow;
      const layer = shadow.querySelector<HTMLElement>('.jf-layer')!;
      layer.style.setProperty('--jf-vvh', '320px');
      const rect = shadow.querySelector('[data-jf="palette-dialog"]')!.getBoundingClientRect();
      return { height: rect.height, top: rect.top };
    });
    expect(squeezed.height).toBeLessThanOrEqual(320 * 0.84 + 1);
    expect(squeezed.top).toBeCloseTo(320 * 0.08, 0);
  });
});
