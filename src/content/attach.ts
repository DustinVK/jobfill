/**
 * File attach — SPEC §7.5, the one true Firefox trap.
 *
 * A DataTransfer created in the content-script compartment presents an EMPTY `files` list
 * to page JS; it (and ideally the File and DragEvent too) must be constructed in the page
 * compartment via `wrappedJSObject`/`cloneInto`. Environment detection picks that branch
 * when available (real Firefox content script) and the plain constructors otherwise
 * (harness/e2e/jsdom).
 *
 * HONEST RISK NOTE (top of the morning manual-QA list): the page-compartment branch cannot
 * execute outside a real extension, so it ships runtime-UNVERIFIED. Specific residual risks:
 *  - the File arrives from the background in the CONTENT compartment; we rebuild it in the
 *    page compartment when `cloneInto` is available, but that hand-off is exactly the kind
 *    of Xray subtlety that needs a live check;
 *  - verification reads `input.wrappedJSObject.files` (the page's own view) when possible —
 *    reading only our Xray view could report success the page cannot see;
 *  - a hostile page that deletes `window.DataTransfer`/`File` breaks the page branch; we
 *    fail loudly rather than silently degrading to the known-broken plain branch.
 *
 * Platform constraints (SPEC §7.5, documented as required):
 *  - synthesized events are `isTrusted: false` — frameworks don't care, exotic anti-bot
 *    layers might;
 *  - content scripts never run on Mozilla-protected or quarantined domains;
 *  - platform floors (input.files settable FF57+, DataTransfer ctor FF62+, drop-data bug
 *    fixed FF90) are all far below the manifest's strict_min_version 128.
 */

export type AttachEnvironment = 'page-compartment' | 'plain';

/** FF-only content-script global; absent everywhere else. */
declare function cloneInto<T>(
  value: T,
  scope: object,
  options?: { cloneFunctions?: boolean; wrapReflectors?: boolean },
): T;

interface PageCompartment {
  DataTransfer?: new () => DataTransfer;
  File?: new (parts: unknown[], name: string, opts?: FilePropertyBag) => File;
  DragEvent?: new (type: string, init?: DragEventInit) => DragEvent;
}

function pageCompartmentOf(win: Window & typeof globalThis): PageCompartment | undefined {
  return (win as { wrappedJSObject?: PageCompartment }).wrappedJSObject;
}

function cloneIntoOrUndefined(): typeof cloneInto | undefined {
  return typeof cloneInto === 'function' ? cloneInto : undefined;
}

/** Which compartment this environment builds DataTransfer objects in (unit-tested pick). */
export function detectAttachEnvironment(win: Window & typeof globalThis): AttachEnvironment {
  return pageCompartmentOf(win)?.DataTransfer ? 'page-compartment' : 'plain';
}

/**
 * Builds the DataTransfer (and, in the page branch, the File itself) in the right
 * compartment. Throws with a clear message when the page compartment exists but has been
 * stripped of its constructors — never silently falls back to the broken plain branch.
 */
function buildDataTransfer(win: Window & typeof globalThis, file: File): DataTransfer {
  const page = pageCompartmentOf(win);
  if (page) {
    if (!page.DataTransfer) {
      throw new Error('page compartment has no DataTransfer constructor (page interference?)');
    }
    const dt = new page.DataTransfer();
    const ci = cloneIntoOrUndefined();
    if (page.File && ci) {
      // Rebuild the File in the page compartment so page JS can read its bytes.
      const parts = ci([file], page as object, { wrapReflectors: true });
      const opts = ci({ type: file.type, lastModified: file.lastModified }, page as object);
      dt.items.add(new page.File(parts as unknown[], file.name, opts));
    } else {
      dt.items.add(file);
    }
    return dt;
  }
  const dt = new win.DataTransfer();
  dt.items.add(file);
  return dt;
}

export interface AttachResult {
  ok: boolean;
  /**
   * True only when the file's arrival was OBSERVED (input.files non-empty through the most
   * page-faithful view we can get). The drop path cannot observe delivery and is always
   * unverified — the UI must say "check the site accepted it".
   */
  verified: boolean;
  /** 'input' = set .files on a file input; 'drop' = synthesized drop on a dropzone. */
  path?: 'input' | 'drop';
  environment: AttachEnvironment;
  reason?: string;
}

/** The page's own view of an input's files, when Xrays are in play. */
function pageVisibleFiles(input: HTMLInputElement): FileList | null {
  const pageView = (input as { wrappedJSObject?: HTMLInputElement }).wrappedJSObject;
  return (pageView ?? input).files;
}

