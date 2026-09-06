/**
 * The per-page fill session: scan → label → classify → compose, plus fill/undo orchestration.
 * Overlay UI observes this model; all vault access goes through the ProtocolClient.
 */
import type { ProtocolClient } from '../shared/messages.js';
import type { Classification } from '../shared/classify.js';
import {
  classifyFields,
  isSensitiveTarget,
  type ClassifyOptions,
  type FieldSignals,
} from '../shared/classify.js';

type AnswersContext = NonNullable<ClassifyOptions['answers']>;
import type { ComposedValue } from '../shared/compose.js';
import { gatherSignals } from './label.js';
import { scanFields, type ScannedField } from './scan.js';
import { matchChoice } from '../shared/format.js';
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
import { fillCombobox, fillListboxButton, fillSkillTags } from './fillers/widgets.js';

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
  /** All versions (id + name) for the fill bar's inline switcher (SPEC §3.3). */
  versions: { id: string; name: string }[];
  activeVersionId: string;
  /** The active version's resume file, when one exists (SPEC §3.7 attach offer). */
  attachedFile?: { id: string; name: string };
}

// The in-memory site-memory stub (Rung 2 scope) lives on the session: `map…` corrections
// apply for the lifetime of the page only. Real per-origin persistence is SPEC M4.

/** "05/2021" → "05" | "2021"; undefined when the value has no such slice ("Present"). */
function sliceDatePart(value: string, part: 'month' | 'year'): string | undefined {
  const match = /^(\d{2})\/(\d{4})$/.exec(value);
  if (!match) return undefined;
  return part === 'month' ? match[1]! : match[2]!;
}

function byDocumentOrder(a: PlanEntry, b: PlanEntry): number {
  const position = a.field.element.compareDocumentPosition(b.field.element);
  if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
  if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
  return 0;
}

export class FillSession {
  readonly snapshots = new SnapshotStore();
  private state: SessionState = {
    entries: [],
    generation: 0,
    fillAllEligible: false,
    activeVersionName: '',
    versions: [],
    activeVersionId: '',
  };
  private readonly siteMemoryStub = new Map<string, string>();
  /** Latest fill-context answers — sensitivity + question-matching source for corrections. */
  private answersInfo: AnswersContext = [];
  /** Fill outcomes keyed by ELEMENT so ✓/amber badges survive SPA-settle rescans. */
  private readonly fillStates = new WeakMap<Element, NonNullable<PlanEntry['fillState']>>();
  /** Review skips, element-keyed: skipped fields leave the Review count/queue (badge stays). */
  private skippedElements = new WeakSet<Element>();
  private refreshToken = 0;
  private listeners: (() => void)[] = [];

  constructor(private readonly client: ProtocolClient) {}

  get current(): SessionState {
    return this.state;
  }

  /** Answers context for consumers classifying outside the scan (palette loose targets). */
  get answers(): AnswersContext {
    return this.answersInfo;
  }

  onChange(cb: () => void): void {
    this.listeners.push(cb);
  }

  private emit(): void {
    for (const cb of this.listeners) cb();
  }

