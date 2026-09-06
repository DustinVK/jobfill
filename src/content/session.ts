/**
 * The per-page fill session: scan → label → classify → compose, plus fill/undo orchestration.
 * Overlay UI observes this model; all vault access goes through the ProtocolClient.
 */
import type { ProtocolClient } from '../shared/messages.js';
import type { Classification } from '../shared/classify.js';
import { classifyFields, type FieldSignals } from '../shared/classify.js';
import type { ComposedValue } from '../shared/compose.js';
import { gatherSignals } from './label.js';
import { scanFields, type ScannedField } from './scan.js';
import {
  SnapshotStore,
  fillCheckbox,
  fillContentEditable,
  fillRadioGroup,
  fillSelect,
  fillText,
  undoAll,
  undoElement,
  type FillResult,
} from './fillers/index.js';

export interface PlanEntry {
  field: ScannedField;
  signals: FieldSignals;
  classification: Classification;
  /** Composed proposal; undefined until fetched, null when the vault has nothing. */
  value?: ComposedValue | null;
  /** Set after a fill attempt. */
  fillState?: 'filled' | 'unverified' | 'failed';
}

export interface SessionState {
  entries: PlanEntry[];
  generation: number;
  fillAllEligible: boolean;
  activeVersionName: string;
}

/**
 * In-memory site-memory stub (Rung 2 scope): `map…` corrections apply for the lifetime of
 * the page only. Real per-origin persistence is SPEC M4, out of scope tonight.
 */
export interface MemoryMapping {
  fingerprint: string;
  key: string;
}

function fingerprintOf(field: ScannedField): string {
  const el = field.element;
  const auto = el.getAttribute('data-automation-id');
  if (auto) return `auto:${auto}`;
  const name = el.getAttribute('name');
  if (name) return `name:${name}`;
  const id = el.getAttribute('id');
  // Reject UUID-ish / numeric-suffix ids (SPEC §7.7 — unstable).
  if (id && !/\d{3,}|[0-9a-f]{8}-/.test(id)) return `id:${id}`;
  return `idx:${field.fieldId}`;
}

export class FillSession {
  readonly snapshots = new SnapshotStore();
  private state: SessionState = {
    entries: [],
    generation: 0,
    fillAllEligible: false,
    activeVersionName: '',
  };
  private readonly siteMemoryStub = new Map<string, string>();
  private listeners: (() => void)[] = [];

  constructor(private readonly client: ProtocolClient) {}

  get current(): SessionState {
    return this.state;
  }

  onChange(cb: () => void): void {
    this.listeners.push(cb);
  }

  private emit(): void {
    for (const cb of this.listeners) cb();
  }

  /** Full re-scan + classify + compose. Bumps the generation; snapshots survive per element. */
  async refresh(root: ParentNode = document): Promise<SessionState> {
    const context = await this.client.send({ t: 'fill.context' });
    const fields = scanFields(root);
    const signals = fields.map(gatherSignals);
    const result = classifyFields(signals, {
      answers: context.answers,
      fillAllThreshold: context.fillAllThreshold,
      suggestThreshold: context.suggestThreshold,
    });

    const entries: PlanEntry[] = fields.map((field, i) => ({
      field,
      signals: signals[i]!,
      classification: result.fields[i]!,
    }));

    // Apply in-memory site-memory corrections (they outrank heuristics, SPEC §7.7).
    for (const entry of entries) {
      const mapped = this.siteMemoryStub.get(fingerprintOf(entry.field));
      if (mapped) {
        entry.classification = {
          ...entry.classification,
          key: mapped,
          score: 1,
          tier: mapped.startsWith('eeo.') ? 'suggest' : 'auto',
          signal: 'site-memory',
          sensitive: mapped.startsWith('eeo.') || entry.classification.sensitive,
        };
      }
    }

    // Compose values for keyed, non-skip fields (cached per generation by construction).
    await Promise.all(
      entries
        .filter((e) => e.classification.key && e.classification.tier !== 'skip')
        .map(async (entry) => {
          try {
            entry.value = await this.client.send({
              t: 'compose',
              key: entry.classification.key!,
              opts: {
                maxLength: entry.signals.maxLength,
                multiline:
                  entry.signals.widget === 'textarea' || entry.signals.widget === 'contenteditable',
                phoneFormat: entry.classification.phoneFormat,
              },
            });
          } catch {
            entry.value = null;
          }
        }),
    );

    this.state = {
      entries,
      generation: this.state.generation + 1,
      fillAllEligible: result.fillAllEligible,
      activeVersionName: context.activeVersionName,
    };
    this.emit();
    return this.state;
  }

