/**
 * The jobfill data model — SPEC §4, transcribed faithfully.
 *
 * This file is the single source of truth for the vault shape; `ai/import.schema.json` is kept
 * in lockstep with it and a unit test asserts the two agree on required fields.
 * Pure types only: no imports, no runtime code beyond the small helpers at the bottom.
 */

// ---------------------------------------------------------------------------
// §4.1 Snippets and variants
// ---------------------------------------------------------------------------

/** Known styles plus arbitrary user labels (SPEC §4.1). */
export type VariantStyle = 'impact' | 'responsibilities' | 'short' | 'long' | (string & {});

export const KNOWN_VARIANT_STYLES = ['impact', 'responsibilities', 'short', 'long'] as const;

export interface Variant {
  id: string;
  style: VariantStyle;
  text: string;
}

export interface Snippet {
  id: string;
  /** Human name in the library ("Led CI migration"). */
  label?: string;
  /** Free-form, searchable ("kubernetes", "leadership"). */
  tags: string[];
  /** length >= 1 */
  variants: Variant[];
  defaultVariantId: string;
}

// ---------------------------------------------------------------------------
// §4.2 Entities
// ---------------------------------------------------------------------------

/** "2021-05". Day precision is not modeled — no ATS needs it for history. */
export type YearMonth = string;

export interface WorkExperience {
  id: string;
  company: string;
  companyUrl?: string;
  /** "Grand Rapids, MI" / "Remote" */
  location?: string;
  title: string;
  /** e.g. internal title vs. market title */
  titleVariants?: Variant[];
  startDate: YearMonth;
  /** absent + current=true → "Present" */
  endDate?: YearMonth;
  current: boolean;
  /** Paragraph-form description; the impact/responsibilities split lives here. */
  summary: Snippet;
  /** Individual accomplishment/duty lines. */
  bullets: Snippet[];
  skills?: string[];
}

export interface Education {
  id: string;
  school: string;
  /** "B.S." */
  degree?: string;
  /** "Digital Media Software Engineering" */
  field?: string;
  gpa?: string;
  location?: string;
  startDate?: YearMonth;
  endDate?: YearMonth;
  current: boolean;
  notes?: Snippet;
}

export interface Project {
  id: string;
  name: string;
  role?: string;
  url?: string;
  startDate?: YearMonth;
  endDate?: YearMonth;
  summary: Snippet;
  bullets: Snippet[];
  skills?: string[];
}

export interface Certification {
  id: string;
  name: string;
  issuer?: string;
  date?: YearMonth;
  url?: string;
}

export type StoredFileKind = 'resume' | 'coverLetter' | 'other';

export interface StoredFile {
  id: string;
  kind: StoredFileKind;
  /** "Dustin_Resume_2026_SWE.pdf" */
  name: string;
  mime: string;
  /** Key into the file store (SPEC §6.3); bytes are never inline in the doc store. */
  bytesRef: string;
  size: number;
  /** ISO timestamp */
  addedAt: string;
}

// ---------------------------------------------------------------------------
// §4.3 Identity, contact, links, answers
// ---------------------------------------------------------------------------

export interface Identity {
  firstName: string;
  lastName: string;
  middleName?: string;
  preferredName?: string;
  honorific?: string;
  suffix?: string;
}

export interface PhoneNumber {
  countryCode: string;
  national: string;
}

export interface Contact {
  email: string;
  secondaryEmail?: string;
  /** Formats are derived, never stored (SPEC §5.2). */
  phone: PhoneNumber;
  phoneType?: 'mobile' | 'home' | 'work';
}

export interface PostalAddress {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  /** Country as the ISO name the user uses. */
  country?: string;
}

export interface Links {
  linkedin?: string;
  github?: string;
  portfolio?: string;
  website?: string;
  other?: { label: string; url: string }[];
}

export interface Profile {
  identity: Identity;
  contact: Contact;
  address: PostalAddress;
  links: Links;
  /** "Professional summary" / objective, with variants. */
  summary?: Snippet;
  /** Base cover letter text, with variants. */
  coverLetter?: Snippet;
  /** Master skill list; versions can subset it. */
  skills: string[];
  languages?: { name: string; level?: string }[];
}

