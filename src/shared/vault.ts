/**
 * Vault construction helpers: the empty vault, the auto-created default version (SPEC §3.1),
 * and small guards shared by the DataService and the importer.
 */
import type { ResumeVersion, Settings, Vault } from './types.js';

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
