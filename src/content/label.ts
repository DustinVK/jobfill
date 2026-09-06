/**
 * Signal gathering — SPEC §7.2. For each scanned control, collect ALL labeling signals in
 * order (kept separate, not first-match — the classifier weighs them individually).
 */
import type { FieldSignals } from '../shared/classify.js';
import type { ScannedField } from './scan.js';
import type { WidgetKind } from '../shared/types.js';

/** Humanize name/id/data-attrs: split camelCase and _-, drop noise (SPEC §7.2 step 6). */
export function humanizeAttr(raw: string): string {
  return raw
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function textOf(el: Element | null): string {
  return el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

/**
 * Query root for id/label lookups: the element's own tree (shadow root when inside one).
 * `ownerDocument` queries cannot see into shadow roots (SPEC §7.1 traversal).
 */
function rootOf(el: Element): ParentNode {
  const root = el.getRootNode();
  return root instanceof ShadowRoot ? root : el.ownerDocument;
}

function byId(el: Element, id: string): Element | null {
  return rootOf(el).querySelector(`#${cssEscape(id)}`);
}

function cssEscape(value: string): string {
  // CSS.escape is available in Firefox and jsdom; fall back to a conservative escape.
  const css = (globalThis as { CSS?: { escape?: (v: string) => string } }).CSS;
  return css?.escape ? css.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

function labelFor(el: Element): string {
  const id = el.getAttribute('id');
  if (id) {
    const explicit = rootOf(el).querySelector(`label[for="${id.replace(/"/g, '\\"')}"]`);
    if (explicit) return textOf(explicit);
  }
  const wrapping = el.closest('label');
  if (wrapping) {
    // Exclude the control's own value text (options etc.).
    const clone = wrapping.cloneNode(true) as HTMLElement;
    for (const control of clone.querySelectorAll('input, select, textarea, button')) {
      control.remove();
    }
    return textOf(clone);
  }
  return '';
}

function legendOf(el: Element): string {
  const fieldset = el.closest('fieldset');
  if (!fieldset) return '';
  return textOf(fieldset.querySelector('legend'));
}

function ariaLabelOf(el: Element): string {
  const labelledby = el.getAttribute('aria-labelledby');
  if (labelledby) {
    const text = labelledby
      .split(/\s+/)
      .map((refId) => textOf(byId(el, refId)))
      .filter(Boolean)
      .join(' ');
    if (text) return text;
  }
  return el.getAttribute('aria-label')?.trim() ?? '';
}

/** Nearby text: capped tree walk per SPEC §7.2 step 7 (≤3 hops). */
function nearbyTextOf(el: Element): string {
  const parts: string[] = [];

  // aria-describedby
  const describedby = el.getAttribute('aria-describedby');
  if (describedby) {
    for (const refId of describedby.split(/\s+/)) {
      const text = textOf(byId(el, refId));
      if (text) parts.push(text);
    }
  }

  // Previous element sibling's text.
  const prev = el.previousElementSibling;
  if (prev && !prev.querySelector('input, select, textarea')) {
    const text = textOf(prev);
    if (text && text.length < 200) parts.push(text);
  }

  // Parent's leading text node.
  const parent = el.parentElement;
  if (parent) {
    for (const node of parent.childNodes) {
      if (node === el) break;
      if (node.nodeType === 3 /* TEXT_NODE */) {
        const text = node.textContent?.replace(/\s+/g, ' ').trim() ?? '';
        if (text) parts.push(text);
      }
    }
  }

  // Table layouts: same-row previous <td>/<th>.
  const cell = el.closest('td');
  const prevCell = cell?.previousElementSibling;
  if (prevCell && (prevCell.tagName === 'TD' || prevCell.tagName === 'TH')) {
    const text = textOf(prevCell);
    if (text && text.length < 200) parts.push(text);
  }

  // Walk up ≤3 ancestors looking for a preceding sibling with short text.
  let node: Element | null = el;
  for (let hops = 0; node && hops < 3; hops++, node = node.parentElement) {
    const sibling = node.previousElementSibling;
    if (
      sibling &&
      !sibling.querySelector('input, select, textarea') &&
      !parts.includes(textOf(sibling))
    ) {
      const text = textOf(sibling);
      if (text && text.length < 200) {
        parts.push(text);
        break;
      }
    }
  }

  return parts.join(' ').trim();
}

function nameIdOf(el: Element): string {
  const parts: string[] = [];
  const name = el.getAttribute('name');
  if (name) parts.push(humanizeAttr(name));
  const id = el.getAttribute('id');
  if (id) parts.push(humanizeAttr(id));
  for (const attr of el.getAttributeNames()) {
    if (attr.startsWith('data-') && /id|field|name|automation|qa|test/.test(attr)) {
      const value = el.getAttribute(attr);
      if (value) parts.push(humanizeAttr(value));
    }
  }
  return parts.join(' ').trim();
}

function optionLabels(field: ScannedField): string[] | undefined {
  if (field.element instanceof HTMLSelectElement) {
    return [...field.element.options].map((o) => o.label || o.text);
  }
  if (field.kind === 'radio-group' && field.groupElements) {
    return field.groupElements.map((radio) => labelFor(radio) || radio.value);
  }
  return undefined;
}

function widgetKindOf(field: ScannedField): WidgetKind {
  switch (field.kind) {
    case 'text':
      return 'text';
    case 'textarea':
      return 'textarea';
    case 'select':
      return 'select';
    case 'radio-group':
      return 'radio-group';
    case 'checkbox':
      return 'checkbox';
    case 'combobox':
      return 'combobox';
    case 'listbox-button':
      return 'listbox-button';
    case 'contenteditable':
      return 'contenteditable';
    case 'file':
      return 'file';
  }
}

/** Required-ness: attribute, aria, or a `*` in the label (SPEC §7.2). */
function isRequired(el: Element, label: string): boolean {
  if ((el as HTMLInputElement).required) return true;
  if (el.getAttribute('aria-required') === 'true') return true;
  return /\*\s*$/.test(label);
}

export function gatherSignals(field: ScannedField): FieldSignals {
  const el = field.element;
  const isGroup = field.kind === 'radio-group';
  // Groups take the fieldset legend as their label (SPEC §7.2 step 4).
  const label = isGroup ? legendOf(el) || labelFor(el) : labelFor(el) || legendOf(el);
  const ariaLabel = ariaLabelOf(el);
  const placeholder = el.getAttribute('placeholder') ?? undefined;
  const nameId = nameIdOf(el) || undefined;
  const nearby = nearbyTextOf(el) || undefined;
  const autocomplete = el.getAttribute('autocomplete') ?? undefined;
  const maxLengthAttr = el.getAttribute('maxlength');
  const maxLength = maxLengthAttr ? Number(maxLengthAttr) : undefined;
  const inputType =
    el instanceof HTMLInputElement ? (el.getAttribute('type') ?? 'text').toLowerCase() : undefined;

  return {
    fieldId: field.fieldId,
    autocomplete,
    label: label || undefined,
    ariaLabel: ariaLabel || undefined,
    nameId,
    placeholder,
    nearby,
    widget: widgetKindOf(field),
    inputType,
    options: optionLabels(field),
    maxLength:
      maxLength !== undefined && Number.isFinite(maxLength) && maxLength > 0
        ? maxLength
        : undefined,
    required: isRequired(el, label),
  };
}