  /** Full re-scan + classify + compose. Bumps the generation; snapshots survive per element. */
  async refresh(root: ParentNode = document): Promise<SessionState> {
    // Overlapping refreshes: only the newest may commit (stale scans would resurrect
    // out-of-date proposals — SPEC §7.1 scan generations).
    const token = ++this.refreshToken;
    const context = await this.client.send({ t: 'fill.context' });
    this.answersInfo = context.answers;
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
      // Rehydrate prior fill outcomes for elements that survived the re-render.
      fillState: this.fillStates.get(field.element),
    }));

    // Apply in-memory site-memory corrections (they outrank heuristics, SPEC §7.7).
    // NEVER a deny-listed field: skip-tier survives any correction (SPEC §7.9).
    for (const entry of entries) {
      if (entry.classification.tier === 'skip') continue;
      const fingerprint = this.fingerprintOf(entry.field, entry.signals);
      const mapped = fingerprint ? this.siteMemoryStub.get(fingerprint) : undefined;
      if (mapped) {
        const sensitive =
          entry.classification.sensitive || isSensitiveTarget(mapped, this.answersInfo);
        entry.classification = {
          ...entry.classification,
          key: mapped,
          score: 1,
          tier: sensitive ? 'suggest' : 'auto',
          signal: 'site-memory',
          sensitive,
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

    // Defaulted proposals (assumptions like phone type "Mobile") never auto-fill —
    // demote to suggest so they go through a confirm.
    for (const entry of entries) {
      if (entry.value?.defaulted && entry.classification.tier === 'auto') {
        entry.classification = { ...entry.classification, tier: 'suggest' };
      }
    }

    if (token !== this.refreshToken) return this.state; // a newer refresh superseded this one

    this.state = {
      entries,
      generation: this.state.generation + 1,
      fillAllEligible: result.fillAllEligible,
      activeVersionName: context.activeVersionName,
      versions: context.versions,
      activeVersionId: context.activeVersionId,
      attachedFile: context.attachedFile,
    };
    this.emit();
    return this.state;
  }

  /**
   * Auto-tier entries with a non-empty proposal — what "Fill N" fills. Strict DOCUMENT
   * order (radio/checkbox groups scan last, which used to make fill-all scroll back up —
   * one smooth top-to-bottom pass instead), and fields that ALREADY hold the proposed
   * value don't count: SPA re-renders can replace elements and lose our fill markers, and
   * re-offering "Fill N" for already-correct fields looked like extra passes.
   */
  autoEntries(): PlanEntry[] {
    return this.state.entries
      .filter(
        (e) =>
          e.classification.tier === 'auto' &&
          e.value?.value &&
          !e.classification.sensitive &&
          e.fillState === undefined &&
          !this.valueAlreadyApplied(e),
      )
      .sort(byDocumentOrder);
  }

  /** Is the proposed value already on the page (fill happened or user typed it)? */
  private valueAlreadyApplied(entry: PlanEntry): boolean {
    const el = entry.field.element;
    const proposed = entry.value?.value ?? '';
    if (!proposed) return false;
    const targets = entry.value?.choiceTargets ?? [proposed];
    switch (entry.field.kind) {
      case 'text':
      case 'textarea':
      case 'combobox': {
        if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return false;
        const expected = entry.classification.datePart
          ? sliceDatePart(proposed, entry.classification.datePart)
          : proposed;
        return expected !== undefined && el.value === expected;
      }
      case 'select': {
        if (!(el instanceof HTMLSelectElement)) return false;
        const current = el.selectedOptions[0];
        if (!current) return false;
        return matchChoice([current.label || current.text], targets) !== undefined;
      }
      case 'checkbox': {
        if (!(el instanceof HTMLInputElement)) return false;
        const polarity = matchChoice(['yes', 'no'], targets, 0.4);
        return polarity !== undefined && el.checked === (polarity.index === 0);
      }
      case 'radio-group': {
        const radios = entry.field.groupElements ?? [];
        const checked = radios.find((r) => r.checked);
        if (!checked) return false;
        const label = checked.closest('label')?.textContent?.trim() ?? checked.value;
        return matchChoice([label], targets) !== undefined;
      }
      default:
        return false;
    }
  }

  /**
   * Suggest-tier entries — what "Review M" steps through. Sensitive entries are EXCLUDED
   * (lock-badge confirm only, SPEC §3.5/§7.9), and so are entries the user skipped —
   * a skip leaves the count, not just the current queue.
   */
  suggestEntries(): PlanEntry[] {
    return this.state.entries
      .filter(
        (e) =>
          e.classification.tier === 'suggest' &&
          !e.classification.sensitive &&
          (e.value?.value || e.value?.choiceTargets) &&
          e.fillState === undefined &&
          !this.skippedElements.has(e.field.element),
      )
      .sort(byDocumentOrder);
  }

  /** Inline version switch (SPEC §3.3): set active, then re-propose everything. */
  async setActiveVersion(id: string, root: ParentNode = document): Promise<void> {
    await this.client.send({ t: 'version.setActive', id });
    await this.refresh(root);
  }

  /** Review skip: drop the field from the count/queue until Undo resets the session. */
  markSkipped(entry: PlanEntry): void {
    this.skippedElements.add(entry.field.element);
    this.emit();
  }

  /**
   * Fills one entry with the composed value (or an explicit override from the popover).
   * Sensitive entries only fill when `confirmedSensitive` — the popover's explicit confirm
   * (SPEC §7.9); fill-all never sets it. Async: custom widgets await their popups.
   */
  async fillEntry(
    entry: PlanEntry,
    override?: string,
    confirmedSensitive = false,
  ): Promise<FillResult> {
    if (entry.classification.tier === 'skip') {
      return { ok: false, verified: false, reason: 'deny-listed field' };
    }
    if (entry.classification.sensitive && !confirmedSensitive) {
      return { ok: false, verified: false, reason: 'sensitive: explicit confirm required' };
    }
    let value = override ?? entry.value?.value ?? '';
    // Segmented date widgets take one slice of the composed MM/YYYY (SPEC §7.4).
    if (!override && entry.classification.datePart && value) {
      const sliced = sliceDatePart(value, entry.classification.datePart);
      if (sliced !== undefined) {
        value = sliced;
      } else {
        // "Present" (current role) has no month/year slice — tell the user what to do
        // instead of writing garbage into a date segment.
        return {
          ok: false,
          verified: false,
          reason: 'current role — leave the end date blank and tick "currently work here"',
        };
      }
    }
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
        // Polarity by choice matching, not whole-string equality — "Yes, I am authorized…"
        // must CHECK the box, and an unmatchable value must fail loudly (SPEC §7.4).
        // Threshold relaxed: a bare "yes"/"no" inside a verbose stored answer is still a
        // clear polarity; genuinely unrelated values score ~0 and fail below.
        const polarity = matchChoice(['yes', 'no'], targets, 0.4);
        if (!polarity) {
          result = {
            ok: false,
            verified: false,
            reason: 'cannot tell yes from no for this checkbox',
          };
          break;
        }
        result = fillCheckbox(entry.field, polarity.index === 0, this.snapshots);
        break;
      }
      case 'combobox': {
        // Skills tag/chip widgets take the ITEM LIST one chip at a time, not a joined string.
        if (entry.classification.key === 'skills' && (entry.value?.items?.length ?? 0) > 0) {
          result = await fillSkillTags(entry.field, entry.value!.items!);
          break;
        }
        result = await fillCombobox(entry.field, value, targets, this.snapshots);
        break;
      }
      case 'listbox-button':
        result = await fillListboxButton(entry.field, targets);
        break;
      case 'file':
        return { ok: false, verified: false, reason: 'file fields attach via the fill bar' };
      default:
        return { ok: false, verified: false, reason: 'unknown widget' };
    }

    entry.fillState = result.ok ? (result.verified ? 'filled' : 'unverified') : 'failed';
    this.fillStates.set(entry.field.element, entry.fillState);
    this.emit();
    return result;
  }

  undoAll(): number {
    const restored = undoAll(this.snapshots);
    for (const entry of this.state.entries) {
      entry.fillState = undefined;
      this.fillStates.delete(entry.field.element);
    }
    this.skippedElements = new WeakSet(); // skips are review-flow state; Undo resets them
    this.emit();
    return restored;
  }

  undoEntry(entry: PlanEntry): boolean {
    const restored = undoElement(entry.field.element, this.snapshots);
    if (restored) {
      entry.fillState = undefined;
      this.fillStates.delete(entry.field.element);
      this.emit();
    }
    return restored;
  }

  /**
   * `map…` correction: record to the in-memory stub and reclassify now (SPEC §3.4).
   * Deny-listed fields are immune — no correction can promote tier `skip` (SPEC §7.9),
   * and existing sensitivity is never washed away.
   */
  recordMapping(entry: PlanEntry, key: string): boolean {
    if (entry.classification.tier === 'skip') return false;
    const fingerprint = this.fingerprintOf(entry.field, entry.signals);
    if (fingerprint) this.siteMemoryStub.set(fingerprint, key);
    const sensitive = entry.classification.sensitive || isSensitiveTarget(key, this.answersInfo);
    entry.classification = {
      ...entry.classification,
      key,
      score: 1,
      tier: sensitive ? 'suggest' : 'auto',
      signal: 'site-memory',
      sensitive,
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
    return true;
  }

  /**
   * Selector fingerprint (SPEC §7.7 order): stable attribute → label-text hash → none.
   * Returns undefined when nothing stable exists; the correction then applies to this
   * generation's entry only rather than silently never matching again.
   */
  private fingerprintOf(field: ScannedField, signals: FieldSignals): string | undefined {
    const el = field.element;
    const auto = el.getAttribute('data-automation-id');
    if (auto) return `auto:${auto}`;
    const name = el.getAttribute('name');
    if (name) return `name:${name}`;
    const id = el.getAttribute('id');
    // Reject UUID-ish / numeric-suffix ids (SPEC §7.7 — unstable).
    if (id && !/\d{3,}|[0-9a-f]{8}-/.test(id)) return `id:${id}`;
    if (signals.label) return `label:${signals.widget}:${signals.label.toLowerCase().trim()}`;
    return undefined;
  }
}
