import { expect, test, type Page } from '@playwright/test';
import { injectContentBundle } from './helpers.js';

/**
 * Fill-engine e2e (DoD-2): the shipped scanner → classifier → overlay → filler pipeline
 * against harness pages, asserting page-observable effects — values landing, page-side
 * event listeners firing, React state updating, undo restoring, deny-list holding.
 */

/** Clicks a button inside the closed shadow root via the harness handle. */
async function clickOverlay(page: Page, selector: string): Promise<void> {
  const clicked = await page.evaluate((sel) => {
    const shadow = window.__jobfillHarness?.shadow;
    const btn = shadow?.querySelector<HTMLButtonElement>(sel);
    if (!btn) return false;
    btn.click();
    return true;
  }, selector);
  expect(clicked, `overlay control ${selector} present`).toBe(true);
}

async function waitForFillBar(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    Boolean(window.__jobfillHarness?.shadow.querySelector('[data-jf="fill-all"], .jf-bar')),
  );
  // Let compose round-trips settle.
  await page.waitForFunction(() => {
    const shadow = window.__jobfillHarness?.shadow;
    return Boolean(shadow?.querySelector('.jf-bar')?.textContent);
  });
}

test.describe('plain form', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/plain-form.html');
    await injectContentBundle(page);
    await waitForFillBar(page);
    await page.waitForFunction(() =>
      window.__jobfillHarness?.shadow.querySelector('[data-jf="fill-all"]'),
    );
  });

  test('fill-all lands correct values and page listeners observe input/change', async ({
    page,
  }) => {
    await clickOverlay(page, '[data-jf="fill-all"]');

    await expect(page.locator('#first_name')).toHaveValue('Maya');
    await expect(page.locator('#last_name')).toHaveValue('Okafor');
    await expect(page.locator('#email')).toHaveValue('maya.okafor@example.com');
    await expect(page.locator('#phone')).toHaveValue('(616) 555-0142');
    await expect(page.locator('#city')).toHaveValue('Grand Rapids');
    await expect(page.locator('#zip')).toHaveValue('49503');
    await expect(page.locator('#linkedin')).toHaveValue(/linkedin\.com/);
    await expect(page.locator('#company')).toHaveValue('Harbor Freight Logistics');
    await expect(page.locator('#title')).toHaveValue('Senior Software Engineer');

    // Page-side listeners observed the events (not just value mutation).
    const log = await page.evaluate(() => window.__eventLog ?? []);
    const inputEvents = log.filter((e) => e.type === 'input').map((e) => e.target);
    expect(inputEvents).toContain('first_name');
    expect(inputEvents).toContain('email');
    const changeEvents = log.filter((e) => e.type === 'change').map((e) => e.target);
    expect(changeEvents).toContain('first_name');
  });

  test('deny-listed password field is untouched by fill-all; nothing submits', async ({ page }) => {
    await clickOverlay(page, '[data-jf="fill-all"]');
    await expect(page.locator('#password')).toHaveValue('');
    const submitted = await page.evaluate(() => (window as { __submitted?: boolean }).__submitted);
    expect(submitted).toBe(false);
    // And the password field never even gets a badge.
    const badges = await page.evaluate(() =>
      [...(window.__jobfillHarness?.shadow.querySelectorAll('[data-jf-badge]') ?? [])].map((b) =>
        b.getAttribute('data-jf-badge'),
      ),
    );
    expect(badges.join(',')).not.toContain('password');
  });

  test('question fields (sponsorship radio, authorization select) are suggest-tier and review fills them correctly', async ({
    page,
  }) => {
    // Radios/questions never fill-all; they go through review (confirm-first).
    await clickOverlay(page, '[data-jf="fill-all"]');
    await expect(page.locator('#sponsor-no')).not.toBeChecked();
    await expect(page.locator('#sponsor-yes')).not.toBeChecked();

    // Step through review, accepting each proposal with the Fill button.
    await clickOverlay(page, '[data-jf="review"]');
    for (let i = 0; i < 6; i++) {
      const hasPopover = await page.evaluate(() =>
        Boolean(window.__jobfillHarness?.shadow.querySelector('[data-jf="popover"]')),
      );
      if (!hasPopover) break;
      await clickOverlay(page, '[data-jf="popover-fill"]');
      await page.waitForTimeout(80);
    }

    // The sponsorship answer is FALSE in the sample vault → the "No, I will not…" radio.
    await expect(page.locator('#sponsor-no')).toBeChecked();
    await expect(page.locator('#sponsor-yes')).not.toBeChecked();
    // The authorization answer is TRUE → "Yes" option.
    await expect(page.locator('#authorized')).toHaveValue('Yes');
  });

  test('undo restores all touched fields to their priors', async ({ page }) => {
    await page.locator('#first_name').fill('PreExisting');
    await clickOverlay(page, '[data-jf="fill-all"]');
    await expect(page.locator('#first_name')).toHaveValue('Maya');
    await expect(page.locator('#email')).toHaveValue('maya.okafor@example.com');

    await clickOverlay(page, '[data-jf="undo"]');
    await expect(page.locator('#first_name')).toHaveValue('PreExisting');
    await expect(page.locator('#email')).toHaveValue('');
  });

  test('the version switcher lists all versions and switching re-proposes fields', async ({
    page,
  }) => {
    // Sample vault has 3 versions → the compact switcher renders (single-version vaults get nothing).
    const options = await page.evaluate(() => {
      const select = window.__jobfillHarness!.shadow.querySelector<HTMLSelectElement>(
        '[data-jf="version-select"]',
      );
      // Display text truncates at 22 chars; the option title keeps the full name.
      return select ? [...select.options].map((o) => o.title) : null;
    });
    expect(options).toContain('Everything / impact-first');
    expect(options).toContain('Responsibilities (gov/Workday)');

    // Switch to the responsibilities version: the summary proposal changes phrasing.
    await page.evaluate(() => {
      const select = window.__jobfillHarness!.shadow.querySelector<HTMLSelectElement>(
        '[data-jf="version-select"]',
      )!;
      const target = [...select.options].find((o) => o.text.startsWith('Responsibilities'))!;
      select.value = target.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForFunction(() => {
      const entry = window.__jobfillHarness!.session.session.current.entries.find(
        (e) => e.field.element.id === 'summary',
      );
      return entry?.value?.value?.includes('Responsible for') ?? false;
    });
  });

  test('fill-all runs top-to-bottom and a second pass has nothing left to do', async ({ page }) => {
    await clickOverlay(page, '[data-jf="fill-all"]');
    await expect(page.locator('#first_name')).toHaveValue('Maya');
    await expect(page.locator('#title')).toHaveValue('Senior Software Engineer');
    // Every proposed value is on the page now — the button must be gone, not offering a
    // phantom second pass.
    await page.waitForFunction(
      () => !window.__jobfillHarness?.shadow.querySelector('[data-jf="fill-all"]'),
    );
    // And even after a forced rescan (entries rebuilt from scratch), still nothing to fill.
    await page.evaluate(() => window.__jobfillHarness!.session.session.refresh(document));
    await page.waitForFunction(
      () =>
        (window.__jobfillHarness?.session.session.current.entries.length ?? 0) > 0 &&
        !window.__jobfillHarness?.shadow.querySelector('[data-jf="fill-all"]'),
    );
  });
});

