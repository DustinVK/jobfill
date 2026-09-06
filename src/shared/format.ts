/**
 * Derived values and formatters — SPEC §5.2, §5.3, §5.4.
 * Pure functions, no DOM and no extension imports. Tested hard: everything the composer
 * renders passes through here.
 */
import type { Identity, PhoneNumber, PostalAddress, YearMonth } from './types.js';

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** Lever's single `name` field and friends (SPEC §5.2). */
export function fullName(identity: Identity): string {
  return [identity.firstName, identity.middleName, identity.lastName]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(' ');
}

/** Full name including honorific/suffix, for the rare form that wants the whole thing. */
export function fullNameWithAffixes(identity: Identity): string {
  const core = fullName(identity);
  const parts = [identity.honorific?.trim(), core, identity.suffix?.trim()].filter(Boolean);
  return parts.join(' ').trim();
}

// ---------------------------------------------------------------------------
// Phone (SPEC §5.2 — popover-cyclable formats)
// ---------------------------------------------------------------------------

export const PHONE_FORMATS = ['national', 'digits', 'e164', 'dashed'] as const;
export type PhoneFormat = (typeof PHONE_FORMATS)[number];

function digitsOnly(value: string): string {
  return value.replace(/\D+/g, '');
}

/**
 * Formats a stored `{countryCode, national}` pair.
 *
 * `national` and `dashed` use the NANP grouping only when the national number is exactly ten
 * digits; anything else falls back to the raw digit string rather than inventing a grouping
 * for a country whose conventions we do not model.
 */
export function formatPhone(phone: PhoneNumber, format: PhoneFormat = 'national'): string {
  const national = digitsOnly(phone.national);
  const country = digitsOnly(phone.countryCode);
  if (national.length === 0) return '';

  switch (format) {
    case 'digits':
      return national;
    case 'e164':
      return country ? `+${country}${national}` : national;
    case 'dashed':
      return national.length === 10
        ? `${national.slice(0, 3)}-${national.slice(3, 6)}-${national.slice(6)}`
        : national;
    case 'national':
    default:
      return national.length === 10
        ? `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`
        : national;
  }
}

/** The remaining formats, in cycle order, for the popover's variant switcher. */
export function phoneAlternates(phone: PhoneNumber, current: PhoneFormat): string[] {
  return PHONE_FORMATS.filter((f) => f !== current).map((f) => formatPhone(phone, f));
}

// ---------------------------------------------------------------------------
// Address
// ---------------------------------------------------------------------------

/** One-line joined address (SPEC §5.2 `address.full`). */
export function formatAddressFull(address: PostalAddress): string {
  const street = [address.line1, address.line2].filter(Boolean).join(' ');
  const locality = [address.city, address.state].filter(Boolean).join(', ');
  const tail = [locality, address.postalCode].filter(Boolean).join(' ');
  return [street, tail, address.country].filter(Boolean).join(', ');
}

// ---------------------------------------------------------------------------
// Dates (SPEC §5.2)
// ---------------------------------------------------------------------------

export const DATE_FORMATS = [
  'MM/YYYY',
  'MM/DD/YYYY',
  'YYYY-MM',
  'Month YYYY',
  'Mon YYYY',
  'YYYY',
] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export interface YearMonthParts {
  year: number;
  /** 1-12 */
  month: number;
}

/** Parses "2021-05". Returns undefined for anything that is not a valid YearMonth. */
export function parseYearMonth(value: YearMonth | undefined): YearMonthParts | undefined {
  if (!value) return undefined;
  const match = /^(\d{4})-(\d{2})$/.exec(value.trim());
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return undefined;
  return { year, month };
}

export const PRESENT = 'Present';

/**
 * Formats a YearMonth. Returns `''` for unparseable input — the composer treats empty as
 * "nothing to propose" rather than filling a field with garbage.
 */
export function formatDate(value: YearMonth | undefined, format: DateFormat = 'MM/YYYY'): string {
  const parts = parseYearMonth(value);
  if (!parts) return '';
  const mm = String(parts.month).padStart(2, '0');
  const yyyy = String(parts.year);
  const monthName = MONTH_NAMES[parts.month - 1] ?? '';
  switch (format) {
    case 'MM/DD/YYYY':
      // Day precision is not modeled; ATS forms that demand a day accept the 1st.
      return `${mm}/01/${yyyy}`;
    case 'YYYY-MM':
      return `${yyyy}-${mm}`;
    case 'Month YYYY':
      return `${monthName} ${yyyy}`;
    case 'Mon YYYY':
      return `${monthName.slice(0, 3)} ${yyyy}`;
    case 'YYYY':
      return yyyy;
    case 'MM/YYYY':
    default:
      return `${mm}/${yyyy}`;
  }
}

