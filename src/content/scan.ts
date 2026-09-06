/**
 * Field discovery — SPEC §7.1. DOM-only logic, unit-testable under jsdom and exercised for
 * real by the harness e2e. Shadow DOM traversal uses Firefox's `openOrClosedShadowRoot`
 * when present (FF-only; jsdom/harness fall back to the standard open `shadowRoot`).
 */

export type ControlKind =
  | 'text'
  | 'textarea'
  | 'select'
  | 'radio-group'
  | 'checkbox'
  | 'combobox'
  | 'listbox-button'
  | 'contenteditable'
  | 'file';

export interface ScannedField {
  fieldId: string;
  kind: ControlKind;
  /** The control element (for radio groups, the first radio; `groupElements` has all). */
  element: Element;
  /** All inputs of a radio/checkbox group. */
  groupElements?: HTMLInputElement[];
}

const FILLABLE_INPUT_TYPES = new Set([
  'text',
  'email',
  'tel',
  'url',
  'number',
  'search',
  'date',
  'month',
  '', // missing type attribute = text
]);

let nextFieldId = 0;

/** Resets the id counter (tests only, keeps fixture output stable). */
export function resetFieldIds(): void {
  nextFieldId = 0;
}

/**
 * Layout-aware visibility. In environments without a layout engine (jsdom unit tests) every
 * element reports offsetParent === null and zero client rects, so the geometry heuristic
 * only applies when the document's body itself has geometry.
 */
function hasLayout(doc: Document): boolean {
  return (doc.body?.getClientRects().length ?? 0) > 0;
}

function isVisible(el: Element, layout: boolean): boolean {
  const html = el as HTMLElement;
  if (html.hidden) return false;
  if (el.getAttribute('aria-hidden') === 'true' || el.closest('[aria-hidden="true"]')) return false;
  const style = el.getAttribute('style') ?? '';
  if (/display\s*:\s*none|visibility\s*:\s*hidden/.test(style)) return false;
  if (layout) {
    if (html.offsetParent === null && el.getClientRects().length === 0) return false;
    const computed = el.ownerDocument.defaultView?.getComputedStyle(el);
    if (computed && (computed.display === 'none' || computed.visibility === 'hidden')) return false;
  }
  return true;
}

function isDisabled(el: Element): boolean {
  return (
    (el as HTMLInputElement).disabled === true ||
    el.getAttribute('aria-disabled') === 'true' ||
    (el as HTMLInputElement).readOnly === true
  );
}

/** Combobox cues per SPEC Appendix B.4. */
function isComboboxLike(el: Element): boolean {
  const role = el.getAttribute('role');
  if (role === 'combobox') return true;
  const haspopup = el.getAttribute('aria-haspopup');
  if (haspopup === 'listbox' || haspopup === 'menu') return true;
  const autocompleteAria = el.getAttribute('aria-autocomplete');
  if (autocompleteAria === 'list' || autocompleteAria === 'both') return true;
  if (el.hasAttribute('aria-expanded') && el.hasAttribute('aria-controls')) return true;
  if (el.hasAttribute('list')) return true;
  return false;
}

/** A text input nested in a combobox wrapper is the combobox, not free text (SPEC §7.3). */
function insideComboboxWrapper(el: Element): boolean {
  let node: Element | null = el.parentElement;
  for (let hops = 0; node && hops < 3; hops++, node = node.parentElement) {
    if (isComboboxLike(node)) return true;
  }
  return false;
}

function shadowRootOf(el: Element): ShadowRoot | null {
  // FF-only: reaches closed roots from a content script. Harness/jsdom see open roots only.
  return el.openOrClosedShadowRoot ?? el.shadowRoot ?? null;
}

/** Recursive walk over the document and all reachable shadow roots. */
function collectCandidates(root: ParentNode, out: Element[]): void {
  const selector =
    'input, textarea, select, [contenteditable], [role=combobox], [aria-haspopup=listbox], button[aria-haspopup=listbox]';
  for (const el of root.querySelectorAll(selector)) {
    out.push(el);
  }
  // Shadow-host discovery walks every element on every scan — O(page size) per settle.
  // Acceptable tonight; a cached-hosts TreeWalker is the optimization if profiling ever
  // shows this hot (parked in PROGRESS).
  for (const el of root.querySelectorAll('*')) {
    const shadow = shadowRootOf(el);
    if (shadow) collectCandidates(shadow, out);
  }
}

const containerIds = new WeakMap<Element, number>();
let nextContainerId = 0;
function containerId(el: Element): number {
  let id = containerIds.get(el);
  if (id === undefined) {
    id = nextContainerId++;
    containerIds.set(el, id);
  }
  return id;
}

function groupKey(input: HTMLInputElement): string {
  if (input.name) {
    // Same name in two DIFFERENT forms = two independent groups (rung-2 review P1-9).
    const scope = input.form ? `f${containerId(input.form)}` : 'd';
    return `${scope}:${input.name}`;
  }
  const fieldset = input.closest('fieldset');
  return fieldset ? `fs:${containerId(fieldset)}` : `solo:${nextFieldId++}`;
}

/**
 * Scans a document (or any root) for fillable controls. Pure discovery: no classification,
 * no mutation. Radio/checkbox inputs are grouped by name or enclosing fieldset.
 */
