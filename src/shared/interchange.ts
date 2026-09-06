/**
 * Interchange import/export logic — SPEC §9.1–9.2, pure functions.
 *
 * Import materializes loose (id-optional) interchange entities into strict vault entities:
 * UUIDs assigned, `defaultVariantId` resolved by position (first variant is default),
 * always-sensitive answer keys forced sensitive, EEO entries dropped unless storage is opted in.
 * Only the `merge-add` strategy ships tonight (never deletes); `replace-all`/`update-matching`
 * are Rung 4+/post-v1.
 */
import type {
  AnswerEntry,
  Certification,
  Education,
  InterchangeDocument,
  InterchangeFile,
  LooseAnswerEntry,
  LooseCertification,
  LooseEducation,
  LooseProject,
  LooseResumeVersion,
  LooseSnippet,
  LooseVariant,
  LooseWorkExperience,
  Project,
  ResumeVersion,
  Snippet,
  StoredFile,
  Variant,
  Vault,
  WorkExperience,
} from './types.js';
import { ALWAYS_SENSITIVE_ANSWER_KEYS, EEO_ANSWER_KEYS } from './types.js';
import { newId, normalizeVault, nowIso } from './vault.js';

// ---------------------------------------------------------------------------
// Materialization (loose → strict)
// ---------------------------------------------------------------------------

function materializeVariant(loose: LooseVariant): Variant {
  return { id: loose.id ?? newId(), style: loose.style, text: loose.text };
}

export function materializeSnippet(loose: LooseSnippet): Snippet {
  const variants = loose.variants.map(materializeVariant);
  const first = variants[0];
  if (!first) throw new Error('jobfill: snippet needs at least one variant');
  const byId = loose.defaultVariantId && variants.find((v) => v.id === loose.defaultVariantId);
  return {
    id: loose.id ?? newId(),
    label: loose.label,
    tags: loose.tags ?? [],
    variants,
    // SPEC §9.1: ids optional; default variant resolves by position when omitted.
    defaultVariantId: byId ? byId.id : first.id,
  };
}

function emptySnippet(label?: string): Snippet {
  const variant: Variant = { id: newId(), style: 'impact', text: '' };
  return { id: newId(), label, tags: [], variants: [variant], defaultVariantId: variant.id };
}

function materializeWork(loose: LooseWorkExperience): WorkExperience {
  return {
    id: loose.id ?? newId(),
    company: loose.company,
    companyUrl: loose.companyUrl,
    location: loose.location,
    title: loose.title,
    titleVariants: loose.titleVariants?.map(materializeVariant),
    startDate: loose.startDate,
    endDate: loose.endDate,
    current: loose.current ?? false,
    summary: loose.summary
      ? materializeSnippet(loose.summary)
      : emptySnippet(`${loose.company} summary`),
    bullets: (loose.bullets ?? []).map(materializeSnippet),
    skills: loose.skills,
  };
}

function materializeEducation(loose: LooseEducation): Education {
  return {
    id: loose.id ?? newId(),
    school: loose.school,
    degree: loose.degree,
    field: loose.field,
    gpa: loose.gpa,
    location: loose.location,
    startDate: loose.startDate,
    endDate: loose.endDate,
    current: loose.current ?? false,
    notes: loose.notes ? materializeSnippet(loose.notes) : undefined,
  };
}

function materializeProject(loose: LooseProject): Project {
  return {
    id: loose.id ?? newId(),
    name: loose.name,
    role: loose.role,
    url: loose.url,
    startDate: loose.startDate,
    endDate: loose.endDate,
    summary: loose.summary
      ? materializeSnippet(loose.summary)
      : emptySnippet(`${loose.name} summary`),
    bullets: (loose.bullets ?? []).map(materializeSnippet),
    skills: loose.skills,
  };
}

function materializeCertification(loose: LooseCertification): Certification {
  return {
    id: loose.id ?? newId(),
    name: loose.name,
    issuer: loose.issuer,
    date: loose.date,
    url: loose.url,
  };
}