export type WellKnownAnswerKey =
  | 'workAuthorization'
  | 'sponsorship'
  | 'relocation'
  | 'remotePreference'
  | 'salaryExpectation'
  | 'noticePeriod'
  | 'earliestStart'
  | 'howDidYouHear'
  | 'referralName'
  | 'over18'
  | 'previouslyEmployedHere'
  /** sensitive */
  | 'criminalDisclosure'
  /** EEO: sensitive */
  | 'gender'
  | 'race'
  | 'ethnicity'
  | 'veteranStatus'
  | 'disabilityStatus'
  | 'pronouns';

export const WELL_KNOWN_ANSWER_KEYS: readonly WellKnownAnswerKey[] = [
  'workAuthorization',
  'sponsorship',
  'relocation',
  'remotePreference',
  'salaryExpectation',
  'noticePeriod',
  'earliestStart',
  'howDidYouHear',
  'referralName',
  'over18',
  'previouslyEmployedHere',
  'criminalDisclosure',
  'gender',
  'race',
  'ethnicity',
  'veteranStatus',
  'disabilityStatus',
  'pronouns',
] as const;

/**
 * EEO self-identification keys. Storing these at all is opt-in in the options UI, they are
 * forced `sensitive: true`, and they exist only so the *user* can one-click them per field
 * (SPEC §4.3, §7.9).
 */
export const EEO_ANSWER_KEYS: readonly WellKnownAnswerKey[] = [
  'gender',
  'race',
  'ethnicity',
  'veteranStatus',
  'disabilityStatus',
];

/** Keys that are ALWAYS sensitive — not unmarkable by the user or an import file. */
export const ALWAYS_SENSITIVE_ANSWER_KEYS: readonly WellKnownAnswerKey[] = [
  ...EEO_ANSWER_KEYS,
  'criminalDisclosure',
];

/**
 * SPEC §13 open question 3, decided "leaning yes": salary starts sensitive (excluded from
 * fill-all) but the user may unmark it — per §7.9 "salary if the user marks it".
 */
export const DEFAULT_SENSITIVE_ANSWER_KEYS: readonly WellKnownAnswerKey[] = ['salaryExpectation'];

export type AnswerKind = 'boolean' | 'choice' | 'text' | 'number' | 'date';
export type AnswerValue = string | number | boolean;

export interface AnswerEntry {
  id: string;
  /** Undefined for fully custom Q&A. */
  key?: WellKnownAnswerKey;
  /** Canonical question text as the user thinks of it. */
  question: string;
  /** Regex fragments for matching site questions. */
  patterns: string[];
  kind: AnswerKind;
  value: AnswerValue;
  /** For choice widgets: acceptable option labels ("Yes", "I am authorized"). */
  choiceSynonyms?: string[];
  /** For text answers. */
  variants?: Variant[];
  /** Sensitive ⇒ never auto/fill-all, explicit confirm only (SPEC §7.9). */
  sensitive: boolean;
}

// ---------------------------------------------------------------------------
// §4.4 Resume versions and settings
// ---------------------------------------------------------------------------

export interface VersionInclude {
  /** Ordered; order = fill order for repeating sections. */
  workIds: string[];
  educationIds: string[];
  projectIds: string[];
  certificationIds: string[];
  /** Subset/reorder of Profile.skills; undefined = all. */
  skills?: string[];
}

export interface ResumeVersion {
  id: string;
  /** "Impact-focused SWE" */
  name: string;
  description?: string;
  /** Attached StoredFile (kind: resume). */
  fileId?: string;
  coverLetterFileId?: string;
  include: VersionInclude;
  /** Fallback order, e.g. ["impact", "short"]. */
  stylePriority: VariantStyle[];
  /** Explicit per-snippet overrides: snippetId → variantId. */
  variantPrefs: Record<string, string>;
  /** workId → variantId */
  titlePrefs?: Record<string, string>;
  /** answerId → value */
  answerOverrides?: Record<string, AnswerValue>;
}

export interface Settings {
  activeVersionId: string;
  encryption: { enabled: boolean };
  /** default 0.8 */
  fillAllThreshold: number;
  /** default 0.5 */
  suggestThreshold: number;
  /** Display only; the real binding lives in browser.commands. */
  paletteShortcutHint: string;
  /** SPEC §4.3: storing EEO answers at all is opt-in. */
  storeEeoAnswers: boolean;
}

