/**
 * Composition — SPEC §5: canonical key + active Resume Version → the value that fills a field.
 *
 * Pure functions over the vault. The background DataService calls these (SPEC §8.3 `compose`
 * runs background-side because it needs the whole vault); keeping the logic here in `shared/`
 * keeps it unit-testable by construction (CLAUDE.md invariant).
 */
import type {
  AnswerEntry,
  AnswerValue,
  CanonicalKey,
  Profile,
  ResumeVersion,
  Snippet,
  Vault,
  WorkExperience,
} from './types.js';
import { parseCanonicalKey } from './types.js';
import type { DateFormat, PhoneFormat, Renderer } from './format.js';
import {
  booleanChoiceTargets,
  defaultRenderer,
  fitToBudget,
  formatAddressFull,
  formatDate,
  formatEndDate,
  formatPhone,
  fullName,
  joinList,
  phoneAlternates,
} from './format.js';

// ---------------------------------------------------------------------------
// §5.1 Variant resolution
// ---------------------------------------------------------------------------

/**
 * Resolution order (SPEC §5.1):
 * 1. `version.variantPrefs[snippetId]` if set;
 * 2. else first variant whose style matches `version.stylePriority`, in priority order;
 * 3. else `snippet.defaultVariantId`.
 */
export function resolveVariant(snippet: Snippet, version: ResumeVersion): string {
  const preferred = version.variantPrefs[snippet.id];
  if (preferred) {
    const hit = snippet.variants.find((v) => v.id === preferred);
    if (hit) return hit.text;
  }
  for (const style of version.stylePriority) {
    const hit = snippet.variants.find((v) => v.style === style);
    if (hit) return hit.text;
  }
  const fallback = snippet.variants.find((v) => v.id === snippet.defaultVariantId);
  return fallback?.text ?? snippet.variants[0]?.text ?? '';
}

/** The other candidates, in the same order, for the popover's variant switcher (SPEC §5.1). */
export function variantAlternates(snippet: Snippet, version: ResumeVersion): string[] {
  const chosen = resolveVariant(snippet, version);
  const ordered: string[] = [];
  const push = (text: string) => {
    if (text !== chosen && !ordered.includes(text)) ordered.push(text);
  };
  const preferred = version.variantPrefs[snippet.id];
  if (preferred) {
    const hit = snippet.variants.find((v) => v.id === preferred);
    if (hit) push(hit.text);
  }
  for (const style of version.stylePriority) {
    for (const variant of snippet.variants.filter((v) => v.style === style)) push(variant.text);
  }
  for (const variant of snippet.variants) push(variant.text);
  return ordered;
}

/** Resolves with `short`-style variants forced, for length-budget fallback (SPEC §5.3). */
function resolveShortVariant(snippet: Snippet, version: ResumeVersion): string | undefined {
  const short = snippet.variants.find((v) => v.style === 'short');
  if (!short) return undefined;
  const resolved = resolveVariant(snippet, version);
  return short.text === resolved ? undefined : short.text;
}

// ---------------------------------------------------------------------------
// Compose options & result
// ---------------------------------------------------------------------------

export interface ComposeOpts {
  /** Field's maxlength, when it exposes one (SPEC §5.3). */
  maxLength?: number;
  /** Multiline target (textarea/contenteditable). */
  multiline?: boolean;
  /** Textarea rows, if known — feeds the default-renderer heuristic. */
  rows?: number;
  /** Explicit renderer override from the popover (SPEC §5.3). */
  renderer?: Renderer;
  /** Explicit phone format (classifier hints pick a default — SPEC §5.2). */
  phoneFormat?: PhoneFormat;
  /** Explicit date format. */
  dateFormat?: DateFormat;
}

export interface ComposedValue {
  value: string;
  /** Other candidates for the popover switcher (variants, formats). */
  alternates: string[];
  /** True when the value was hard-truncated to fit `maxLength` (SPEC §5.3 warning). */
  truncated?: boolean;
  /** For choice widgets: the full target label set incl. synonyms (SPEC §5.4). */
  choiceTargets?: string[];
  /**
   * True when the value is a sensible ASSUMPTION rather than user-stated data (e.g. phone
   * type "Mobile" with none stored) — such proposals never auto-fill, only suggest.
   */
  defaulted?: boolean;
  /** Multi-value keys (skills): the individual items, for tag/chip widgets. */
  items?: string[];
}

