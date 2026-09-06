/**
 * Async custom-widget fillers — SPEC §7.4 `combobox` (typeahead) and `listbox-button`
 * (Workday-style). Both are best-effort with honest verification: on timeout or no match
 * the field is left for the user with a clear reason, never silently "done".
 */
import { matchChoice } from '../../shared/format.js';
import type { ScannedField } from '../scan.js';
import { setNativeValue, type FillResult, type SnapshotStore } from './index.js';

const DEFAULT_TIMEOUT_MS = 2000;

function fail(reason: string): FillResult {
  return { ok: false, verified: false, reason };
}

/** Waits for `probe` to return non-null, watching DOM mutations, up to `timeoutMs`. */
function waitForElement<T>(
  probe: () => T | null,
  doc: Document,
  timeoutMs: number,
): Promise<T | null> {
  const immediate = probe();
  if (immediate) return Promise.resolve(immediate);
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: T | null) => {
      if (done) return;
      done = true;
      observer.disconnect();
      clearTimeout(timer);
      resolve(value);
    };
    const observer = new MutationObserver(() => {
      const found = probe();
      if (found) finish(found);
    });
    observer.observe(doc, { childList: true, subtree: true, attributes: true });
    const timer = setTimeout(() => finish(null), timeoutMs);
  });
}

function rootOf(el: Element): ParentNode {
  const root = el.getRootNode();
  return root instanceof ShadowRoot ? root : el.ownerDocument;
}

function isShowing(el: Element): boolean {
  return !(el as HTMLElement).hidden && el.getClientRects().length !== 0;
}

/** The listbox a combobox controls: aria-controls/owns → nearby wrapper → any open listbox. */
function findListboxFor(control: Element): Element | null {
  const scope = rootOf(control);
  for (const attr of ['aria-controls', 'aria-owns']) {
    const refId = control.getAttribute(attr);
    if (refId) {
      const referenced = scope.querySelector(`#${refId.replace(/"/g, '\\"')}`);
      if (referenced && isShowing(referenced)) return referenced;
    }
  }
  const wrapper = control.closest('[role="combobox"]')?.parentElement ?? control.parentElement;
  const near = wrapper?.querySelector('[role="listbox"]');
  if (near && isShowing(near)) return near;
  // No document-wide fallback: clicking an option in some OTHER widget's open popup would
  // be worse than doing nothing (whole-night review P2).
  return null;
}

function optionsOf(listbox: Element): HTMLElement[] {
  return [...listbox.querySelectorAll<HTMLElement>('[role="option"]')];
}

/**
 * Typeahead combobox (SPEC §7.4): type via native setter (one shot + settle, not per
 * keystroke) → await the listbox → click the best text match. On timeout the typed text
 * stays and the result says "pick from the site's list".
 */
export async function fillCombobox(
  field: ScannedField,
  value: string,
  targets: string[],
  snapshots: SnapshotStore,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<FillResult> {
  const el = field.element;
  const input =
    el instanceof HTMLInputElement ? el : (el.querySelector<HTMLInputElement>('input') ?? null);
  if (!input) return fail('combobox has no text input to type into');
  const doc = input.ownerDocument;

  snapshots.record(input, { kind: 'text', value: input.value });
  input.focus();
  setNativeValue(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));

  const listbox = await waitForElement(() => findListboxFor(input), doc, timeoutMs);
  if (!listbox) {
    // §5.4 fallback: leave the text, tell the truth.
    return {
      ok: true,
      verified: false,
      reason: 'no suggestions appeared — pick from the site’s list',
    };
  }
  const options = optionsOf(listbox);
  if (options.length === 0) {
    return { ok: true, verified: false, reason: 'suggestion list is empty — pick manually' };
  }
  const labels = options.map((o) => o.textContent?.trim() ?? '');
  const match = matchChoice(labels, targets.length > 0 ? targets : [value], 0.5);
  if (!match) {
    return { ok: true, verified: false, reason: 'no suggestion matched — pick manually' };
  }
  options[match.index]!.click();
  const chosen = labels[match.index] ?? '';
  // Verify the widget accepted the pick (input text usually becomes the option label).
  const landed =
    input.value === chosen || input.value === value || input.value.includes(chosen.slice(0, 12));
  return {
    ok: true,
    verified: landed,
    reason: landed ? undefined : 'clicked, but the input did not update',
  };
}

/**
 * Workday-style `button[aria-haspopup=listbox]` (SPEC §7.4): click → await popup → click
 * option by normalized text → verify the button text changed.
 *
 * NOT undoable: restoring would mean re-driving the widget to its old option, which can
 * misfire on stateful popups — the badge shows filled without a revert affordance.
 */
export async function fillListboxButton(
  field: ScannedField,
  targets: string[],
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<FillResult> {
  const button = field.element;
  if (!(button instanceof HTMLElement)) return fail('not an element');
  // Defense in depth on the §7.9 no-auto-submit rule (scan.ts already filters, but this
  // module must be safe standalone): refuse submit-capable buttons, and belt-and-braces
  // suppress any submit that a click might still trigger while we drive the widget.
  if (button instanceof HTMLButtonElement && button.form !== null && button.type !== 'button') {
    return fail('refusing a submit-capable button (no-auto-submit rule)');
  }
  const doc = button.ownerDocument;
  const before = button.textContent?.trim() ?? '';
  const form = button instanceof HTMLButtonElement ? button.form : null;
  const suppressSubmit = (e: Event) => {
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  form?.addEventListener('submit', suppressSubmit, true);
  try {
    return await driveListbox(button, before, targets, doc, timeoutMs);
  } finally {
    form?.removeEventListener('submit', suppressSubmit, true);
  }
}

async function driveListbox(
  button: HTMLElement,
  before: string,
  targets: string[],
  doc: Document,
  timeoutMs: number,
): Promise<FillResult> {
  button.click();
  const listbox = await waitForElement(() => findListboxFor(button), doc, timeoutMs);
  if (!listbox) return fail('the option list never opened');
  const options = optionsOf(listbox);
  const labels = options.map((o) => o.textContent?.trim() ?? '');
  const match = matchChoice(labels, targets, 0.5);
  if (!match) {
    // Close what we opened rather than leaving a stray popup.
    button.click();
    return fail('no option matched the stored value');
  }
  options[match.index]!.click();
  const after = button.textContent?.trim() ?? '';
  const landed = after !== before && after.length > 0;
  return { ok: true, verified: landed, reason: landed ? undefined : 'button text did not change' };
}