  /** Auto-tier entries with a non-empty proposal — what "Fill N" fills. */
  autoEntries(): PlanEntry[] {
    return this.state.entries.filter(
      (e) =>
        e.classification.tier === 'auto' &&
        e.value?.value &&
        !e.classification.sensitive &&
        e.fillState === undefined,
    );
  }

  /** Suggest-tier entries — what "Review M" steps through. */
  suggestEntries(): PlanEntry[] {
    return this.state.entries.filter(
      (e) => e.classification.tier === 'suggest' && (e.value?.value || e.value?.choiceTargets),
    );
  }

  /**
   * Fills one entry with the composed value (or an explicit override from the popover).
   * Sensitive entries only fill when `confirmedSensitive` — the popover's explicit confirm
   * (SPEC §7.9); fill-all never sets it.
   */
  fillEntry(entry: PlanEntry, override?: string, confirmedSensitive = false): FillResult {
    if (entry.classification.tier === 'skip') {
      return { ok: false, verified: false, reason: 'deny-listed field' };
    }
    if (entry.classification.sensitive && !confirmedSensitive) {
      return { ok: false, verified: false, reason: 'sensitive: explicit confirm required' };
    }
    const value = override ?? entry.value?.value ?? '';
    const targets = override ? [override] : (entry.value?.choiceTargets ?? (value ? [value] : []));

    let result: FillResult;
    switch (entry.field.kind) {
      case 'text':
      case 'textarea':
        result = fillText(entry.field, value, this.snapshots);
        break;
      case 'contenteditable':
        result = fillContentEditable(entry.field, value, this.snapshots);
        break;
      case 'select':
        result = fillSelect(entry.field, targets, this.snapshots);
        break;
      case 'radio-group':
        result = fillRadioGroup(entry.field, targets, this.snapshots);
        break;
      case 'checkbox': {
        const shouldCheck = /^(yes|true|checked|on|1)$/i.test(value);
        result = fillCheckbox(entry.field, shouldCheck, this.snapshots);
        break;
      }
      case 'combobox': {
        // Best-effort text entry into the combobox's input; read-back verification reports
        // honestly. Full typeahead driving (options await + click) is Rung 4.
        result = fillText(entry.field, value, this.snapshots);
        if (result.ok)
          result = {
            ...result,
            reason: result.reason ?? 'combobox: typed text only — confirm the site accepted it',
          };
        break;
      }
      case 'listbox-button':
      case 'file':
        return { ok: false, verified: false, reason: `cannot drive ${entry.field.kind} tonight` };
      default:
        return { ok: false, verified: false, reason: 'unknown widget' };
    }

    entry.fillState = result.ok ? (result.verified ? 'filled' : 'unverified') : 'failed';
    this.emit();
    return result;
  }

  /** Fill-all (SPEC §3.5): every eligible auto-tier field. Returns per-entry results. */
  fillAll(): { entry: PlanEntry; result: FillResult }[] {
    const results = this.autoEntries().map((entry) => ({
      entry,
      result: this.fillEntry(entry),
    }));
    this.emit();
    return results;
  }

  undoAll(): number {
    const restored = undoAll(this.snapshots);
    for (const entry of this.state.entries) entry.fillState = undefined;
    this.emit();
    return restored;
  }

  undoEntry(entry: PlanEntry): boolean {
    const restored = undoElement(entry.field.element, this.snapshots);
    if (restored) {
      entry.fillState = undefined;
      this.emit();
    }
    return restored;
  }

  /** `map…` correction: record to the in-memory stub and reclassify now (SPEC §3.4). */
  recordMapping(entry: PlanEntry, key: string): void {
    this.siteMemoryStub.set(fingerprintOf(entry.field), key);
    entry.classification = {
      ...entry.classification,
      key,
      score: 1,
      tier: key.startsWith('eeo.') ? 'suggest' : 'auto',
      signal: 'site-memory',
      sensitive: key.startsWith('eeo.'),
    };
    // Refetch the proposal for the corrected key.
    void this.client
      .send({
        t: 'compose',
        key,
        opts: {
          maxLength: entry.signals.maxLength,
          multiline: entry.signals.widget === 'textarea',
        },
      })
      .then((value) => {
        entry.value = value;
        this.emit();
      })
      .catch(() => {
        entry.value = null;
        this.emit();
      });
    this.emit();
  }
}
