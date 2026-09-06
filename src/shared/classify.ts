/**
 * Field classification — SPEC §7.3, pure logic (no DOM; `label.ts` gathers the signals).
 *
 * Precedence: site profile/memory (applied by the caller before this runs) → autocomplete
 * token map → regex heuristics. Score = max(signalWeight × ruleScore) over signals.
 * Includes the rationalization pass, the min-signal guard, and question matching.
 */
import type { AnswerEntry, CanonicalKey } from './types.js';
import type { PhoneFormat } from './format.js';
import type { WidgetKind } from './types.js';
import { mapAutocomplete } from './rules/autocomplete-map.js';
import {
  HEURISTIC_RULES,
  NAME_GUARDED_KEYS,
  NAME_IGNORED_RE,
  type HeuristicRule,
} from './rules/heuristics.js';
import { DENY_INPUT_TYPES, denyMatch } from './rules/deny-list.js';

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** One field's gathered signals (SPEC §7.2), all optional except the widget shape. */
export interface FieldSignals {
  /** Stable id for correlating back to the DOM element (scan.ts assigns). */
  fieldId: string;
  autocomplete?: string;
  /** <label for>/wrapping label, or fieldset legend for groups. */
  label?: string;
  /** aria-label / resolved aria-labelledby. */
  ariaLabel?: string;
  /** Humanized name/id/data-* ("legalNameSection_firstName" → "legal name section first name"). */
  nameId?: string;
  placeholder?: string;
  /** Nearby text (capped tree walk). */
  nearby?: string;
  widget: WidgetKind;
  /** input type attribute, lowercased, when applicable. */
  inputType?: string;
  /** Option labels for choice widgets. */
  options?: string[];
  maxLength?: number;
  required?: boolean;
}

/** Signal weights per SPEC §7.3. */
const SIGNAL_WEIGHTS: readonly { source: keyof FieldSignals & string; weight: number }[] = [
  { source: 'label', weight: 0.9 },
  { source: 'ariaLabel', weight: 0.85 },
  { source: 'nameId', weight: 0.7 },
  { source: 'placeholder', weight: 0.6 },
  { source: 'nearby', weight: 0.4 },
];

export type Tier = 'auto' | 'suggest' | 'manual' | 'skip';

export interface Classification {
  fieldId: string;
  key?: CanonicalKey;
  score: number;
  tier: Tier;
  /** Which signal source won, for debugging and fixture reports. */
  signal?: string;
  /** Deny rule name when tier is skip. */
  denyReason?: string;
  /** True for question-shaped fields matched against the answers bank. */
  isQuestion?: boolean;
  /** Matched AnswerEntry id for question fields. */
  answerId?: string;
  /** Sensitive keys are never auto (SPEC §7.9). */
  sensitive?: boolean;
  /** Phone format hint from the autocomplete token. */
  phoneFormat?: PhoneFormat;
}

export interface ClassifyOptions {
  fillAllThreshold?: number;
  suggestThreshold?: number;
  /** Answers bank for question matching (id + patterns + question text + sensitivity). */
  answers?: Pick<AnswerEntry, 'id' | 'key' | 'question' | 'patterns' | 'sensitive'>[];
}

/** Answers-bank shape needed for sensitivity decisions (id + key + sensitive). */
export type AnswerSensitivityInfo = Pick<AnswerEntry, 'id' | 'key' | 'sensitive'>;

/**
 * THE sensitivity rule, shared by every consumer (classifier, site-memory apply, map…):
 * eeo.* keys are always sensitive; answers.* keys inherit the bank entry's own flag.
 */
export function isSensitiveTarget(key: CanonicalKey, answers: AnswerSensitivityInfo[]): boolean {
  if (key.startsWith('eeo.')) return true;
  if (key.startsWith('answers.custom:')) {
    const id = key.slice('answers.custom:'.length);
    return answers.some((a) => a.id === id && a.sensitive);
  }
  if (key.startsWith('answers.')) {
    const wellKnown = key.slice('answers.'.length);
    return answers.some((a) => a.key === wellKnown && a.sensitive);
  }
  return false;
}

export interface ClassifyResult {
  fields: Classification[];
  /**
   * Min-signal guard (SPEC §7.3): fill-all is only offered when ≥3 fields classified or ≥1
   * exact autocomplete match — avoids proudly filling a search box.
   */
  fillAllEligible: boolean;
}

// ---------------------------------------------------------------------------
// Canonicalization
// ---------------------------------------------------------------------------