test.describe('React 18 controlled form', () => {
  test('fill updates React STATE, not just the DOM value', async ({ page }) => {
    await page.goto('/react-form.html');
    await page.waitForSelector('#r-first');
    await injectContentBundle(page);
    await waitForFillBar(page);
    await page.waitForFunction(() =>
      window.__jobfillHarness?.shadow.querySelector('[data-jf="fill-all"]'),
    );
    await clickOverlay(page, '[data-jf="fill-all"]');

    await expect(page.locator('#r-first')).toHaveValue('Maya');
    // The rendered state mirror proves React's onChange ran and setState committed.
    const mirror = page.locator('#state-mirror');
    await expect(mirror).toContainText('"firstName":"Maya"');
    await expect(mirror).toContainText('"lastName":"Okafor"');
    await expect(mirror).toContainText('"email":"maya.okafor@example.com"');
  });

  test('undo on a controlled form restores React state too', async ({ page }) => {
    await page.goto('/react-form.html');
    await page.waitForSelector('#r-first');
    await injectContentBundle(page);
    await waitForFillBar(page);
    await clickOverlay(page, '[data-jf="fill-all"]');
    await expect(page.locator('#state-mirror')).toContainText('"firstName":"Maya"');
    await clickOverlay(page, '[data-jf="undo"]');
    await expect(page.locator('#state-mirror')).toContainText('"firstName":""');
  });
});

