/**
 * Palette / popover search — fuzzy search across all atoms and snippets (SPEC §3.6).
 * Pure logic; the background serves it via `snippets.search`.
 *
 * Scoring: exact substring beats subsequence; matches in labels beat matches in body text;
 * shorter values win ties (a name atom over a paragraph). Sensitive results are returned
 * (the user searched for them) but flagged so the UI can lock-badge them.
 */
import type { SearchResult } from './messages.js';
import type { Snippet, Vault } from './types.js';
import { activeVersion, resolveVariant } from './compose.js';
import { formatAddressFull, formatPhone, fullName, joinList } from './format.js';

interface IndexEntry extends SearchResult {
  /** Lowercased searchable text: label + value + tags. */
  haystack: string;
}

function entry(
  partial: Omit<SearchResult, 'sensitive'> & { sensitive?: boolean },
  extraHaystack = '',
): IndexEntry {
  return {
    ...partial,
    sensitive: partial.sensitive ?? false,
    haystack: `${partial.label} ${partial.value} ${extraHaystack}`.toLowerCase(),
  };
}

function snippetEntries(
  snippet: Snippet,
  vault: Vault,
  labelPrefix: string,
  key?: string,
): IndexEntry[] {
  const version = activeVersion(vault);
  const resolved = resolveVariant(snippet, version);
  const label = snippet.label ?? labelPrefix;
  const tags = snippet.tags.join(' ');
  const main = entry({ id: snippet.id, kind: 'snippet', label, value: resolved, key }, tags);
  // Non-default variants are individually searchable so the palette can offer any phrasing.
  const variants = snippet.variants
    .filter((v) => v.text !== resolved)
    .map((v) =>
      entry(
        {
          id: `${snippet.id}:${v.id}`,
          kind: 'snippet',
          label: `${label} (${v.style})`,
          value: v.text,
          key,
        },
        tags,
      ),
    );
  return [main, ...variants];
}

/** Builds the full palette index for a vault. Rebuilt per scan generation, not per keystroke. */
export function buildSearchIndex(vault: Vault): IndexEntry[] {
  const entries: IndexEntry[] = [];
  const { profile } = vault;

  // Atoms: identity/contact/address/links.
  const atoms: [string, string, string][] = [
    ['identity.firstName', 'First name', profile.identity.firstName],
    ['identity.lastName', 'Last name', profile.identity.lastName],
    ['identity.fullName', 'Full name', fullName(profile.identity)],
    ['contact.email', 'Email', profile.contact.email],
    ['contact.phone', 'Phone', formatPhone(profile.contact.phone)],
    ['address.city', 'City', profile.address.city ?? ''],
    ['address.state', 'State', profile.address.state ?? ''],
    ['address.postalCode', 'Postal code', profile.address.postalCode ?? ''],
    ['address.country', 'Country', profile.address.country ?? ''],
    ['address.full', 'Full address', formatAddressFull(profile.address)],
    ['links.linkedin', 'LinkedIn', profile.links.linkedin ?? ''],
    ['links.github', 'GitHub', profile.links.github ?? ''],
    ['links.portfolio', 'Portfolio', profile.links.portfolio ?? ''],
    ['links.website', 'Website', profile.links.website ?? ''],
    ['skills', 'Skills', joinList(profile.skills)],
  ];
  for (const [key, label, value] of atoms) {
    if (value) entries.push(entry({ id: key, kind: 'atom', label, value, key }));
  }

  if (profile.summary)
    entries.push(...snippetEntries(profile.summary, vault, 'Summary', 'summary'));
  if (profile.coverLetter) {
    entries.push(...snippetEntries(profile.coverLetter, vault, 'Cover letter', 'coverLetter.text'));
  }

  vault.work.forEach((work) => {
    const where = `${work.title} @ ${work.company}`;
    entries.push(
      entry({
        id: `${work.id}:company`,
        kind: 'atom',
        label: `Company (${where})`,
        value: work.company,
      }),
      entry({ id: `${work.id}:title`, kind: 'atom', label: `Title (${where})`, value: work.title }),
    );
    entries.push(...snippetEntries(work.summary, vault, `Summary — ${where}`));
    work.bullets.forEach((bullet, i) =>
      entries.push(...snippetEntries(bullet, vault, `Bullet ${i + 1} — ${where}`)),
    );
  });

  vault.education.forEach((education) => {
    entries.push(
      entry({
        id: `${education.id}:school`,
        kind: 'atom',
        label: 'School',
        value: education.school,
      }),
    );
    if (education.degree) {
      entries.push(
        entry({
          id: `${education.id}:degree`,
          kind: 'atom',
          label: 'Degree',
          value: education.degree,
        }),
      );
    }
  });

  vault.projects.forEach((project) => {
    entries.push(
      entry({ id: `${project.id}:name`, kind: 'atom', label: 'Project', value: project.name }),
    );
    entries.push(...snippetEntries(project.summary, vault, `Summary — ${project.name}`));
  });

  for (const answer of vault.answers) {
    entries.push(
      entry(
        {
          id: answer.id,
          kind: 'answer',
          label: answer.question,
          value: String(answer.value),
          key: answer.key ? `answers.${answer.key}` : `answers.custom:${answer.id}`,
          sensitive: answer.sensitive,
        },
        (answer.patterns ?? []).join(' '),
      ),
    );
  }

  return entries;
}

/** True when every character of `needle` appears in order in `haystack`. */
function isSubsequence(needle: string, haystack: string): boolean {
  let i = 0;
  for (const ch of haystack) {
    if (ch === needle[i]) i++;
    if (i === needle.length) return true;
  }
  return needle.length === 0;
}

export function searchIndex(
  entries: IndexEntry[],
  query: string,
  opts: { scope?: 'all' | 'answers'; limit?: number } = {},
): SearchResult[] {
  const q = query.trim().toLowerCase();
  const limit = opts.limit ?? 20;
  const scoped = opts.scope === 'answers' ? entries.filter((e) => e.kind === 'answer') : entries;
  if (q.length === 0) {
    return scoped.slice(0, limit).map(stripHaystack);
  }
  const scored: { entry: IndexEntry; score: number }[] = [];
  for (const candidate of scoped) {
    const inLabel = candidate.label.toLowerCase().indexOf(q);
    const inHaystack = candidate.haystack.indexOf(q);
    let score = 0;
    if (inLabel === 0) score = 100;
    else if (inLabel > 0) score = 80;
    else if (inHaystack >= 0) score = 60;
    else if (q.length >= 3 && isSubsequence(q, candidate.haystack)) score = 30;
    if (score > 0) {
      // Shorter values edge out longer ones at equal score.
      scored.push({ entry: candidate, score: score - Math.min(candidate.value.length / 500, 10) });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => stripHaystack(s.entry));
}

function stripHaystack(indexed: IndexEntry): SearchResult {
  const { haystack: _haystack, ...result } = indexed;
  return result;
}
