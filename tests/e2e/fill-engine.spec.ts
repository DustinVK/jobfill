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

async function overlayText(page: Page, selector: string): Promise<string | null> {
  return page.evaluate(
    (sel) => window.__jobfillHarness?.shadow.querySelector(sel)?.textContent ?? null,
    selector,
  );
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

  test('fill bar shows the active version name', async ({ page }) => {
    const version = await overlayText(page, '.jf-version');
    expect(version).toBe('Everything / impact-first');
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
