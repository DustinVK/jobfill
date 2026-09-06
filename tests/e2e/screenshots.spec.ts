/**
 * Visual-QA capture harness (`npm run shots`). NOT part of the regular e2e gate — the
 * playwright config ignores this spec unless SHOTS=1.
 *
 * Same technique as every other e2e here: harness pages + the real content bundle wired to
 * mock adapters and a seeded vault (Playwright cannot load a Firefox extension; these are
 * harness renders of the shipped overlay). The closed-shadow-root hook is the existing
 * test-only `window.__jobfillHarness` handle — production keeps the root closed.
 *
 * Adding a future feature = append a block to FEATURES below; the loops handle
 * light/dark × full-page/clip capture and the contact sheet picks new PNGs up by scan.
 */
import { test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { injectContentBundle, waitForOverlay } from './helpers.js';

const SHOT_ROOT = fileURLToPath(new URL('../../docs/screenshots/', import.meta.url));

// ---------------------------------------------------------------------------
// Palette drive helpers — the same shadow-handle moves the palette e2e uses.
// ---------------------------------------------------------------------------

async function openPalette(page: Page): Promise<void> {
  await page.evaluate(() => {
    window
      .__jobfillHarness!.shadow.querySelector<HTMLButtonElement>('[data-jf="palette"]')!
      .click();
  });
  await page.waitForFunction(() =>
    window.__jobfillHarness?.shadow.querySelector('[data-jf="palette-dialog"]'),
  );
  // Initial empty-query search lands.
  await page.waitForFunction(
    () =>
      (window.__jobfillHarness?.shadow.querySelectorAll('[data-jf="palette-results"] .jf-option')
        .length ?? 0) > 0,
  );
}

async function typeQuery(page: Page, query: string): Promise<void> {
  await page.evaluate((q) => {
    const input = window.__jobfillHarness!.shadow.querySelector<HTMLInputElement>(
      '[data-jf="palette-search"]',
    )!;
    input.focus();
    input.value = q;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, query);
  await page.waitForTimeout(300); // debounce (80ms) + round-trip + render
}

async function clickCategory(page: Page, id: string): Promise<void> {
  await page.evaluate((catId) => {
    window
      .__jobfillHarness!.shadow.querySelector<HTMLButtonElement>(`[data-jf-cat="${catId}"]`)!
      .click();
  }, id);
  await page.waitForTimeout(120);
}

async function focusResult(page: Page, downPresses: number): Promise<void> {
  await page.evaluate((presses) => {
    const palette = window.__jobfillHarness!.shadow.querySelector<HTMLElement>(
      '[data-jf="palette-dialog"]',
    )!;
    for (let i = 0; i < presses; i++) {
      palette.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, composed: true }),
      );
    }
  }, downPresses);
  await page.waitForTimeout(120);
}

// ---------------------------------------------------------------------------
// Feature blocks — append here to capture a future feature.
// ---------------------------------------------------------------------------

interface ShotState {
  /** kebab-case; becomes part of the filename. */
  name: string;
  drive: (page: Page) => Promise<void>;
  /** Shadow-root selector for the tight clip (phone-legible). */
  clipSelector: string;
}

interface Feature {
  name: string;
  page: string;
  states: ShotState[];
}

const FEATURES: Feature[] = [
  {
    name: 'palette',
    page: '/plain-form.html',
    states: [
      {
        name: 'open-empty-query',
        clipSelector: '[data-jf="palette-dialog"]',
        drive: async (page) => {
          await openPalette(page);
        },
      },
      {
        name: 'query-typed-results',
        clipSelector: '[data-jf="palette-dialog"]',
        drive: async (page) => {
          await openPalette(page);
          await typeQuery(page, 'routing');
        },
      },
      {
        name: 'category-menu-open-work',
        clipSelector: '[data-jf="palette-dialog"]',
        drive: async (page) => {
          await openPalette(page);
          await clickCategory(page, 'work');
        },
      },
      {
        name: 'menu-item-focused',
        clipSelector: '[data-jf="palette-dialog"]',
        drive: async (page) => {
          await openPalette(page);
          await clickCategory(page, 'work');
          await focusResult(page, 2);
        },
      },
      {
        name: 'no-results-save-offer',
        clipSelector: '[data-jf="palette-dialog"]',
        drive: async (page) => {
          await openPalette(page);
          await typeQuery(page, 'zzqxvblorp');
        },
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Capture loops: theme × state × (full page + clip).
// ---------------------------------------------------------------------------

for (const theme of ['light', 'dark'] as const) {
  for (const feature of FEATURES) {
    test.describe(`${feature.name} shots (${theme})`, () => {
      test.use({ colorScheme: theme, viewport: { width: 1280, height: 800 } });

      for (const state of feature.states) {
        test(`${state.name} [${theme}]`, async ({ page }) => {
          await page.goto(feature.page);
          await injectContentBundle(page);
          await waitForOverlay(page);
          await state.drive(page);
          await page.waitForTimeout(150); // paint settle

          const dir = `${SHOT_ROOT}${feature.name}`;
          mkdirSync(dir, { recursive: true });
          const base = `${dir}/${state.name}-${theme}`;

          await page.screenshot({ path: `${base}-full.png` });

          const rect = await page.evaluate((selector) => {
            const el = window.__jobfillHarness!.shadow.querySelector(selector)!;
            const r = el.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height };
          }, state.clipSelector);
          const pad = 8;
          await page.screenshot({
            path: `${base}-clip.png`,
            clip: {
              x: Math.max(0, rect.x - pad),
              y: Math.max(0, rect.y - pad),
              width: Math.min(1280, rect.width + pad * 2),
              height: Math.min(800, rect.height + pad * 2),
            },
          });
        });
      }
    });
  }
}