test.describe('late-mounting SPA form', () => {
  test('the settle re-scan picks up fields that mount after injection', async ({ page }) => {
    await page.goto('/late-mount.html');
    // Inject BEFORE the form exists (mounts at 600 ms).
    await injectContentBundle(page);
    const early = await page.evaluate(
      () => window.__jobfillHarness?.session.session.current.entries.length ?? -1,
    );
    expect(early).toBe(0);

    // After mount + MutationObserver settle, the re-scan finds the fields.
    await page.waitForFunction(
      () => (window.__jobfillHarness?.session.session.current.entries.length ?? 0) >= 3,
      undefined,
      { timeout: 5000 },
    );
    await page.waitForFunction(() =>
      window.__jobfillHarness?.shadow.querySelector('[data-jf="fill-all"]'),
    );
    await clickOverlay(page, '[data-jf="fill-all"]');
    await expect(page.locator('#first_name')).toHaveValue('Maya');
    await expect(page.locator('#email')).toHaveValue('maya.okafor@example.com');
  });
});

test.describe('shadow DOM form', () => {
  test('fields inside an open shadow root are scanned and filled', async ({ page }) => {
    await page.goto('/shadow-form.html');
    await injectContentBundle(page);
    await page.waitForFunction(
      () => (window.__jobfillHarness?.session.session.current.entries.length ?? 0) >= 3,
    );
    await page.waitForFunction(() =>
      window.__jobfillHarness?.shadow.querySelector('[data-jf="fill-all"]'),
    );
    await clickOverlay(page, '[data-jf="fill-all"]');

    // Fill-all paces itself (scroll + beat per field) — poll until both land.
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const root = document.getElementById('host')?.shadowRoot;
          return {
            first: root?.querySelector<HTMLInputElement>('#s-first')?.value,
            email: root?.querySelector<HTMLInputElement>('#s-email')?.value,
          };
        }),
      )
      .toEqual({ first: 'Maya', email: 'maya.okafor@example.com' });

    // Shadow-side listeners observed the events.
    const log = await page.evaluate(() => window.__eventLog ?? []);
    expect(log.some((e) => e.target === 's-first' && e.type === 'input')).toBe(true);
  });
});

test.describe('same-origin iframe form', () => {
  test('a bundle injected into the frame fills the framed form', async ({ page }) => {
    await page.goto('/iframe-form.html');
    // Model allFrames injection: the content bundle runs inside the iframe document too.
    const frame = page.frame({ url: /iframe-inner/ });
    expect(frame).not.toBeNull();
    await frame!.waitForSelector('#i-first');
    const { fileURLToPath } = await import('node:url');
    const bundle = fileURLToPath(new URL('../../dist-harness/content.harness.js', import.meta.url));
    await frame!.addScriptTag({ path: bundle });
    await frame!.waitForFunction(() => Boolean(window.__jobfillHarness));
    await frame!.waitForFunction(() =>
      window.__jobfillHarness?.shadow.querySelector('[data-jf="fill-all"]'),
    );
    await frame!.evaluate(() => {
      const btn =
        window.__jobfillHarness?.shadow.querySelector<HTMLButtonElement>('[data-jf="fill-all"]');
      btn?.click();
    });
    await expect(frame!.locator('#i-first')).toHaveValue('Maya');
    await expect(frame!.locator('#i-email')).toHaveValue('maya.okafor@example.com');
  });
});