// ---------------------------------------------------------------------------
// §7.6–7.7 Site profiles and site memory
// ---------------------------------------------------------------------------

export type WidgetKind =
  | 'text'
  | 'textarea'
  | 'select'
  | 'radio-group'
  | 'checkbox'
  | 'combobox'
  | 'listbox-button'
  | 'date-segmented'
  | 'contenteditable'
  | 'file';

export interface FieldMapping {
  selector: string;
  key: CanonicalKey;
  widget?: WidgetKind;
  /** How the selector was derived, so the UI can flag fragile mappings (SPEC §7.7). */
  fingerprint?: 'attribute' | 'label' | 'structural';
}

export interface SiteProfile {
  id: string;
  profileVersion: number;
  match: { urlPatterns: string[]; domProbe?: string };
  readiness?: { probe?: string; settleMs?: number };
  fields: FieldMapping[];
  multiStep?: { rescan?: 'mutation' | 'navigation' };
  notes?: string;
}

// ---------------------------------------------------------------------------
// §4.5 Canonical key taxonomy
// ---------------------------------------------------------------------------

/**
 * The contract between classifier (§7.3) and composer (§5). `[i]` is the i-th *included*
 * entity of the active version (0-based, in `include` order).
 *
 * Kept as a string type with a documented grammar rather than a closed union, because indexed
 * keys (`work[3].summary`) and custom answers (`answers.custom:<id>`) are open-ended.
 * `parseCanonicalKey` below is the runtime validator.
 */
export type CanonicalKey = string;

/** Non-indexed canonical keys, exactly as listed in SPEC §4.5. */
export const SIMPLE_CANONICAL_KEYS = [
  'identity.firstName',
  'identity.lastName',
  'identity.middleName',
  'identity.fullName',
  'identity.preferredName',
  'identity.honorific',
  'identity.suffix',
  'identity.pronouns',
  'contact.email',
  'contact.phone',
  'contact.phoneCountryCode',
  'contact.phoneType',
  'address.line1',
  'address.line2',
  'address.city',
  'address.state',
  'address.postalCode',
  'address.country',
  'address.full',
  'links.linkedin',
  'links.github',
  'links.portfolio',
  'links.website',
  'summary',
  'coverLetter.text',
  'skills',
  'languages',
  'documents.resume',
  'documents.coverLetter',
] as const;

/** Indexed key families: `<family>[i].<field>`. */
export const INDEXED_CANONICAL_FIELDS: Record<string, readonly string[]> = {
  work: [
    'company',
    'title',
    'location',
    'startDate',
    'endDate',
    'current',
    'summary',
    'bullets',
    'companyUrl',
  ],
  education: ['school', 'degree', 'field', 'gpa', 'startDate', 'endDate'],
  projects: ['name', 'url', 'summary'],
  certifications: ['name'],
};

export const EEO_CANONICAL_KEYS = [
  'eeo.gender',
  'eeo.race',
  'eeo.ethnicity',
  'eeo.veteranStatus',
  'eeo.disabilityStatus',
] as const;

export interface ParsedKey {
  /** 'identity', 'work', 'answers', 'eeo', … */
  root: string;
  /** For indexed families. */
  index?: number;
  /** Trailing field name, if any. */
  field?: string;
  /** For `answers.<key>` / `answers.custom:<id>`. */
  answerKey?: string;
}

const INDEXED_RE = /^([a-zA-Z]+)\[(\d+)\]\.([a-zA-Z]+)$/;

/** Runtime validation of a canonical key. Returns undefined for anything malformed. */
export function parseCanonicalKey(key: string): ParsedKey | undefined {
  const indexed = INDEXED_RE.exec(key);
  if (indexed) {
    const [, root, idx, field] = indexed;
    if (!root || !idx || !field) return undefined;
    const fields = INDEXED_CANONICAL_FIELDS[root];
    if (!fields || !fields.includes(field)) return undefined;
    return { root, index: Number(idx), field };
  }
  if (key.startsWith('answers.')) {
    const answerKey = key.slice('answers.'.length);
    return answerKey.length > 0 ? { root: 'answers', answerKey } : undefined;
  }
  if ((EEO_CANONICAL_KEYS as readonly string[]).includes(key)) {
    return { root: 'eeo', field: key.slice('eeo.'.length) };
  }
  if ((SIMPLE_CANONICAL_KEYS as readonly string[]).includes(key)) {
    const dot = key.indexOf('.');
    return dot === -1 ? { root: key } : { root: key.slice(0, dot), field: key.slice(dot + 1) };
  }
  return undefined;
}