/** End dates render as "Present" when the entity is current (SPEC §5.2). */
export function formatEndDate(
  endDate: YearMonth | undefined,
  current: boolean,
  format: DateFormat = 'MM/YYYY',
): string {
  if (current) return PRESENT;
  return formatDate(endDate, format);
}

/** Segmented date widgets get parts, not a formatted string (SPEC §7.4 `date-segmented`). */
export function dateSegments(
  value: YearMonth | undefined,
): { month: string; day: string; year: string } | undefined {
  const parts = parseYearMonth(value);
  if (!parts) return undefined;
  return { month: String(parts.month).padStart(2, '0'), day: '01', year: String(parts.year) };
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

export const LIST_JOINERS = { comma: ', ', newline: '\n', middot: ' · ' } as const;
export type ListJoiner = keyof typeof LIST_JOINERS;

export function joinList(items: string[], joiner: ListJoiner = 'comma'): string {
  return items.filter((item) => item.trim().length > 0).join(LIST_JOINERS[joiner]);
}

// ---------------------------------------------------------------------------
// Snippet renderers for big text fields (SPEC §5.3)
// ---------------------------------------------------------------------------

export const RENDERERS = ['paragraph', 'bullets', 'paragraph+bullets', 'plain-join'] as const;
export type Renderer = (typeof RENDERERS)[number];

export interface RenderInput {
  /** Resolved summary text (may be empty). */
  paragraph: string;
  /** Resolved bullet texts, in include order. */
  bullets: string[];
  /** Bullet prefix; `- ` is friendlier to plain-text-only fields. */
  bulletPrefix?: string;
}

export function render(input: RenderInput, renderer: Renderer): string {
  const prefix = input.bulletPrefix ?? '• ';
  const bullets = input.bullets.filter((b) => b.trim().length > 0);
  switch (renderer) {
    case 'bullets':
      return bullets.map((b) => `${prefix}${b}`).join('\n');
    case 'paragraph+bullets': {
      const list = bullets.map((b) => `${prefix}${b}`).join('\n');
      return [input.paragraph, list].filter((part) => part.length > 0).join('\n\n');
    }
    case 'plain-join':
      // For sites that strip newlines: sentence-joined, each bullet terminated.
      return bullets.map((b) => (/[.!?]$/.test(b.trim()) ? b.trim() : `${b.trim()}.`)).join(' ');
    case 'paragraph':
    default:
      return input.paragraph;
  }
}

/**
 * Picks a default renderer from the field's shape (SPEC §5.3: "default chosen by heuristics on
 * field size/maxlength"). Small budgets get the paragraph; roomy textareas get both.
 */
export function defaultRenderer(opts: {
  multiline: boolean;
  maxLength?: number;
  rows?: number;
}): Renderer {
  if (!opts.multiline) return 'paragraph';
  if (opts.maxLength !== undefined && opts.maxLength < 300) return 'paragraph';
  if (opts.maxLength !== undefined && opts.maxLength < 600) return 'bullets';
  if ((opts.rows ?? 0) >= 6 || opts.maxLength === undefined) return 'paragraph+bullets';
  return 'bullets';
}

// ---------------------------------------------------------------------------
// Length budget (SPEC §5.3)
// ---------------------------------------------------------------------------

export interface BudgetResult {
  text: string;
  /** True when the text had to be hard-cut, so the popover can warn (SPEC §5.3). */
  truncated: boolean;
  /** How many trailing bullets were dropped to fit. */
  droppedBullets: number;
  /** True when the shorter variant set was used instead of the preferred one. */
  usedShortVariants: boolean;
}

export interface BudgetCandidates {
  /** Preferred rendering inputs (the version's resolved variants). */
  preferred: RenderInput;
  /** Same content resolved with `short`-style variants, when any exist. */
  short?: RenderInput;
}

/** Truncates at a word boundary, never mid-word (SPEC §5.3). */
export function truncateAtWord(text: string, maxLength: number): string {
  if (maxLength <= 0) return '';
  if (text.length <= maxLength) return text;
  const slice = text.slice(0, maxLength);
  const lastBreak = Math.max(slice.lastIndexOf(' '), slice.lastIndexOf('\n'));
  // If there is no break in the last 25% of the budget, a hard cut beats returning almost nothing.
  const cut = lastBreak > maxLength * 0.5 ? lastBreak : maxLength;
  return slice.slice(0, cut).trimEnd();
}

/**
 * Fits rendered content into `maxLength`: try preferred → try `short` variants → drop trailing
 * bullets → hard-truncate at a word boundary. Never silently overflows (SPEC §5.3).
 */
export function fitToBudget(
  candidates: BudgetCandidates,
  renderer: Renderer,
  maxLength?: number,
): BudgetResult {
  const base = render(candidates.preferred, renderer);
  if (maxLength === undefined || base.length <= maxLength) {
    return { text: base, truncated: false, droppedBullets: 0, usedShortVariants: false };
  }

  const attempts: { input: RenderInput; short: boolean }[] = [
    { input: candidates.preferred, short: false },
  ];
  if (candidates.short) attempts.push({ input: candidates.short, short: true });

  for (const attempt of attempts.slice().reverse()) {
    const whole = render(attempt.input, renderer);
    if (whole.length <= maxLength) {
      return {
        text: whole,
        truncated: false,
        droppedBullets: 0,
        usedShortVariants: attempt.short,
      };
    }
  }

  // Drop trailing bullets from the shortest candidate we have.
  const best = candidates.short ?? candidates.preferred;
  const usedShortVariants = Boolean(candidates.short);
  for (let keep = best.bullets.length - 1; keep >= 0; keep--) {
    const trimmed = render({ ...best, bullets: best.bullets.slice(0, keep) }, renderer);
    if (trimmed.length <= maxLength) {
      return {
        text: trimmed,
        truncated: false,
        droppedBullets: best.bullets.length - keep,
        usedShortVariants,
      };
    }
  }

  const last = render({ ...best, bullets: [] }, renderer);
  return {
    text: truncateAtWord(last, maxLength),
    truncated: true,
    droppedBullets: best.bullets.length,
    usedShortVariants,
  };
}

// ---------------------------------------------------------------------------
// Choice matching (SPEC §5.4)
// ---------------------------------------------------------------------------

/** Case/punctuation-insensitive normalization used for all option matching. */
export function normalizeChoice(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9']+/g, ' ')
    .trim();
}

export interface ChoiceMatch {
  /** Index into the supplied options. */
  index: number;
  score: number;
}

/**
 * Matches a target label set against a widget's option labels.
 * Exact normalized equality scores 1; whole-phrase containment scores by length ratio, so
 * "No" does not beat "No, I will not require sponsorship" for the target "no sponsorship".
 * Returns undefined when nothing clears `threshold` — the caller drops to `suggest` (SPEC §5.4).
 */
export function matchChoice(
  optionLabels: string[],
  targets: string[],
  threshold = 0.6,
): ChoiceMatch | undefined {
  const normalizedTargets = targets.map(normalizeChoice).filter((t) => t.length > 0);
  if (normalizedTargets.length === 0) return undefined;

  let best: ChoiceMatch | undefined;
  optionLabels.forEach((label, index) => {
    const option = normalizeChoice(label);
    if (option.length === 0) return;
    for (const target of normalizedTargets) {
      let score: number;
      if (option === target) {
        score = 1;
      } else if (option.includes(target)) {
        score = 0.6 + 0.3 * (target.length / option.length);
      } else if (target.includes(option)) {
        score = 0.6 + 0.3 * (option.length / target.length);
      } else {
        const overlap = tokenOverlap(option, target);
        score = overlap * 0.7;
      }
      if (!best || score > best.score) best = { index, score };
    }
  });

  return best && best.score >= threshold ? best : undefined;
}

function tokenOverlap(a: string, b: string): number {
  const aTokens = new Set(a.split(' ').filter(Boolean));
  const bTokens = b.split(' ').filter(Boolean);
  if (aTokens.size === 0 || bTokens.length === 0) return 0;
  const hits = bTokens.filter((token) => aTokens.has(token)).length;
  return hits / Math.max(aTokens.size, bTokens.length);
}

/** Boolean answers get a conventional label set before `choiceSynonyms` are appended. */
export function booleanChoiceTargets(value: boolean): string[] {
  return value
    ? ['yes', 'true', 'i am', 'i do', 'i have']
    : ['no', 'false', 'i am not', 'i do not', 'i have not'];
}