/**
 * Sets a `File` on an `<input type=file>` through the (Xray in Firefox) WebIDL setter and
 * fires input+change (SPEC §7.5). Prefer this even when a dropzone is visible — most
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
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const seen = pageVisibleFiles(input);
    const landed = seen !== null && seen.length > 0;
    return landed
      ? { ok: true, verified: true, path: 'input', environment }
      : { ok: false, verified: false, environment, reason: 'files list stayed empty after set' };
  } catch (err) {
    return {
      ok: false,
      verified: false,
      environment,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Dropzone fallback (SPEC §7.5): synthesize dragenter → dragover → drop carrying the
 * DataTransfer at the dropzone element. Delivery is NOT observable from here — the result
 * is always unverified and callers must say so.
 */
export function attachFileToDropzone(
  dropzone: Element,
  file: File,
  win: Window & typeof globalThis = window,
): AttachResult {
  const environment = detectAttachEnvironment(win);
  try {
    const dt = buildDataTransfer(win, file);
    const page = pageCompartmentOf(win);
    const ci = cloneIntoOrUndefined();
    for (const type of ['dragenter', 'dragover', 'drop'] as const) {
      let event: DragEvent;
      if (page?.DragEvent && ci) {
        // Page-compartment event so `event.dataTransfer` survives the membrane.
        const init = ci(
          { bubbles: true, cancelable: true, composed: true },
          page as object,
        ) as DragEventInit;
        (init as { dataTransfer?: DataTransfer }).dataTransfer = dt;
        event = new page.DragEvent(type, init);
      } else {
        event = new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          dataTransfer: dt,
        });
      }
      dropzone.dispatchEvent(event);
    }
    return { ok: true, verified: false, path: 'drop', environment };
  } catch (err) {
    return {
      ok: false,
      verified: false,
      environment,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Attach strategy for a detected upload target (SPEC §7.5 order):
 * 1. the element itself when it's a file input;
 * 2. a hidden `input[type=file]` behind the dropzone (THE common pattern);
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

const RESUME_HINT_RE = /resume|c\.?v\b|curriculum/i;

function enabledFileInputs(scope: ParentNode): HTMLInputElement[] {
  return [...scope.querySelectorAll<HTMLInputElement>('input[type=file]:not([disabled])')];
}

function looksLikeResumeInput(input: HTMLInputElement): boolean {
  const hint = `${input.name} ${input.id} ${input.getAttribute('aria-label') ?? ''}`;
  return RESUME_HINT_RE.test(hint);
}

/**
 * Finds the hidden real input behind a styled dropzone. FAIL-CLOSED (rung-3 review P1-2):
 * ambiguity returns null and the caller falls through to the drop path rather than risking
 * a file landing in a different field.
 *  - inside the zone: the sole enabled input, or the resume-looking one among several;
 *  - ONE ancestor hop only (the Lever sibling pattern), and only when that parent holds
 *    EXACTLY one candidate that isn't owned by a different upload zone.
 * Residual risk: two token-less sibling zones under one tight parent could still collide —
 * the drop path (which targets the zone itself) is the safe fallback for such markup.
 */
export function findHiddenFileInput(dropzone: Element): HTMLInputElement | null {
  const inside = enabledFileInputs(dropzone);
  if (inside.length === 1) return inside[0]!;
  if (inside.length > 1) return inside.find(looksLikeResumeInput) ?? null;

  const parent = dropzone.parentElement;
  if (!parent) return null;
  const near = enabledFileInputs(parent);
  if (near.length !== 1) return null;
  const candidate = near[0]!;
  const owner = candidate.parentElement?.closest(ZONE_SELECTOR);
  if (owner && owner !== dropzone && !owner.contains(dropzone) && !dropzone.contains(owner)) {
    return null; // lives inside another upload zone
  }
  return candidate;
}

/**
 * Product-side dropzone detection for pages with NO file input at all (react-dropzone
 * style): a visible zone-ish element with upload-flavoured text and no deny-listed words
 * (never offer to drop a resume on a passport/ID/bank-document uploader).
 */
export function findAttachableDropzone(root: ParentNode): Element | null {
  for (const zone of root.querySelectorAll(ZONE_SELECTOR)) {
    if (!(zone instanceof HTMLElement) || zone.hidden) continue;
    if (zone.closest('[data-jobfill]')) continue;
    if (enabledFileInputs(zone).length > 0) continue; // input-backed zones surface via scan
    if (zone.querySelector(ZONE_SELECTOR)) continue; // prefer the innermost zone
    const text = (zone.textContent ?? '').slice(0, 300);
    if (!/resume|c\.?v\b|curriculum|upload|drop|attach/i.test(text)) continue;
    if (/passport|licen[cs]e|national id|bank|cheque|void/i.test(text)) continue;
    return zone;
  }
  return null;
}
