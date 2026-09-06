/**
 * File attach — SPEC §7.5, the one true Firefox trap.
 *
 * A DataTransfer created in the content-script compartment presents an EMPTY `files` list
 * to page JS; it must be constructed in the page compartment via `wrappedJSObject`.
 * Environment detection: use `window.wrappedJSObject.DataTransfer` when present (real
 * Firefox content script), else the plain constructor (harness/e2e/jsdom context).
 *
 * The wrappedJSObject branch cannot be exercised outside a real extension — it ships
 * code-reviewed but runtime-unverified, top of the morning manual-QA list (PROGRESS.md).
 */

export type AttachEnvironment = 'page-compartment' | 'plain';

/** Which DataTransfer constructor to use in this environment (unit-tested branch pick). */
export function detectAttachEnvironment(win: Window & typeof globalThis): AttachEnvironment {
  // FF-only: wrappedJSObject exists on the content-script view of `window`.
  return win.wrappedJSObject?.DataTransfer ? 'page-compartment' : 'plain';
}

function buildDataTransfer(win: Window & typeof globalThis, file: File): DataTransfer {
  const environment = detectAttachEnvironment(win);
  const Ctor =
    environment === 'page-compartment' ? win.wrappedJSObject!.DataTransfer! : win.DataTransfer;
  const dt = new Ctor();
  dt.items.add(file);
  return dt;
}

export interface AttachResult {
  ok: boolean;
  /** 'input' = set .files on a file input; 'drop' = synthesized drop on a dropzone. */
  path?: 'input' | 'drop';
  environment: AttachEnvironment;
  reason?: string;
}

/**
 * Sets a `File` on an `<input type=file>` through the (Xray in Firefox) WebIDL setter and
 * fires change+input (SPEC §7.5). Prefer this even when a dropzone is visible — most
 * dropzones wrap a hidden real input.
 */
export function attachFileToInput(
  input: HTMLInputElement,
  file: File,
  win: Window & typeof globalThis = window,
): AttachResult {
  const environment = detectAttachEnvironment(win);
  try {
    const dt = buildDataTransfer(win, file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const landed = input.files !== null && input.files.length > 0;
    return landed
      ? { ok: true, path: 'input', environment }
      : { ok: false, environment, reason: 'files list stayed empty after set' };
  } catch (err) {
    return { ok: false, environment, reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Dropzone fallback (SPEC §7.5): synthesize dragenter → dragover → drop carrying the
 * DataTransfer at the dropzone element, for apps with no hidden input or that ignore
 * the change event.
 */
export function attachFileToDropzone(
  dropzone: Element,
  file: File,
  win: Window & typeof globalThis = window,
): AttachResult {
  const environment = detectAttachEnvironment(win);
  try {
    const dt = buildDataTransfer(win, file);
    for (const type of ['dragenter', 'dragover', 'drop'] as const) {
      const event = new DragEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        dataTransfer: dt,
      });
      dropzone.dispatchEvent(event);
    }
    // Drop success is not directly observable here; the caller verifies via the page's
    // own reaction (file-name render etc.). We report that the events dispatched.
    return { ok: true, path: 'drop', environment };
  } catch (err) {
    return { ok: false, environment, reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Attach strategy for a detected upload target (SPEC §7.5 order):
 * 1. the element itself when it's a file input;
 * 2. a hidden `input[type=file]` inside/near the dropzone (THE common pattern);
 * 3. synthesized drop on the element.
 */
export function attachFile(
  target: Element,
  file: File,
  win: Window & typeof globalThis = window,
): AttachResult {
  if (target instanceof HTMLInputElement && target.type === 'file') {
    return attachFileToInput(target, file, win);
  }
  const hidden = findHiddenFileInput(target);
  if (hidden) {
    const result = attachFileToInput(hidden, file, win);
    if (result.ok) return result;
  }
  return attachFileToDropzone(target, file, win);
}

const ZONE_SELECTOR =
  '[class*="drop"], [class*="upload"], [class*="attach"], [id*="drop"], [id*="upload"], [id*="attach"]';

/**
 * Finds the hidden real input behind a styled dropzone: inside it first, then nearby
 * ancestors (the Lever sibling pattern). A candidate that belongs to a DIFFERENT
 * upload zone is rejected — on a page with separate resume and cover-letter zones,
 * attaching to one must never set the other's input.
 */
export function findHiddenFileInput(dropzone: Element): HTMLInputElement | null {
  const inside = dropzone.querySelector<HTMLInputElement>('input[type=file]');
  if (inside) return inside;
  let node: Element | null = dropzone.parentElement;
  for (let hops = 0; node && hops < 3; hops++, node = node.parentElement) {
    for (const candidate of node.querySelectorAll<HTMLInputElement>('input[type=file]')) {
      const owner = candidate.parentElement?.closest(ZONE_SELECTOR);
      if (owner && owner !== dropzone && !owner.contains(dropzone) && !dropzone.contains(owner)) {
        continue; // lives inside another upload zone
      }
      return candidate;
    }
  }
  return null;
}