export function scanFields(root: ParentNode = document): ScannedField[] {
  const candidates: Element[] = [];
  collectCandidates(root, candidates);
  const doc = (root as Document).body ? (root as Document) : root.ownerDocument!;
  const layout = hasLayout(doc);

  const fields: ScannedField[] = [];
  const radioGroups = new Map<string, HTMLInputElement[]>();
  const seen = new Set<Element>();

  for (const el of candidates) {
    if (seen.has(el)) continue;
    seen.add(el);

    if (el instanceof HTMLInputElement) {
      const type = (el.getAttribute('type') ?? '').toLowerCase();
      if (type === 'file') {
        // The hidden-file-input exception (§7.1) skips only the VISIBILITY check;
        // disabled file inputs stay out.
        if (!isDisabled(el)) {
          fields.push({ fieldId: `field-${nextFieldId++}`, kind: 'file', element: el });
        }
        continue;
      }
      if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'image') continue;
      if (isDisabled(el) || !isVisible(el, layout)) continue;
      if (type === 'radio') {
        const key = `r:${groupKey(el)}`;
        const group = radioGroups.get(key) ?? [];
        group.push(el);
        radioGroups.set(key, group);
        continue;
      }
      if (type === 'checkbox') {
        fields.push({
          fieldId: `field-${nextFieldId++}`,
          kind: 'checkbox',
          element: el,
          groupElements: [el],
        });
        continue;
      }
      if (type === 'password') {
        // Scanned so the deny-list can mark it skip (visible refusal beats invisibility).
        fields.push({ fieldId: `field-${nextFieldId++}`, kind: 'text', element: el });
        continue;
      }
      if (!FILLABLE_INPUT_TYPES.has(type)) continue;
      const combobox = isComboboxLike(el) || insideComboboxWrapper(el);
      fields.push({
        fieldId: `field-${nextFieldId++}`,
        kind: combobox ? 'combobox' : 'text',
        element: el,
      });
      continue;
    }

    if (el instanceof HTMLTextAreaElement) {
      if (isDisabled(el) || !isVisible(el, layout)) continue;
      fields.push({ fieldId: `field-${nextFieldId++}`, kind: 'textarea', element: el });
      continue;
    }

    if (el instanceof HTMLSelectElement) {
      if (isDisabled(el) || !isVisible(el, layout)) continue;
      fields.push({ fieldId: `field-${nextFieldId++}`, kind: 'select', element: el });
      continue;
    }

    if (el instanceof HTMLButtonElement && el.getAttribute('aria-haspopup') === 'listbox') {
      if (isDisabled(el) || !isVisible(el, layout)) continue;
      fields.push({ fieldId: `field-${nextFieldId++}`, kind: 'listbox-button', element: el });
      continue;
    }

    const contenteditable = el.getAttribute('contenteditable');
    if (contenteditable === 'true' || contenteditable === '') {
      if (!isVisible(el, layout)) continue;
      fields.push({ fieldId: `field-${nextFieldId++}`, kind: 'contenteditable', element: el });
      continue;
    }

    if (isComboboxLike(el) && !(el instanceof HTMLButtonElement)) {
      if (isDisabled(el) || !isVisible(el, layout)) continue;
      // Widget root without a nested input (rare); treat the root as the combobox.
      if (!el.querySelector('input')) {
        fields.push({ fieldId: `field-${nextFieldId++}`, kind: 'combobox', element: el });
      }
    }
  }

  for (const group of radioGroups.values()) {
    const enabled = group.filter((r) => !isDisabled(r) && isVisible(r, layout));
    if (enabled.length === 0) continue;
    const first = enabled[0];
    if (!first) continue;
    fields.push({
      fieldId: `field-${nextFieldId++}`,
      kind: 'radio-group',
      element: first,
      groupElements: enabled,
    });
  }

  return fields;
}

// ---------------------------------------------------------------------------
// SPA readiness (SPEC §7.1): debounced MutationObserver + scan generations
// ---------------------------------------------------------------------------

export interface ScanScheduler {
  /** Current generation; bumps on every re-scan. Stale popovers check this. */
  readonly generation: number;
  stop(): void;
}

export function observeAndRescan(
  target: Node,
  onRescan: (generation: number) => void,
  settleMs = 250,
): ScanScheduler {
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const schedule = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      generation++;
      onRescan(generation);
    }, settleMs);
  };

  const observer = new MutationObserver((mutations) => {
    // Ignore mutations caused by our own overlay (host attach/detach and anything inside it).
    const isOurs = (node: Node): boolean =>
      node instanceof Element &&
      (node.closest('[data-jobfill]') !== null || node.matches('[data-jobfill]'));
    const relevant = mutations.some((m) => {
      if (isOurs(m.target)) return false;
      const changed = [...m.addedNodes, ...m.removedNodes];
      if (changed.length > 0 && changed.every(isOurs)) return false;
      return true;
    });
    if (relevant) schedule();
  });
  observer.observe(target, { childList: true, subtree: true });

  // History API route changes also trigger re-scan (SPA navigation).
  const onPopstate = () => schedule();
  const win = target.ownerDocument?.defaultView ?? (target as Document).defaultView;
  win?.addEventListener('popstate', onPopstate);

  return {
    get generation() {
      return generation;
    },
    stop() {
      observer.disconnect();
      if (timer !== undefined) clearTimeout(timer);
      win?.removeEventListener('popstate', onPopstate);
    },
  };
}