/** Returned when a key parses but the vault has nothing for it. */
export const EMPTY: ComposedValue = { value: '', alternates: [] };

function composed(value: string, alternates: string[] = []): ComposedValue {
  return { value, alternates };
}

// ---------------------------------------------------------------------------
// The composer
// ---------------------------------------------------------------------------

export function activeVersion(vault: Vault): ResumeVersion {
  const active = vault.versions.find((v) => v.id === vault.settings.activeVersionId);
  if (active) return active;
  const first = vault.versions[0];
  if (first) return first;
  throw new Error('jobfill: vault has no resume versions');
}

/** The i-th *included* entity of the active version, in `include` order (SPEC §4.5). */
function includedWork(
  vault: Vault,
  version: ResumeVersion,
  index: number,
): WorkExperience | undefined {
  const id = version.include.workIds[index];
  return id === undefined ? undefined : vault.work.find((w) => w.id === id);
}

function answerValue(version: ResumeVersion, entry: AnswerEntry): AnswerValue {
  const override = version.answerOverrides?.[entry.id];
  return override !== undefined ? override : entry.value;
}

function answerToComposed(version: ResumeVersion, entry: AnswerEntry): ComposedValue {
  const value = answerValue(version, entry);
  if (entry.kind === 'boolean') {
    const bool = value === true || value === 'true' || value === 'yes';
    const targets = [...booleanChoiceTargets(bool), ...(entry.choiceSynonyms ?? [])];
    return { value: bool ? 'Yes' : 'No', alternates: [], choiceTargets: targets };
  }
  if (entry.kind === 'text' && entry.variants && entry.variants.length > 0) {
    const snippet: Snippet = {
      id: entry.id,
      tags: [],
      variants: entry.variants,
      defaultVariantId: entry.variants[0]?.id ?? '',
    };
    return composed(resolveVariant(snippet, version), variantAlternates(snippet, version));
  }
  const text = String(value);
  const targets = entry.kind === 'choice' ? [text, ...(entry.choiceSynonyms ?? [])] : undefined;
  return { value: text, alternates: [], ...(targets ? { choiceTargets: targets } : {}) };
}

function composeSnippetField(
  snippet: Snippet,
  bullets: Snippet[],
  version: ResumeVersion,
  opts: ComposeOpts,
): ComposedValue {
  const renderer =
    opts.renderer ??
    defaultRenderer({
      multiline: opts.multiline ?? false,
      maxLength: opts.maxLength,
      rows: opts.rows,
    });
  const preferred = {
    paragraph: resolveVariant(snippet, version),
    bullets: bullets.map((b) => resolveVariant(b, version)),
  };
  const shortParagraph = resolveShortVariant(snippet, version);
  const shortBullets = bullets.map(
    (b) => resolveShortVariant(b, version) ?? resolveVariant(b, version),
  );
  const hasShort =
    shortParagraph !== undefined || bullets.some((b) => resolveShortVariant(b, version));
  const result = fitToBudget(
    {
      preferred,
      short: hasShort
        ? { paragraph: shortParagraph ?? preferred.paragraph, bullets: shortBullets }
        : undefined,
    },
    renderer,
    opts.maxLength,
  );
  return {
    value: result.text,
    alternates: variantAlternates(snippet, version),
    ...(result.truncated ? { truncated: true } : {}),
  };
}

/**
 * Composes the value for a canonical key under the vault's active version.
 * Returns `undefined` for keys the composer does not understand (malformed, or a file key —
 * files travel through `file.get`, not compose). Returns `EMPTY`-shaped values for valid keys
 * the vault has no data for, so the popover can say "nothing stored" honestly.
 */
