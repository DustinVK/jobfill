/**
 * Filler strategies — SPEC §7.4. A registry of named strategies; every fill snapshots prior
 * state for undo (§7.8) and verifies by read-back — a mismatch (site JS rewrote the value)
 * is reported, never silently swallowed.
 *
 * `combobox`/`listbox-button` are deliberately absent tonight (Rung 4 optional): on
 * encounter, classification drops them to `suggest` with the option list in the popover
 * (SPEC §5.4 fallback) — never pretend to drive a widget we can't.
 */
import type { ScannedField } from '../scan.js';
import { matchChoice } from '../../shared/format.js';

// ---------------------------------------------------------------------------
// Undo snapshots (SPEC §7.8)
// ---------------------------------------------------------------------------

export interface PriorState {
  kind: 'text' | 'select' | 'radio-group' | 'checkbox' | 'contenteditable';
  value?: string;
  selectedIndex?: number;
  /** For radio groups: the element that was checked, if any. */
  checkedElement?: HTMLInputElement;
  checked?: boolean;
}

/** Snapshots die with the scan generation — the coordinator replaces the whole store. */
export class SnapshotStore {
  private readonly map = new WeakMap<Element, PriorState>();
  private readonly touched = new Set<Element>();

  /** Records prior state once per element per generation (first touch wins). */
  record(el: Element, state: PriorState): void {
    if (!this.map.has(el)) this.map.set(el, state);
    this.touched.add(el);
  }

  get(el: Element): PriorState | undefined {
    return this.map.get(el);
  }

  touchedElements(): Element[] {
    return [...this.touched];
  }

  forget(el: Element): void {
    this.touched.delete(el);
  }
}

// ---------------------------------------------------------------------------
// Event dispatch helpers
// ---------------------------------------------------------------------------

function fireInputEvents(el: Element, opts: { blur?: boolean } = {}): void {
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  // Workday commits on blur (SPEC §7.4).
  if (opts.blur !== false) el.dispatchEvent(new Event('blur', { bubbles: false }));
}

/**
 * The native-setter trick (SPEC §7.4): React/Vue/Ember wrap `value` with their own
 * descriptor on the element; setting through the *prototype's* setter makes the framework's
 * change tracking see the new value when the input event lands.
 */
export function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
  const descriptor = Object.getOwnPropertyDescriptor(proto.prototype, 'value');
  if (descriptor?.set) {
    descriptor.set.call(el, value);
  } else {
    el.value = value;
  }
}

// ---------------------------------------------------------------------------
// Fill results
// ---------------------------------------------------------------------------

export interface FillResult {
  ok: boolean;
  /** Read-back verification: false ⇒ the badge goes amber, field not counted done (§7.4). */
  verified: boolean;
  reason?: string;
}

const ok = (verified: boolean, reason?: string): FillResult => ({ ok: true, verified, reason });
const fail = (reason: string): FillResult => ({ ok: false, verified: false, reason });

// ---------------------------------------------------------------------------
// Strategies
// ---------------------------------------------------------------------------

export function fillText(field: ScannedField, value: string, snapshots: SnapshotStore): FillResult {
  const el = field.element;
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
    return fail('not a text control');
  }
  snapshots.record(el, { kind: 'text', value: el.value });
  setNativeValue(el, value);
  fireInputEvents(el);
  const landed = el.value === value;
  return ok(landed, landed ? undefined : 'read-back mismatch (site JS rewrote the value)');
}