test.describe('palette', () => {
  test('fills the focused field from search results', async ({ page }) => {
    await page.goto('/plain-form.html');
    await injectContentBundle(page);
    await waitForFillBar(page);

    await page.locator('#summary').click();
    await clickOverlay(page, '[data-jf="palette"]');
    await page.waitForFunction(() =>
      window.__jobfillHarness?.shadow.querySelector('[data-jf="palette-search"]'),
    );
    // Type into the palette search inside the closed shadow root.
    await page.evaluate(() => {
      const shadow = window.__jobfillHarness!.shadow;
      const input = shadow.querySelector<HTMLInputElement>('[data-jf="palette-search"]');
      input!.focus();
      input!.value = 'routing engine';
      input!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForFunction(
      () =>
        (window.__jobfillHarness?.shadow.querySelectorAll('[data-jf="palette-results"] .jf-option')
          .length ?? 0) > 0,
    );
    await page.evaluate(() => {
      const shadow = window.__jobfillHarness!.shadow;
      shadow.querySelector<HTMLButtonElement>('[data-jf="palette-results"] .jf-option')?.click();
    });
    await expect(page.locator('#summary')).toHaveValue(/routing engine/i);
  });
});

test.describe('palette safety (rung-2 review P0-2)', () => {
  test('the palette refuses to fill a focused password field', async ({ page }) => {
    await page.goto('/plain-form.html');
    await injectContentBundle(page);
    await waitForFillBar(page);

    await page.locator('#password').click();
    await clickOverlay(page, '[data-jf="palette"]');
    await page.waitForFunction(() =>
      window.__jobfillHarness?.shadow.querySelector('[data-jf="palette-search"]'),
    );
    await page.evaluate(() => {
      const shadow = window.__jobfillHarness!.shadow;
      const input = shadow.querySelector<HTMLInputElement>('[data-jf="palette-search"]');
      input!.focus();
      input!.value = 'email';
      input!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForFunction(
      () =>
        (window.__jobfillHarness?.shadow.querySelectorAll('[data-jf="palette-results"] .jf-option')
          .length ?? 0) > 0,
    );
    await page.evaluate(() => {
      const shadow = window.__jobfillHarness!.shadow;
      shadow.querySelector<HTMLButtonElement>('[data-jf="palette-results"] .jf-option')?.click();
    });
    // The deny-list holds even though the field was focused and never scanned as fillable.
    await expect(page.locator('#password')).toHaveValue('');
  });
});

test.describe('fill-bar attach button (rung 3)', () => {
  test('detected upload field + stored resume → attach button delivers the file', async ({
    page,
  }) => {
    await page.goto('/dropzone.html');
    await injectContentBundle(page);
    await page.waitForFunction(() =>
      window.__jobfillHarness?.shadow.querySelector('[data-jf="attach"]'),
    );
    const label = await page.evaluate(
      () => window.__jobfillHarness?.shadow.querySelector('[data-jf="attach"]')?.textContent ?? '',
    );
    expect(label).toContain('Maya_Okafor_Resume_2026.pdf');

    await clickOverlay(page, '[data-jf="attach"]');
    await page.waitForFunction(
      () => ((window as { __receivedFiles?: unknown[] }).__receivedFiles?.length ?? 0) > 0,
    );
    const files = await page.evaluate(
      () =>
        (window as unknown as { __receivedFiles: { name: string; head: string }[] })
          .__receivedFiles,
    );
    expect(files[0]?.name).toBe('Maya_Okafor_Resume_2026.pdf');
    expect(files[0]?.head).toBe('%PDF-1.4');
  });
});

test.describe('custom widgets (rung 4 item 5)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/widgets.html');
    await injectContentBundle(page);
    await waitForFillBar(page);
  });

  test('typeahead combobox: types, awaits async options, clicks the match', async ({ page }) => {
    // The country field is suggest-tier (choice widget) — drive it via review/popover.
    const filled = await page.evaluate(async () => {
      const handle = window.__jobfillHarness!;
      const entry = handle.session.session.current.entries.find(
        (e) => e.field.element.id === 'country-input',
      );
      if (!entry) return 'no-entry';
      const result = await handle.session.session.fillEntry(entry, undefined, true);
      return JSON.stringify(result);
    });
    expect(filled).toContain('"ok":true');
    await expect(page.locator('#country-input')).toHaveValue('United States');
    // The page's own click handler ran — the widget really was driven, not just typed into.
    await expect(page.locator('#chosen')).toContainText('country=United States');
  });

  test('listbox button: opens the popup, clicks the option, verifies the button text', async ({
    page,
  }) => {
    const filled = await page.evaluate(async () => {
      const handle = window.__jobfillHarness!;
      const entry = handle.session.session.current.entries.find(
        (e) => e.field.element.id === 'pt-button',
      );
      if (!entry) return 'no-entry';
      const result = await handle.session.session.fillEntry(entry, undefined, true);
      return JSON.stringify(result);
    });
    expect(filled).toContain('"verified":true');
    await expect(page.locator('#pt-button')).toHaveText('Mobile');
    await expect(page.locator('#chosen')).toContainText('phoneType=Mobile');
  });
});