export function compose(
  vault: Vault,
  key: CanonicalKey,
  opts: ComposeOpts = {},
): ComposedValue | undefined {
  const parsed = parseCanonicalKey(key);
  if (!parsed) return undefined;
  const version = activeVersion(vault);
  const { profile } = vault;

  // --- answers -------------------------------------------------------------
  if (parsed.root === 'answers') {
    const entry = vault.answers.find((a) =>
      parsed.answerKey?.startsWith('custom:')
        ? a.id === parsed.answerKey.slice('custom:'.length)
        : a.key === parsed.answerKey,
    );
    return entry ? answerToComposed(version, entry) : EMPTY;
  }

  // --- EEO (sensitive; caller enforces confirm-first — SPEC §7.9) ----------
  if (parsed.root === 'eeo') {
    const eeoKeyMap: Record<string, string> = {
      gender: 'gender',
      race: 'race',
      ethnicity: 'ethnicity',
      veteranStatus: 'veteranStatus',
      disabilityStatus: 'disabilityStatus',
    };
    const answerKey = parsed.field ? eeoKeyMap[parsed.field] : undefined;
    const entry = vault.answers.find((a) => a.key === answerKey);
    return entry ? answerToComposed(version, entry) : EMPTY;
  }

  // --- identity ------------------------------------------------------------
  if (parsed.root === 'identity') {
    const identity = profile.identity;
    switch (parsed.field) {
      case 'firstName':
        return composed(identity.firstName);
      case 'lastName':
        return composed(identity.lastName);
      case 'middleName':
        return composed(identity.middleName ?? '');
      case 'fullName':
        return composed(fullName(identity));
      case 'preferredName':
        return composed(identity.preferredName ?? identity.firstName);
      case 'honorific':
        return composed(identity.honorific ?? '');
      case 'suffix':
        return composed(identity.suffix ?? '');
      case 'pronouns': {
        const entry = vault.answers.find((a) => a.key === 'pronouns');
        return entry ? answerToComposed(version, entry) : EMPTY;
      }
    }
    return undefined;
  }

  // --- contact -------------------------------------------------------------
  if (parsed.root === 'contact') {
    switch (parsed.field) {
      case 'email':
        return composed(profile.contact.email);
      case 'phone': {
        const format = opts.phoneFormat ?? 'national';
        return composed(
          formatPhone(profile.contact.phone, format),
          phoneAlternates(profile.contact.phone, format),
        );
      }
      case 'phoneCountryCode': {
        const code = profile.contact.phone.countryCode.replace(/\D+/g, '');
        return code ? composed(`+${code}`, [code]) : EMPTY;
      }
      case 'phoneType': {
        if (profile.contact.phoneType) {
          const synonyms =
            profile.contact.phoneType === 'mobile'
              ? ['mobile', 'cell', 'cellular', 'personal']
              : [profile.contact.phoneType];
          return {
            value: profile.contact.phoneType,
            alternates: [],
            choiceTargets: synonyms,
          };
        }
        // Nothing stored: "Mobile" is the near-universal answer — offered as a DEFAULT
        // (suggest-only, never fill-all) so phone-type dropdowns aren't dead fields.
        return {
          value: 'Mobile',
          alternates: ['Home', 'Work'],
          choiceTargets: ['mobile', 'cell', 'cellular', 'personal'],
          defaulted: true,
        };
      }
    }
    return undefined;
  }

  // --- address -------------------------------------------------------------
  if (parsed.root === 'address') {
    const address = profile.address;
    switch (parsed.field) {
      case 'line1':
        return composed(address.line1 ?? '');
      case 'line2':
        return composed(address.line2 ?? '');
      case 'city':
        return composed(address.city ?? '');
      case 'state':
        return address.state
          ? { value: address.state, alternates: [], choiceTargets: [address.state] }
          : EMPTY;
      case 'postalCode':
        return composed(address.postalCode ?? '');
      case 'country':
        return address.country
          ? { value: address.country, alternates: [], choiceTargets: [address.country] }
          : EMPTY;
      case 'full': {
        // "Current location"-style fields often want just "City, ST" — offer the ladder.
        const cityState = [address.city, address.state].filter(Boolean).join(', ');
        const alternates = [cityState, address.city ?? '']
          .filter((alt) => alt && alt !== formatAddressFull(address))
          .filter((alt, i, all) => all.indexOf(alt) === i);
        return composed(formatAddressFull(address), alternates);
      }
    }
    return undefined;
  }

  // --- links ---------------------------------------------------------------
  if (parsed.root === 'links') {
    // Indexed form links[i].url (repeated "Website N" fields): the i-th DISTINCT link.
    if (parsed.index !== undefined && parsed.field === 'url') {
      const ranked = orderedLinks(profile);
      const hit = ranked[parsed.index];
      if (!hit) return EMPTY;
      return composed(
        hit.url,
        ranked.filter((_, i) => i !== parsed.index).map((entry) => entry.url),
      );
    }
    const links = profile.links;
    switch (parsed.field) {
      case 'linkedin':
        return composed(links.linkedin ?? '');
      case 'github':
        return composed(links.github ?? '');
      case 'portfolio':
        return composed(links.portfolio ?? links.website ?? '');
      case 'website':
        return composed(links.website ?? links.portfolio ?? '');
    }
    return undefined;
  }

  // --- top-level snippets --------------------------------------------------
  if (parsed.root === 'summary') {
    if (!profile.summary) return EMPTY;
    return composeSnippetField(profile.summary, [], version, opts);
  }
  if (parsed.root === 'coverLetter' && parsed.field === 'text') {
    if (!profile.coverLetter) return EMPTY;
    return composeSnippetField(profile.coverLetter, [], version, opts);
  }

  // --- skills & languages --------------------------------------------------
  if (parsed.root === 'skills') {
    const skills = version.include.skills ?? profile.skills;
    return {
      ...composed(joinList(skills), [joinList(skills, 'newline'), joinList(skills, 'middot')]),
      items: skills.filter((skill) => skill.trim().length > 0),
    };
  }
  if (parsed.root === 'languages') {
    const languages = (profile.languages ?? []).map((l) =>
      l.level ? `${l.name} (${l.level})` : l.name,
    );
    return composed(joinList(languages));
  }

  // --- work[i] -------------------------------------------------------------
  if (parsed.root === 'work' && parsed.index !== undefined) {
    const work = includedWork(vault, version, parsed.index);
    if (!work) return EMPTY;
    const dateFormat = opts.dateFormat ?? 'MM/YYYY';
    switch (parsed.field) {
      case 'company':
        return composed(work.company);
      case 'companyUrl':
        return composed(work.companyUrl ?? '');
      case 'title': {
        const pref = version.titlePrefs?.[work.id];
        const variant = work.titleVariants?.find((v) => v.id === pref);
        const alternates = (work.titleVariants ?? [])
          .map((v) => v.text)
          .filter((t) => t !== (variant?.text ?? work.title));
        return composed(variant?.text ?? work.title, alternates);
      }
      case 'location':
        return composed(work.location ?? '');
      case 'startDate':
        return composed(
          formatDate(work.startDate, dateFormat),
          alternateDates(work.startDate, dateFormat),
        );
      case 'endDate':
        return composed(
          formatEndDate(work.endDate, work.current, dateFormat),
          work.current ? [] : alternateDates(work.endDate, dateFormat),
        );
      case 'current':
        return {
          value: work.current ? 'Yes' : 'No',
          alternates: [],
          choiceTargets: booleanChoiceTargets(work.current),
        };
      case 'summary':
        return composeSnippetField(work.summary, work.bullets, version, opts);
      case 'bullets': {
        // The budget ladder applies here too (SPEC §5.3: never silently exceed maxlength).
        const result = fitToBudget(
          {
            preferred: {
              paragraph: '',
              bullets: work.bullets.map((b) => resolveVariant(b, version)),
            },
            short: work.bullets.some((b) => b.variants.some((v) => v.style === 'short'))
              ? {
                  paragraph: '',
                  bullets: work.bullets.map(
                    (b) =>
                      b.variants.find((v) => v.style === 'short')?.text ??
                      resolveVariant(b, version),
                  ),
                }
              : undefined,
          },
          opts.renderer ?? 'bullets',
          opts.maxLength,
        );
        return {
          value: result.text,
          alternates: [],
          ...(result.truncated ? { truncated: true } : {}),
        };
      }
    }
    return undefined;
  }

  // --- education[i] --------------------------------------------------------
  if (parsed.root === 'education' && parsed.index !== undefined) {
    const id = version.include.educationIds[parsed.index];
    const education = id === undefined ? undefined : vault.education.find((e) => e.id === id);
    if (!education) return EMPTY;
    const dateFormat = opts.dateFormat ?? 'MM/YYYY';
    switch (parsed.field) {
      case 'school':
        return composed(education.school);
      case 'degree':
        return education.degree
          ? { value: education.degree, alternates: [], choiceTargets: [education.degree] }
          : EMPTY;
      case 'field':
        return composed(education.field ?? '');
      case 'gpa':
        return composed(education.gpa ?? '');
      case 'startDate':
        return composed(
          formatDate(education.startDate, dateFormat),
          alternateDates(education.startDate, dateFormat),
        );
      case 'endDate':
        return composed(
          formatEndDate(education.endDate, education.current, dateFormat),
          education.current ? [] : alternateDates(education.endDate, dateFormat),
        );
    }
    return undefined;
  }

  // --- projects[i] ---------------------------------------------------------
  if (parsed.root === 'projects' && parsed.index !== undefined) {
    const id = version.include.projectIds[parsed.index];
    const project = id === undefined ? undefined : vault.projects.find((p) => p.id === id);
    if (!project) return EMPTY;
    switch (parsed.field) {
      case 'name':
        return composed(project.name);
      case 'url':
        return composed(project.url ?? '');
      case 'summary':
        return composeSnippetField(project.summary, project.bullets, version, opts);
    }
    return undefined;
  }

  // --- certifications[i] ---------------------------------------------------
  if (parsed.root === 'certifications' && parsed.index !== undefined) {
    const id = version.include.certificationIds[parsed.index];
    const cert = id === undefined ? undefined : vault.certifications.find((c) => c.id === id);
    if (!cert) return EMPTY;
    if (parsed.field === 'name') return composed(cert.name);
    return undefined;
  }

  // documents.* are file keys — they resolve through file.get, not compose.
  if (parsed.root === 'documents') return undefined;

  return undefined;
}

