/**
 * Vault construction helpers: the empty vault, the auto-created default version (SPEC §3.1),
 * and small guards shared by the DataService and the importer.
 */
import type { ResumeVersion, Settings, Vault } from './types.js';
import { ALWAYS_SENSITIVE_ANSWER_KEYS, EEO_ANSWER_KEYS } from './types.js';

export const DEFAULT_VERSION_NAME = 'Everything / impact-first';

export function newId(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** SPEC §3.1: a default "Everything / impact-first" version is auto-created. */
export function createDefaultVersion(id: string = newId()): ResumeVersion {
  return {
    id,
    name: DEFAULT_VERSION_NAME,
    include: { workIds: [], educationIds: [], projectIds: [], certificationIds: [] },
    stylePriority: ['impact', 'short'],
    variantPrefs: {},
  };
}

export function createDefaultSettings(activeVersionId: string): Settings {
  return {
    activeVersionId,
    encryption: { enabled: false },
    fillAllThreshold: 0.8,
    suggestThreshold: 0.5,
    paletteShortcutHint: 'Alt+Shift+Space',
    storeEeoAnswers: false,
  };
}

export function createEmptyVault(): Vault {
  const version = createDefaultVersion();
  return {
    schemaVersion: 1,
    profile: {
      identity: { firstName: '', lastName: '' },
      contact: { email: '', phone: { countryCode: '1', national: '' } },
      address: {},
      links: {},
      skills: [],
    },
    work: [],
    education: [],
    projects: [],
    certifications: [],
    answers: [],
    versions: [version],
    files: [],
    settings: createDefaultSettings(version.id),
    siteMemory: {},
    updatedAt: nowIso(),
  };
}

/**
 * "Include-all" bookkeeping: a version that includes every entity of a type before a
 * mutation keeps including everything afterwards (preserves the auto-created
 * "Everything / impact-first" semantics for imports AND options-app edits); curated
 * subsets stay untouched. Record before mutating, apply after.
 */
export interface IncludeAllToken {
  perVersion: Map<
    string,
    { work: boolean; education: boolean; projects: boolean; certifications: boolean }
  >;
}

export function recordIncludeAll(vault: Vault): IncludeAllToken {
  const perVersion = new Map<
    string,
    { work: boolean; education: boolean; projects: boolean; certifications: boolean }
  >();
  for (const v of vault.versions) {
    perVersion.set(v.id, {
      work: vault.work.every((w) => v.include.workIds.includes(w.id)),
      education: vault.education.every((e) => v.include.educationIds.includes(e.id)),
      projects: vault.projects.every((p) => v.include.projectIds.includes(p.id)),
      certifications: vault.certifications.every((c) => v.include.certificationIds.includes(c.id)),
    });
  }
  return { perVersion };
}

export function applyIncludeAll(vault: Vault, token: IncludeAllToken): void {
  for (const version of vault.versions) {
    const flags = token.perVersion.get(version.id);
    if (!flags) continue;
    if (flags.work) version.include.workIds = vault.work.map((w) => w.id);
    if (flags.education) version.include.educationIds = vault.education.map((e) => e.id);
    if (flags.projects) version.include.projectIds = vault.projects.map((p) => p.id);
    if (flags.certifications)
      version.include.certificationIds = vault.certifications.map((c) => c.id);
  }
}

/**
 * Safety-critical invariants enforced on EVERY write path (SPEC §4.3, §7.9) — the single
 * code path (§6.1) owns these rules, so no UI or import bug can bypass them:
 * - EEO-keyed answers are dropped entirely while `storeEeoAnswers` is off;
 * - always-sensitive answer keys (EEO, criminalDisclosure) cannot have sensitive unset;
 * - fill thresholds stay sane numbers in [0, 1].
 */
export function sanitizeVault(vault: Vault): Vault {
  if (!vault.settings.storeEeoAnswers) {
    vault.answers = vault.answers.filter(
      (a) => a.key === undefined || !EEO_ANSWER_KEYS.includes(a.key),
    );
  }
  for (const answer of vault.answers) {
    if (answer.key !== undefined && ALWAYS_SENSITIVE_ANSWER_KEYS.includes(answer.key)) {
      answer.sensitive = true;
    }
  }
  const clamp = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.min(1, Math.max(0, value))
      : fallback;
  vault.settings.fillAllThreshold = clamp(vault.settings.fillAllThreshold, 0.8);
  vault.settings.suggestThreshold = clamp(vault.settings.suggestThreshold, 0.5);
  return vault;
}

/**
 * Repairs invariants after any bulk mutation (import, wipe): at least one version exists,
 * `activeVersionId` points at a real version, and every version's include lists reference
 * only entities that exist.
 */
export function normalizeVault(vault: Vault): Vault {
  if (vault.versions.length === 0) {
    const version = createDefaultVersion();
    // A fresh default version includes everything, in stored order.
    version.include = {
      workIds: vault.work.map((w) => w.id),
      educationIds: vault.education.map((e) => e.id),
      projectIds: vault.projects.map((p) => p.id),
      certificationIds: vault.certifications.map((c) => c.id),
    };
    vault.versions.push(version);
  }
  if (!vault.versions.some((v) => v.id === vault.settings.activeVersionId)) {
    const first = vault.versions[0];
    if (first) vault.settings.activeVersionId = first.id;
  }
  const workIds = new Set(vault.work.map((w) => w.id));
  const educationIds = new Set(vault.education.map((e) => e.id));
  const projectIds = new Set(vault.projects.map((p) => p.id));
  const certificationIds = new Set(vault.certifications.map((c) => c.id));
  const fileIds = new Set(vault.files.map((f) => f.id));
  for (const version of vault.versions) {
    version.include.workIds = version.include.workIds.filter((id) => workIds.has(id));
    version.include.educationIds = version.include.educationIds.filter((id) =>
      educationIds.has(id),
    );
    version.include.projectIds = version.include.projectIds.filter((id) => projectIds.has(id));
    version.include.certificationIds = version.include.certificationIds.filter((id) =>
      certificationIds.has(id),
    );
    if (version.fileId && !fileIds.has(version.fileId)) delete version.fileId;
    if (version.coverLetterFileId && !fileIds.has(version.coverLetterFileId)) {
      delete version.coverLetterFileId;
    }
  }
  return vault;
}
