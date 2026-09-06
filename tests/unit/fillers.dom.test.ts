// @vitest-environment jsdom
/**
 * Filler unit tests. Assertions are page-observable effects: values landing, events firing
 * on page-side listeners, undo restoring priors — never internal state.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  SnapshotStore,
  fillCheckbox,
  fillRadioGroup,
  fillSelect,
  fillText,
  undoAll,
  undoElement,
} from '../../src/content/fillers/index.js';
import { resetFieldIds, scanFields, type ScannedField } from '../../src/content/scan.js';

function mount(html: string): { fields: ScannedField[]; log: string[] } {
  document.body.innerHTML = html;
  resetFieldIds();
  const log: string[] = [];
  document.body.addEventListener('input', (e) => log.push(`input:${(e.target as Element).id}`));
  document.body.addEventListener('change', (e) => log.push(`change:${(e.target as Element).id}`));
  return { fields: scanFields(document), log };
}

function fieldFor(fields: ScannedField[], selector: string): ScannedField {
  const el = document.querySelector(selector);
  const field = fields.find((f) => f.element === el || f.groupElements?.some((g) => g === el));
  if (!field) throw new Error(`no scanned field for ${selector}`);
  return field;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('fillText', () => {
  it('sets the value and fires input+change on page listeners', () => {
    const { fields, log } = mount('<input id="a" type="text" value="old">');
    const snapshots = new SnapshotStore();
    const result = fillText(fieldFor(fields, '#a'), 'new value', snapshots);
    expect(result).toMatchObject({ ok: true, verified: true });
    expect((document.querySelector('#a') as HTMLInputElement).value).toBe('new value');
    expect(log).toContain('input:a');
    expect(log).toContain('change:a');
  });

  it('works through a framework-style value descriptor (native setter path)', () => {
    const { fields } = mount('<input id="b" type="text">');
    const el = document.querySelector('#b') as HTMLInputElement;
    // Simulate React's tracker: an own-property wrapper that shadows the prototype setter.
    let trackedValue = '';
    const native = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!;
    Object.defineProperty(el, 'value', {
      get: () => native.get!.call(el) as string,
      set: (v: string) => {
        trackedValue = `wrapped:${v}`;
        native.set!.call(el, v);
      },
      configurable: true,
    });
    const result = fillText(fieldFor(fields, '#b'), 'hello', new SnapshotStore());
    expect(result.verified).toBe(true);
    expect(el.value).toBe('hello');
    // The native-setter trick bypasses the wrapper on purpose — the framework is notified
    // via the input event instead, which is what its onChange listens for.
    expect(trackedValue).toBe('');
  });

  it('reports a read-back mismatch instead of lying', () => {
    const { fields } = mount('<input id="c" type="text">');
    const el = document.querySelector('#c') as HTMLInputElement;
    // Hostile page: an input listener that immediately clears the field.
    el.addEventListener('input', () => {
      el.value = '';
    });
    const result = fillText(fieldFor(fields, '#c'), 'value', new SnapshotStore());
    expect(result.ok).toBe(true);
    expect(result.verified).toBe(false);
  });
});

describe('fillSelect', () => {
  const html = `
    <select id="s">
      <option>Choose…</option>
      <option>Yes, I require sponsorship</option>
      <option>No, I will not require sponsorship now or in the future</option>
    </select>`;

  it('matches verbose option labels from choice targets', () => {
    const { fields, log } = mount(html);
    const result = fillSelect(
      fieldFor(fields, '#s'),
      ['no', 'i will not require sponsorship'],
      new SnapshotStore(),
    );
    expect(result.verified).toBe(true);
    expect((document.querySelector('#s') as HTMLSelectElement).selectedIndex).toBe(2);
    expect(log).toContain('change:s');
  });

  it('fails cleanly when nothing matches', () => {
    const { fields } = mount(html);
    const result = fillSelect(fieldFor(fields, '#s'), ['purple'], new SnapshotStore());
    expect(result.ok).toBe(false);
    expect((document.querySelector('#s') as HTMLSelectElement).selectedIndex).toBe(0);
  });
});

describe('fillRadioGroup', () => {
  const html = `
    <fieldset>
      <legend>Do you require sponsorship?</legend>
      <label for="r-yes">Yes</label><input type="radio" name="sp" id="r-yes" value="y">
      <label for="r-no">No</label><input type="radio" name="sp" id="r-no" value="n">
    </fieldset>`;

  it('clicks the radio whose label matches', () => {
    const { fields, log } = mount(html);
    const result = fillRadioGroup(fieldFor(fields, '#r-no'), ['no'], new SnapshotStore());
    expect(result.verified).toBe(true);
    expect((document.querySelector('#r-no') as HTMLInputElement).checked).toBe(true);
    expect(log.some((e) => e.startsWith('change:r-no') || e.startsWith('input:r-no'))).toBe(true);
  });

  it('fails cleanly with no match and touches nothing', () => {
    const { fields } = mount(html);
    const result = fillRadioGroup(fieldFor(fields, '#r-no'), ['maybe'], new SnapshotStore());
    expect(result.ok).toBe(false);
    expect((document.querySelector('#r-yes') as HTMLInputElement).checked).toBe(false);
    expect((document.querySelector('#r-no') as HTMLInputElement).checked).toBe(false);
  });
});

describe('fillCheckbox', () => {
  it('checks an unchecked box and leaves an already-correct box alone', () => {
    const { fields, log } = mount('<input type="checkbox" id="cb">');
    const field = fieldFor(fields, '#cb');
    const snapshots = new SnapshotStore();
    expect(fillCheckbox(field, true, snapshots).verified).toBe(true);
    expect((document.querySelector('#cb') as HTMLInputElement).checked).toBe(true);
    const events = log.length;
    expect(fillCheckbox(field, true, snapshots).verified).toBe(true);
    expect(log.length).toBe(events); // no redundant click
  });
});

describe('undo (SPEC §7.8)', () => {
  it('restores text, select, radio and checkbox to pre-fill state', () => {
    const { fields } = mount(`
      <input id="t" value="original">
      <select id="s"><option>A</option><option>B</option></select>
      <fieldset>
        <label for="ry">Yes</label><input type="radio" name="g" id="ry">
        <label for="rn">No</label><input type="radio" name="g" id="rn">
      </fieldset>
      <input type="checkbox" id="cb">`);
    const snapshots = new SnapshotStore();

    fillText(fieldFor(fields, '#t'), 'changed', snapshots);
    fillSelect(fieldFor(fields, '#s'), ['b'], snapshots);
    fillRadioGroup(fieldFor(fields, '#ry'), ['yes'], snapshots);
    fillCheckbox(fieldFor(fields, '#cb'), true, snapshots);

    expect((document.querySelector('#t') as HTMLInputElement).value).toBe('changed');
    const restored = undoAll(snapshots);
    expect(restored).toBeGreaterThanOrEqual(4);

    expect((document.querySelector('#t') as HTMLInputElement).value).toBe('original');
    expect((document.querySelector('#s') as HTMLSelectElement).selectedIndex).toBe(0);
    expect((document.querySelector('#ry') as HTMLInputElement).checked).toBe(false);
    expect((document.querySelector('#rn') as HTMLInputElement).checked).toBe(false);
    expect((document.querySelector('#cb') as HTMLInputElement).checked).toBe(false);
  });

  it('restores the previously-checked radio when one existed', () => {
    const { fields } = mount(`
      <fieldset>
        <label for="a1">First</label><input type="radio" name="g" id="a1" checked>
        <label for="a2">Second</label><input type="radio" name="g" id="a2">
      </fieldset>`);
    const snapshots = new SnapshotStore();
    fillRadioGroup(fieldFor(fields, '#a1'), ['second'], snapshots);
    expect((document.querySelector('#a2') as HTMLInputElement).checked).toBe(true);
    undoAll(snapshots);
    expect((document.querySelector('#a1') as HTMLInputElement).checked).toBe(true);
  });

  it('per-element undo reverts just that field', () => {
    const { fields } = mount('<input id="x" value="ox"><input id="y" value="oy">');
    const snapshots = new SnapshotStore();
    fillText(fieldFor(fields, '#x'), 'nx', snapshots);
    fillText(fieldFor(fields, '#y'), 'ny', snapshots);
    undoElement(document.querySelector('#x')!, snapshots);
    expect((document.querySelector('#x') as HTMLInputElement).value).toBe('ox');
    expect((document.querySelector('#y') as HTMLInputElement).value).toBe('ny');
  });

  it('first snapshot wins across repeated fills (undo goes to the true prior)', () => {
    const { fields } = mount('<input id="z" value="original">');
    const snapshots = new SnapshotStore();
    const field = fieldFor(fields, '#z');
    fillText(field, 'first change', snapshots);
    fillText(field, 'second change', snapshots);
    undoAll(snapshots);
    expect((document.querySelector('#z') as HTMLInputElement).value).toBe('original');
  });
});