function materializeAnswer(loose: LooseAnswerEntry): AnswerEntry {
  const forcedSensitive =
    loose.key !== undefined && ALWAYS_SENSITIVE_ANSWER_KEYS.includes(loose.key);
  return {
    id: loose.id ?? newId(),
    key: loose.key,
    question: loose.question,
    patterns: loose.patterns ?? [],
    kind: loose.kind,
    value: loose.value,
    choiceSynonyms: loose.choiceSynonyms,
    variants: loose.variants?.map(materializeVariant),
    // Forced-sensitive keys stay sensitive no matter what the import file claims (SPEC §4.3).
    sensitive: forcedSensitive || (loose.sensitive ?? false),
  };
}

function materializeVersion(loose: LooseResumeVersion, vault: Vault): ResumeVersion {
  return {
    id: loose.id ?? newId(),
    name: loose.name,
    description: loose.description,
    fileId: loose.fileId,
    coverLetterFileId: loose.coverLetterFileId,
    include: {
      workIds: loose.include?.workIds ?? vault.work.map((w) => w.id),
      educationIds: loose.include?.educationIds ?? vault.education.map((e) => e.id),
      projectIds: loose.include?.projectIds ?? vault.projects.map((p) => p.id),
      certificationIds: loose.include?.certificationIds ?? vault.certifications.map((c) => c.id),
      skills: loose.include?.skills,
    },
    stylePriority: loose.stylePriority ?? ['impact', 'short'],
    variantPrefs: loose.variantPrefs ?? {},
    titlePrefs: loose.titlePrefs,
    answerOverrides: loose.answerOverrides,
  };
}

// ---------------------------------------------------------------------------
// Import (merge-add)
// ---------------------------------------------------------------------------

export interface ImportedFilePayload {
  record: StoredFile;
  /** Raw bytes for the background to persist in the blob store. */
  bytes: Uint8Array;
}

export interface ImportSummary {
  added: {
    work: number;
    education: number;
    projects: number;
    certifications: number;
    answers: number;
    versions: number;
    files: number;
    skills: number;
  };
  /** Profile scalar fields that were filled from the import (only empty ones are). */
  profileFieldsFilled: string[];
  /** Import-file items that were skipped, with a human reason each. */
  skipped: string[];
}

export interface ImportResult {
  vault: Vault;
  files: ImportedFilePayload[];
  summary: ImportSummary;
}

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function materializeFile(loose: InterchangeFile): ImportedFilePayload {
  const bytes = decodeBase64(loose.base64);
  return {
    record: {
      id: loose.id ?? newId(),
      kind: loose.kind,
      name: loose.name,
      mime: loose.mime,
      bytesRef: newId(),
      size: bytes.byteLength,
      addedAt: nowIso(),
    },
    bytes,
  };
}

/** Shallow-fills empty profile scalars from the import; existing values always win. */
function mergeProfile(vault: Vault, doc: InterchangeDocument, summary: ImportSummary): void {
  const filled: string[] = [];
  const fill = (obj: Record<string, unknown>, key: string, value: unknown, path: string) => {
    const current = obj[key];
    const empty = current === undefined || current === null || current === '';
    if (empty && value !== undefined && value !== null && value !== '') {
      obj[key] = value;
      filled.push(path);
    }
  };

  const p = vault.profile;
  const d = doc.profile;
  for (const key of [
    'firstName',
    'lastName',
    'middleName',
    'preferredName',
    'honorific',
    'suffix',
  ] as const) {
    fill(p.identity as unknown as Record<string, unknown>, key, d.identity[key], `identity.${key}`);
  }
  fill(p.contact as unknown as Record<string, unknown>, 'email', d.contact.email, 'contact.email');
  fill(
    p.contact as unknown as Record<string, unknown>,
    'secondaryEmail',
    d.contact.secondaryEmail,
    'contact.secondaryEmail',
  );
  fill(
    p.contact as unknown as Record<string, unknown>,
    'phoneType',
    d.contact.phoneType,
    'contact.phoneType',
  );
  if (!p.contact.phone.national && d.contact.phone?.national) {
    p.contact.phone = {
      countryCode: d.contact.phone.countryCode ?? '1',
      national: d.contact.phone.national,
    };
    filled.push('contact.phone');
  }
  const addr = d.address ?? {};
  for (const key of ['line1', 'line2', 'city', 'state', 'postalCode', 'country'] as const) {
    fill(p.address as unknown as Record<string, unknown>, key, addr[key], `address.${key}`);
  }
  const links = d.links ?? {};
  for (const key of ['linkedin', 'github', 'portfolio', 'website'] as const) {
    fill(p.links as unknown as Record<string, unknown>, key, links[key], `links.${key}`);
  }
  if (!p.summary && d.summary) {
    p.summary = materializeSnippet(d.summary);
    filled.push('summary');
  }
  if (!p.coverLetter && d.coverLetter) {
    p.coverLetter = materializeSnippet(d.coverLetter);
    filled.push('coverLetter');
  }
  if (d.languages && (!p.languages || p.languages.length === 0)) {
    p.languages = d.languages;
    filled.push('languages');
  }
  const newSkills = (d.skills ?? []).filter((s) => !p.skills.includes(s));
  p.skills.push(...newSkills);
  summary.added.skills = newSkills.length;
  summary.profileFieldsFilled = filled;
}