test.describe('no-auto-submit guard (whole-night review P0-1)', () => {
  test('a form-wrapped listbox button without type is never scanned, and nothing submits', async ({
    page,
  }) => {
    await page.goto('/widgets.html');
    await injectContentBundle(page);
    await waitForFillBar(page);

    const scanned = await page.evaluate(() =>
      window.__jobfillHarness!.session.session.current.entries.map(
        (e) => e.field.element.id || e.field.element.tagName,
      ),
    );
    // The submit-defaulting trap button must not be a field at all.
    expect(scanned).not.toContain('trap-button');
    // The explicit type="button" sibling IS scannable.
    expect(scanned).toContain('safe-button');

    // Drive the safe in-form button; the form must not submit.
    await page.evaluate(async () => {
      const handle = window.__jobfillHarness!;
      const entry = handle.session.session.current.entries.find(
        (e) => e.field.element.id === 'safe-button',
      );
      if (entry) await handle.session.session.fillEntry(entry, 'Mobile', true);
    });
    await expect(page.locator('#safe-button')).toHaveText('Mobile');
    const submitted = await page.evaluate(() => (window as { __submitted?: boolean }).__submitted);
    expect(submitted).toBe(false);
  });
});

test.describe('overlay chrome (badge toggle, Esc audit, movable bar, skip counts)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/plain-form.html');
    await injectContentBundle(page);
    await waitForFillBar(page);
  });

  test('the Badges button hides every badge and shows them again', async ({ page }) => {
    await page.waitForFunction(
      () => (window.__jobfillHarness?.shadow.querySelectorAll('[data-jf-badge]').length ?? 0) > 0,
    );
    await clickOverlay(page, '[data-jf="toggle-badges"]');
    const hidden = await page.evaluate(() => {
      const badge = window.__jobfillHarness!.shadow.querySelector('[data-jf-badge]');
      return badge === null || (badge.parentElement?.hidden ?? false);
    });
    expect(hidden).toBe(true);
    await clickOverlay(page, '[data-jf="toggle-badges"]');
    await page.waitForFunction(
      () => (window.__jobfillHarness?.shadow.querySelectorAll('[data-jf-badge]').length ?? 0) > 0,
    );
  });

  test('Escape closes the palette and popover from anywhere on the page', async ({ page }) => {
    // Palette open → Esc (keyboard focus wherever) closes it.
    await clickOverlay(page, '[data-jf="palette"]');
    await page.waitForFunction(() =>
      window.__jobfillHarness?.shadow.querySelector('[data-jf="palette-dialog"]'),
    );
    await page.keyboard.press('Escape');
    await page.waitForFunction(
      () => !window.__jobfillHarness?.shadow.querySelector('[data-jf="palette-dialog"]'),
    );

    // Review popover open → focus the PAGE (not the popover) → Esc still ends review.
    await clickOverlay(page, '[data-jf="review"]');
    await page.waitForFunction(() =>
      window.__jobfillHarness?.shadow.querySelector('[data-jf="popover"]'),
    );
    await page.locator('h1').click();
    await page.keyboard.press('Escape');
    await page.waitForFunction(
      () => !window.__jobfillHarness?.shadow.querySelector('[data-jf="popover"]'),
    );
  });

  test('the orientation toggle flips the bar vertical and back', async ({ page }) => {
    await clickOverlay(page, '[data-jf="toggle-orientation"]');
    const vertical = await page.evaluate(() =>
      window.__jobfillHarness!.shadow.querySelector('.jf-bar')!.classList.contains('jf-vertical'),
    );
    expect(vertical).toBe(true);
    await clickOverlay(page, '[data-jf="toggle-orientation"]');
    const horizontal = await page.evaluate(
      () =>
        !window
          .__jobfillHarness!.shadow.querySelector('.jf-bar')!
          .classList.contains('jf-vertical'),
    );
    expect(horizontal).toBe(true);
  });

  test('skipping a field in review subtracts it from the Review count', async ({ page }) => {
    const countOf = () =>
      page.evaluate(() => {
        const btn = window.__jobfillHarness!.shadow.querySelector('[data-jf="review"]');
        const match = /Review (\d+)/.exec(btn?.textContent ?? '');
        return match ? Number(match[1]) : 0;
      });
    const before = await countOf();
    expect(before).toBeGreaterThan(0);

    await clickOverlay(page, '[data-jf="review"]');
    await page.waitForFunction(() =>
      window.__jobfillHarness?.shadow.querySelector('[data-jf="popover"]'),
    );
    // Click Skip (the quiet button labelled "Skip (S)").
    await page.evaluate(() => {
      const pop = window.__jobfillHarness!.shadow.querySelector('[data-jf="popover"]')!;
      const skip = [...pop.querySelectorAll('button')].find((b) =>
        b.textContent?.startsWith('Skip'),
      );
      skip?.click();
    });
    // End the review so the bar re-renders its counts.
    await page.keyboard.press('Escape');
    await page.waitForFunction(
      () => !window.__jobfillHarness?.shadow.querySelector('[data-jf="popover"]'),
    );
    const after = await countOf();
    expect(after).toBe(before - 1);
  });
});