/**
 * All of the profile's links as one ranked, URL-deduped list. Default order: website →
 * portfolio → github → linkedin → other[] (stored order). `links.order` promotes named
 * slots/labels to the front; unlisted links follow in default order.
 */
export function orderedLinks(profile: Profile): { label: string; url: string }[] {
  const links = profile.links;
  const catalog: { label: string; url: string }[] = [
    { label: 'website', url: links.website ?? '' },
    { label: 'portfolio', url: links.portfolio ?? '' },
    { label: 'github', url: links.github ?? '' },
    { label: 'linkedin', url: links.linkedin ?? '' },
    ...(links.other ?? []).map((o) => ({ label: o.label, url: o.url })),
  ].filter((entry) => entry.url.trim().length > 0);

  const ranking = (links.order ?? []).map((name) => name.trim().toLowerCase()).filter(Boolean);
  const rankOf = (label: string) => {
    const index = ranking.indexOf(label.toLowerCase());
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  const ranked = catalog
    .map((entry, i) => ({ entry, rank: rankOf(entry.label), tiebreak: i }))
    .sort((a, b) => a.rank - b.rank || a.tiebreak - b.tiebreak)
    .map((r) => r.entry);

  const seen = new Set<string>();
  return ranked.filter((entry) => {
    const key = entry.url.replace(/\/+$/, '').toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function alternateDates(value: string | undefined, current: DateFormat): string[] {
  if (!value) return [];
  const formats: DateFormat[] = ['MM/YYYY', 'Month YYYY', 'YYYY-MM', 'MM/DD/YYYY', 'YYYY'];
  return formats.filter((f) => f !== current).map((f) => formatDate(value, f));
}