export function fillContentEditable(
  field: ScannedField,
  value: string,
  snapshots: SnapshotStore,
): FillResult {
  const el = field.element;
  if (!(el instanceof HTMLElement)) return fail('not an element');
  snapshots.record(el, { kind: 'contenteditable', value: el.textContent ?? '' });
  el.focus();
  // execCommand is deprecated but universally supported and plays well with editors (§7.4).
  const doc = el.ownerDocument;
  let inserted = false;
  if (typeof doc.execCommand === 'function') {
    doc.getSelection()?.selectAllChildren(el);
    inserted = doc.execCommand('insertText', false, value);
  }
  if (!inserted) {
    el.textContent = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  const landed = (el.textContent ?? '').includes(value);
  return ok(landed, landed ? undefined : 'read-back mismatch');
}

/** Select: match option per SPEC §5.4, set selectedIndex, dispatch input+change. */
export function fillSelect(
  field: ScannedField,
  targets: string[],
  snapshots: SnapshotStore,
): FillResult {
  const el = field.element;
  if (!(el instanceof HTMLSelectElement)) return fail('not a select');
  const labels = [...el.options].map((o) => o.label || o.text);
  const match = matchChoice(labels, targets);
  if (!match) return fail('no option matched the stored value');
  snapshots.record(el, { kind: 'select', selectedIndex: el.selectedIndex });
  el.selectedIndex = match.index;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  const landed = el.selectedIndex === match.index;
  return ok(landed, landed ? undefined : 'selection did not stick');
}

/** Radio group: find the matching input by its own label, click it (§7.4). */
export function fillRadioGroup(
  field: ScannedField,
  targets: string[],
  snapshots: SnapshotStore,
): FillResult {
  const radios = field.groupElements ?? [];
  if (radios.length === 0) return fail('empty radio group');
  const labels = radios.map((radio) => radioLabel(radio));
  const match = matchChoice(labels, targets);
  if (!match) return fail('no radio matched the stored value');
  const target = radios[match.index];
  if (!target) return fail('matched index out of range');
  const previouslyChecked = radios.find((r) => r.checked);
  for (const radio of radios) {
    snapshots.record(radio, {
      kind: 'radio-group',
      checked: radio.checked,
      checkedElement: previouslyChecked,
    });
  }
  // .click() fires the framework's handlers naturally.
  target.click();
  const landed = target.checked;
  return ok(landed, landed ? undefined : 'radio did not check');
}

function radioLabel(radio: HTMLInputElement): string {
  // Shadow-aware: label[for] must resolve within the radio's own tree.
  const root = radio.getRootNode();
  const scope: ParentNode = root instanceof ShadowRoot ? root : radio.ownerDocument;
  const id = radio.getAttribute('id');
  if (id) {
    const label = scope.querySelector(`label[for="${id.replace(/"/g, '\\"')}"]`);
    if (label?.textContent) return label.textContent.trim();
  }
  const wrapping = radio.closest('label');
  if (wrapping?.textContent) return wrapping.textContent.trim();
  return radio.value;
}

/** Checkbox: set to the desired state via click (only when it differs). */
export function fillCheckbox(
  field: ScannedField,
  shouldCheck: boolean,
  snapshots: SnapshotStore,
): FillResult {
  const el = field.element;
  if (!(el instanceof HTMLInputElement) || el.type !== 'checkbox') return fail('not a checkbox');
  snapshots.record(el, { kind: 'checkbox', checked: el.checked });
  if (el.checked !== shouldCheck) el.click();
  const landed = el.checked === shouldCheck;
  return ok(landed, landed ? undefined : 'checkbox did not toggle');
}

// ---------------------------------------------------------------------------
// Undo (SPEC §7.8)
// ---------------------------------------------------------------------------

/** Restores one element to its snapshot. Returns false when no snapshot exists. */
export function undoElement(el: Element, snapshots: SnapshotStore): boolean {
  const prior = snapshots.get(el);
  if (!prior) return false;
  switch (prior.kind) {
    case 'text': {
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        setNativeValue(el, prior.value ?? '');
        fireInputEvents(el, { blur: false });
      }
      break;
    }
    case 'contenteditable': {
      if (el instanceof HTMLElement) {
        el.textContent = prior.value ?? '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      break;
    }
    case 'select': {
      if (el instanceof HTMLSelectElement && prior.selectedIndex !== undefined) {
        el.selectedIndex = prior.selectedIndex;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      break;
    }
    case 'radio-group': {
      if (el instanceof HTMLInputElement) {
        if (prior.checkedElement && prior.checkedElement !== el) {
          prior.checkedElement.click();
        } else if (prior.checked === false && el.checked) {
          // No radio was checked before the fill; uncheck directly (click would re-check).
          el.checked = false;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      break;
    }
    case 'checkbox': {
      if (
        el instanceof HTMLInputElement &&
        prior.checked !== undefined &&
        el.checked !== prior.checked
      ) {
        el.click();
      }
      break;
    }
  }
  snapshots.forget(el);
  return true;
}

/** Restores every touched field of the current generation. Returns how many were restored. */
export function undoAll(snapshots: SnapshotStore): number {
  let restored = 0;
  for (const el of snapshots.touchedElements()) {
    if (undoElement(el, snapshots)) restored++;
  }
  return restored;
}