export function isSensitiveKey(key: CanonicalKey): boolean {
  return key.startsWith('eeo.');
}

// ---------------------------------------------------------------------------
// §4.6 Root document
// ---------------------------------------------------------------------------

export interface Vault {
  schemaVersion: 1;
  profile: Profile;
  work: WorkExperience[];
  education: Education[];
  projects: Project[];
  certifications: Certification[];
  answers: AnswerEntry[];
  versions: ResumeVersion[];
  /** Metadata only; bytes live in the file store. */
  files: StoredFile[];
  settings: Settings;
  /** origin → learned profile (SPEC §7.6–7.7). */
  siteMemory: Record<string, SiteProfile>;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// §9.1 Interchange format (import/export)
// ---------------------------------------------------------------------------

/** A file carried inline in an interchange document (base64 bytes). */
export interface InterchangeFile {
  id?: string;
  kind: StoredFileKind;
  name: string;
  mime: string;
  base64: string;
}

/**
 * Interchange entities mirror the vault entities but with ids optional and `defaultVariantId`
 * resolvable by position, so hand- and AI-authored files stay forgiving (SPEC §9.1).
 */
export interface LooseVariant {
  id?: string;
  style: VariantStyle;
  text: string;
}

export interface LooseSnippet {
  id?: string;
  label?: string;
  tags?: string[];
  variants: LooseVariant[];
  defaultVariantId?: string;
}

export interface LooseWorkExperience {
  id?: string;
  company: string;
  companyUrl?: string;
  location?: string;
  title: string;
  titleVariants?: LooseVariant[];
  startDate: YearMonth;
  endDate?: YearMonth;
  current?: boolean;
  summary?: LooseSnippet;
  bullets?: LooseSnippet[];
  skills?: string[];
}

export interface LooseEducation {
  id?: string;
  school: string;
  degree?: string;
  field?: string;
  gpa?: string;
  location?: string;
  startDate?: YearMonth;
  endDate?: YearMonth;
  current?: boolean;
  notes?: LooseSnippet;
}

export interface LooseProject {
  id?: string;
  name: string;
  role?: string;
  url?: string;
  startDate?: YearMonth;
  endDate?: YearMonth;
  summary?: LooseSnippet;
  bullets?: LooseSnippet[];
  skills?: string[];
}

export interface LooseCertification {
  id?: string;
  name: string;
  issuer?: string;
  date?: YearMonth;
  url?: string;
}

export interface LooseAnswerEntry {
  id?: string;
  key?: WellKnownAnswerKey;
  question: string;
  patterns?: string[];
  kind: AnswerKind;
  value: AnswerValue;
  choiceSynonyms?: string[];
  variants?: LooseVariant[];
  sensitive?: boolean;
}

export interface LooseProfile {
  identity: Identity;
  contact: Contact;
  address?: PostalAddress;
  links?: Links;
  summary?: LooseSnippet;
  coverLetter?: LooseSnippet;
  skills?: string[];
  languages?: { name: string; level?: string }[];
}

export interface LooseResumeVersion {
  id?: string;
  name: string;
  description?: string;
  fileId?: string;
  coverLetterFileId?: string;
  include?: Partial<VersionInclude>;
  stylePriority?: VariantStyle[];
  variantPrefs?: Record<string, string>;
  titlePrefs?: Record<string, string>;
  answerOverrides?: Record<string, AnswerValue>;
}

/**
 * `Vault` minus settings/siteMemory, plus optional inline file bytes. Ids throughout are
 * optional — the importer assigns UUIDs and resolves `defaultVariantId` by position (SPEC §9.1).
 */
export interface InterchangeDocument {
  $schema?: string;
  schemaVersion: 1;
  profile: LooseProfile;
  work?: LooseWorkExperience[];
  education?: LooseEducation[];
  projects?: LooseProject[];
  certifications?: LooseCertification[];
  answers?: LooseAnswerEntry[];
  versions?: LooseResumeVersion[];
  files?: InterchangeFile[];
}