test.describe('the fill bar is unlosable (off-screen bug)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/plain-form.html');
    await injectContentBundle(page);
    await waitForFillBar(page);
  });

  const barWithinViewport = (page: Page) =>
    page.evaluate(() => {
      const rect = window
        .__jobfillHarness!.shadow.querySelector('.jf-bar')!
        .getBoundingClientRect();
      return (
        rect.left >= 0 &&
        rect.top >= 0 &&
        rect.right <= window.innerWidth &&
        rect.bottom <= window.innerHeight
      );
    });

  const dragBarTo = (page: Page, x: number, y: number) =>
    page.evaluate(
      ([toX, toY]) => {
        const shadow = window.__jobfillHarness!.shadow;
        const handle = shadow.querySelector<HTMLElement>('[data-jf="drag"]')!;
        const rect = handle.getBoundingClientRect();
        const opts = { bubbles: true, composed: true, pointerId: 1 };
        handle.dispatchEvent(
          new PointerEvent('pointerdown', { ...opts, clientX: rect.x + 2, clientY: rect.y + 2 }),
        );
        window.dispatchEvent(
          new PointerEvent('pointermove', { ...opts, clientX: toX!, clientY: toY! }),
        );
        window.dispatchEvent(new PointerEvent('pointerup', opts));
      },
      [x, y] as const,
    );

  test('dragging far past every edge still leaves the whole bar visible', async ({ page }) => {
    await dragBarTo(page, 5000, 5000); // way past bottom-right
    expect(await barWithinViewport(page)).toBe(true);
    await dragBarTo(page, -5000, -5000); // way past top-left
    expect(await barWithinViewport(page)).toBe(true);
  });

  test('flipping orientation after a drag to the edge keeps the bar inside', async ({ page }) => {
    const size = page.viewportSize()!;
    // Park the (horizontal) bar at the very bottom edge…
    await dragBarTo(page, size.width - 40, size.height - 20);
    expect(await barWithinViewport(page)).toBe(true);
    // …then flip vertical: the bar gets much taller and must be re-clamped, not clipped.
    await clickOverlay(page, '[data-jf="toggle-orientation"]');
    expect(await barWithinViewport(page)).toBe(true);
  });

  test('a drag whose pointerup never fires cannot strand the bar (pointercancel path)', async ({
    page,
  }) => {
    await page.evaluate(() => {
      const shadow = window.__jobfillHarness!.shadow;
      const handle = shadow.querySelector<HTMLElement>('[data-jf="drag"]')!;
      const rect = handle.getBoundingClientRect();
      const opts = { bubbles: true, composed: true, pointerId: 1 };
      handle.dispatchEvent(
        new PointerEvent('pointerdown', { ...opts, clientX: rect.x + 2, clientY: rect.y + 2 }),
      );
      window.dispatchEvent(
        new PointerEvent('pointermove', { ...opts, clientX: 9000, clientY: 9000 }),
      );
      window.dispatchEvent(new PointerEvent('pointercancel', opts)); // e.g. OS stole the pointer
    });
    expect(await barWithinViewport(page)).toBe(true);
  });

  test('double-clicking the grip resets the bar to its docked position', async ({ page }) => {
    await dragBarTo(page, 100, 100);
    await page.evaluate(() => {
      window
        .__jobfillHarness!.shadow.querySelector<HTMLElement>('[data-jf="drag"]')!
        .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    const docked = await page.evaluate(() => {
      const bar = window.__jobfillHarness!.shadow.querySelector<HTMLElement>('.jf-bar')!;
      return bar.style.left === '' && bar.style.bottom === '';
    });
    expect(docked).toBe(true);
    expect(await barWithinViewport(page)).toBe(true);
  });
});