/** Lowercase, split camelCase and _-, collapse punctuation/whitespace (SPEC §7.2). */
export function canonicalizeSignal(raw: string): string {
  return raw
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[_\-/]+/g, ' ')
    .replace(/[^\p{L}\p{N}'.?]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const QUESTION_LENGTH = 60;

function isQuestionShaped(text: string): boolean {
  // Required-field markers ("…sponsorship? *") must not hide the question mark.
  const cleaned = text.replace(/[\s*:]+$/u, '');
  return cleaned.length > QUESTION_LENGTH || cleaned.endsWith('?');
}

// ---------------------------------------------------------------------------
// Core scoring
// ---------------------------------------------------------------------------

function widgetGroup(field: FieldSignals): 'file' | 'multiline' | 'singleline' | 'choice' {
  if (field.widget === 'file') return 'file';
  if (field.widget === 'textarea' || field.widget === 'contenteditable') return 'multiline';
  if (
    field.widget === 'select' ||
    field.widget === 'radio-group' ||
    field.widget === 'checkbox' ||
    field.widget === 'combobox' ||
    field.widget === 'listbox-button'
  ) {
    return 'choice';
  }
  return 'singleline';
}

function ruleApplies(rule: HeuristicRule, field: FieldSignals, questionShaped: boolean): boolean {
  if (rule.widgets && !rule.widgets.includes(widgetGroup(field))) return false;
  if (rule.questionContext && !questionShaped) return false;
  return true;
}

interface Candidate {
  key: CanonicalKey;
  score: number;
  signal: string;
}

function scoreHeuristics(field: FieldSignals, questionShaped: boolean): Candidate | undefined {
  let best: Candidate | undefined;
  for (const { source, weight } of SIGNAL_WEIGHTS) {
    const raw = field[source];
    if (typeof raw !== 'string' || raw.length === 0) continue;
    const haystack = canonicalizeSignal(raw);
    if (haystack.length === 0) continue;
    const nameGuarded = NAME_IGNORED_RE.test(haystack);
    for (const rule of HEURISTIC_RULES) {
      if (!ruleApplies(rule, field, questionShaped)) continue;
      if (nameGuarded && NAME_GUARDED_KEYS.includes(rule.key)) continue;
      if (!rule.positive.test(haystack)) continue;
      if (rule.negative?.test(haystack)) continue;
      const score = weight;
      if (!best || score > best.score) best = { key: rule.key, score, signal: source };
    }
  }
  return best;
}

function denyCheck(field: FieldSignals): string | undefined {
  if (field.inputType && DENY_INPUT_TYPES.includes(field.inputType)) return 'password';
  for (const { source } of SIGNAL_WEIGHTS) {
    const raw = field[source];
    if (typeof raw !== 'string' || raw.length === 0) continue;
    const match = denyMatch(canonicalizeSignal(raw));
    if (match) return match;
  }
  if (field.autocomplete) {
    const match = denyMatch(canonicalizeSignal(field.autocomplete));
    if (match) return match;
  }
  return undefined;
}

function matchQuestion(
  questionText: string,
  answers: NonNullable<ClassifyOptions['answers']>,
): { answerId: string; key?: CanonicalKey; score: number; sensitive: boolean } | undefined {
  const haystack = canonicalizeSignal(questionText);
  for (const answer of answers) {
    for (const pattern of answer.patterns) {
      let re: RegExp;
      try {
        re = new RegExp(pattern, 'i');
      } catch {
        continue; // user-authored pattern; a bad regex must never break scanning
      }
      if (re.test(haystack) || re.test(questionText)) {
        return {
          answerId: answer.id,
          key: answer.key ? `answers.${answer.key}` : `answers.custom:${answer.id}`,
          score: 0.85,
          sensitive: answer.sensitive,
        };
      }
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Rationalization pass (SPEC §7.3)
// ---------------------------------------------------------------------------

/** Ambiguous "name" shapes that really mean the full name when no last-name sibling exists. */
const AMBIGUOUS_NAME_RE = /(^|\s)name($|\s)/;
const EXPLICIT_FIRST_RE = /first|given|fname|forename/;

function rationalize(fields: FieldSignals[], results: Map<string, Classification>): void {
  const byKey = (key: CanonicalKey) =>
    [...results.values()].filter((r) => r.key === key && r.tier !== 'skip');

  // A lone AMBIGUOUS name field with no last-name sibling → full name (SPEC §7.3).
  // A field explicitly labelled "First name" is NOT rewritten — writing "Maya Okafor" into
  // a first-name box is worse than writing "Maya" into a full-name box (rung-2 review P1-6).
  const firstNames = byKey('identity.firstName');
  const lastNames = byKey('identity.lastName');
  if (firstNames.length > 0 && lastNames.length === 0) {
    const signalsById = new Map(fields.map((f) => [f.fieldId, f]));
    for (const result of firstNames) {
      const signals = signalsById.get(result.fieldId);
      if (!signals) continue;
      const haystacks = [signals.label, signals.ariaLabel, signals.nameId, signals.placeholder]
        .filter((raw): raw is string => typeof raw === 'string' && raw.length > 0)
        .map(canonicalizeSignal);
      const explicitlyFirst = haystacks.some((h) => EXPLICIT_FIRST_RE.test(h));
      const ambiguousName = haystacks.some(
        (h) => AMBIGUOUS_NAME_RE.test(h) && !EXPLICIT_FIRST_RE.test(h),
      );
      if (!explicitlyFirst && ambiguousName) {
        result.key = 'identity.fullName';
      }
    }
  }

  // "state"/"country" with no other address signal on the page → suspect; cut the score.
  const addressKeys: CanonicalKey[] = [
    'address.line1',
    'address.line2',
    'address.city',
    'address.postalCode',
    'address.full',
  ];
  const hasAddressContext = [...results.values()].some(
    (r) => r.key !== undefined && addressKeys.includes(r.key),
  );
  if (!hasAddressContext) {
    for (const result of [...byKey('address.state'), ...byKey('address.country')]) {
      result.score = result.score * 0.5;
    }
  }

  // A text input inside a combobox wrapper was already reassigned widget 'combobox' by
  // scan.ts — widget reassignment is a scan-time concern, not a classification one.
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function classifyFields(fields: FieldSignals[], opts: ClassifyOptions = {}): ClassifyResult {
  const fillAllThreshold = opts.fillAllThreshold ?? 0.8;
  const suggestThreshold = opts.suggestThreshold ?? 0.5;
  const answers = opts.answers ?? [];

  const results = new Map<string, Classification>();
  let exactAutocompleteHits = 0;

  for (const field of fields) {
    // 1. Deny-list beats everything (SPEC §7.3: deny → skip regardless).
    const denyReason = denyCheck(field);
    if (denyReason) {
      results.set(field.fieldId, {
        fieldId: field.fieldId,
        score: 0,
        tier: 'skip',
        denyReason,
      });
      continue;
    }

    // 2. Question-shaped labels match the answers bank, not the field taxonomy.
    const labelText = field.label ?? field.ariaLabel ?? '';
    const questionShaped = isQuestionShaped(labelText);
    if (questionShaped && answers.length > 0) {
      const match = matchQuestion(labelText, answers);
      if (match) {
        results.set(field.fieldId, {
          fieldId: field.fieldId,
          key: match.key,
          score: match.score,
          tier: 'suggest', // questions always confirm-first, never fill-all silently
          isQuestion: true,
          answerId: match.answerId,
          sensitive: match.sensitive,
          signal: 'question',
        });
        continue;
      }
    }

    // 3. Autocomplete token map (authoritative, weight 1.0).
    const autocompleteHit = mapAutocomplete(field.autocomplete);
    if (autocompleteHit) {
      exactAutocompleteHits++;
      results.set(field.fieldId, {
        fieldId: field.fieldId,
        key: autocompleteHit.key,
        score: 1,
        tier: 'auto',
        signal: 'autocomplete',
        phoneFormat: autocompleteHit.phoneFormat,
      });
      continue;
    }

    // 4. Regex heuristics.
    const candidate = scoreHeuristics(field, questionShaped);
    if (candidate) {
      results.set(field.fieldId, {
        fieldId: field.fieldId,
        key: candidate.key,
        score: candidate.score,
        tier: 'manual', // final tier assigned after rationalization
        signal: candidate.signal,
        ...(questionShaped ? { isQuestion: true } : {}),
      });
    } else {
      results.set(field.fieldId, { fieldId: field.fieldId, score: 0, tier: 'manual' });
    }
  }

  rationalize(fields, results);

  // Assign tiers post-rationalization; sensitive keys never reach auto (SPEC §7.9).
  // Sensitivity comes from BOTH the key prefix (eeo.*) and the answers bank's own flags —
  // a heuristic hit on answers.salaryExpectation must inherit that entry's sensitive bit.
  for (const result of results.values()) {
    if (result.tier === 'skip') continue;
    const sensitive =
      result.sensitive || (result.key !== undefined && isSensitiveTarget(result.key, answers));
    if (sensitive) result.sensitive = true;
    if (result.key === undefined || result.score < suggestThreshold) {
      result.tier = 'manual';
    } else if (result.score >= fillAllThreshold && !sensitive && !result.isQuestion) {
      result.tier = 'auto';
    } else {
      result.tier = 'suggest';
    }
  }

  const classified = [...results.values()].filter(
    (r) => r.key !== undefined && r.tier !== 'skip' && r.tier !== 'manual',
  ).length;
  const fillAllEligible = classified >= 3 || exactAutocompleteHits >= 1;

  return { fields: fields.map((f) => results.get(f.fieldId)!), fillAllEligible };
}