/**
 * `merge-add` (SPEC §9.2 default): everything in the document is *added*; nothing existing is
 * modified or deleted, except empty profile scalars which are filled in.
 * Duplicate detection: work by company+title+startDate; education by school+degree;
 * answers by well-known key (custom answers by question text); files by name+size.
 */
export function mergeAdd(vault: Vault, doc: InterchangeDocument): ImportResult {
  const summary: ImportSummary = {
    added: {
      work: 0,
      education: 0,
      projects: 0,
      certifications: 0,
      answers: 0,
      versions: 0,
      files: 0,
      skills: 0,
    },
    profileFieldsFilled: [],
    skipped: [],
  };

  // Versions whose include lists cover *everything* of a type before the import keep that
  // "everything" semantics afterwards (the auto-created default is "Everything / impact-first",
  // SPEC §3.1); curated subsets are left untouched. Recorded before mutation.
  const includesAll = vault.versions.map((v) => ({
    version: v,
    work: vault.work.every((w) => v.include.workIds.includes(w.id)),
    education: vault.education.every((e) => v.include.educationIds.includes(e.id)),
    projects: vault.projects.every((pr) => v.include.projectIds.includes(pr.id)),
    certifications: vault.certifications.every((c) => v.include.certificationIds.includes(c.id)),
  }));

  mergeProfile(vault, doc, summary);

  const workKey = (w: { company: string; title: string; startDate?: string }) =>
    `${w.company}|${w.title}|${w.startDate ?? ''}`.toLowerCase();
  const existingWork = new Set(vault.work.map(workKey));
  for (const loose of doc.work ?? []) {
    if (existingWork.has(workKey(loose))) {
      summary.skipped.push(
        `work "${loose.title} @ ${loose.company}" already exists (merge-add never overwrites)`,
      );
      continue;
    }
    const work = materializeWork(loose);
    vault.work.push(work);
    existingWork.add(workKey(work));
    summary.added.work++;
  }

  const eduKey = (e: { school: string; degree?: string }) =>
    `${e.school}|${e.degree ?? ''}`.toLowerCase();
  const existingEdu = new Set(vault.education.map(eduKey));
  for (const loose of doc.education ?? []) {
    if (existingEdu.has(eduKey(loose))) {
      summary.skipped.push(`education "${loose.school}" already exists`);
      continue;
    }
    const education = materializeEducation(loose);
    vault.education.push(education);
    existingEdu.add(eduKey(education));
    summary.added.education++;
  }

  const projectKey = (p: { name: string }) => p.name.toLowerCase();
  const existingProjects = new Set(vault.projects.map(projectKey));
  for (const loose of doc.projects ?? []) {
    if (existingProjects.has(projectKey(loose))) {
      summary.skipped.push(`project "${loose.name}" already exists`);
      continue;
    }
    const project = materializeProject(loose);
    vault.projects.push(project);
    existingProjects.add(projectKey(project));
    summary.added.projects++;
  }

  const certKey = (c: { name: string; issuer?: string }) =>
    `${c.name}|${c.issuer ?? ''}`.toLowerCase();
  const existingCerts = new Set(vault.certifications.map(certKey));
  for (const loose of doc.certifications ?? []) {
    if (existingCerts.has(certKey(loose))) {
      summary.skipped.push(`certification "${loose.name}" already exists`);
      continue;
    }
    const cert = materializeCertification(loose);
    vault.certifications.push(cert);
    existingCerts.add(certKey(cert));
    summary.added.certifications++;
  }

  const answerKeyOf = (a: { key?: string; question: string }) =>
    a.key ?? `q:${a.question.toLowerCase()}`;
  const existingAnswers = new Set(vault.answers.map(answerKeyOf));
  for (const loose of doc.answers ?? []) {
    // SPEC §4.3: EEO answers are opt-in to even store.
    if (loose.key && EEO_ANSWER_KEYS.includes(loose.key) && !vault.settings.storeEeoAnswers) {
      summary.skipped.push(
        `EEO answer "${loose.key}" not stored — enable "store EEO answers" in options first (opt-in)`,
      );
      continue;
    }
    if (existingAnswers.has(answerKeyOf(loose))) {
      summary.skipped.push(`answer "${loose.key ?? loose.question}" already exists`);
      continue;
    }
    const answer = materializeAnswer(loose);
    vault.answers.push(answer);
    existingAnswers.add(answerKeyOf(answer));
    summary.added.answers++;
  }

  const files: ImportedFilePayload[] = [];
  const fileKey = (f: { name: string; size: number }) => `${f.name}|${f.size}`;
  const existingFiles = new Set(vault.files.map(fileKey));
  for (const loose of doc.files ?? []) {
    const payload = materializeFile(loose);
    if (existingFiles.has(fileKey(payload.record))) {
      summary.skipped.push(`file "${loose.name}" already exists (same name and size)`);
      continue;
    }
    vault.files.push(payload.record);
    files.push(payload);
    existingFiles.add(fileKey(payload.record));
    summary.added.files++;
  }

  // Extend the "everything" versions with the newly added entities.
  for (const entry of includesAll) {
    const inc = entry.version.include;
    if (entry.work) inc.workIds = vault.work.map((w) => w.id);
    if (entry.education) inc.educationIds = vault.education.map((e) => e.id);
    if (entry.projects) inc.projectIds = vault.projects.map((p) => p.id);
    if (entry.certifications) inc.certificationIds = vault.certifications.map((c) => c.id);
  }

  const existingVersionNames = new Set(vault.versions.map((v) => v.name.toLowerCase()));
  for (const loose of doc.versions ?? []) {
    if (existingVersionNames.has(loose.name.toLowerCase())) {
      summary.skipped.push(`version "${loose.name}" already exists`);
      continue;
    }
    const version = materializeVersion(loose, vault);
    vault.versions.push(version);
    existingVersionNames.add(version.name.toLowerCase());
    summary.added.versions++;
  }

  vault.updatedAt = nowIso();
  return { vault: normalizeVault(vault), files, summary };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Builds the interchange document (SPEC §9.1): the vault minus settings/siteMemory, with file
 * bytes inlined as base64. `fileBytes` maps `StoredFile.id` → bytes; files whose bytes are
 * missing from the store are exported as metadata-free (skipped) rather than lied about.
 */
export function exportVault(vault: Vault, fileBytes: Map<string, Uint8Array>): InterchangeDocument {
  const files: InterchangeFile[] = [];
  for (const record of vault.files) {
    const bytes = fileBytes.get(record.id);
    if (!bytes) continue;
    files.push({
      id: record.id,
      kind: record.kind,
      name: record.name,
      mime: record.mime,
      base64: encodeBase64(bytes),
    });
  }
  return {
    $schema: 'https://occamsgarage.com/jobfill/import.schema.json',
    schemaVersion: 1,
    profile: vault.profile,
    work: vault.work,
    education: vault.education,
    projects: vault.projects,
    certifications: vault.certifications,
    answers: vault.answers,
    versions: vault.versions,
    files,
  };
}
