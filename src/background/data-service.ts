/**
 * DataService — the single code path for all vault reads and writes (SPEC §6.1).
 * Lives in the background; everything else reaches it via the message protocol.
 * The codec boundary (SPEC §6.3) sits between this class and the storage adapter.
 */
import type { StorageAdapter } from '../shared/adapters/types.js';
import type { PatchOp } from '../shared/messages.js';
import type { InterchangeDocument, Vault } from '../shared/types.js';
import { createEmptyVault, normalizeVault, nowIso } from '../shared/vault.js';
import { exportVault, mergeAdd, type ImportSummary } from '../shared/interchange.js';
import { PlainCodec, isStoredEnvelope, type VaultCodec } from './codecs.js';
import type { FileStore } from './file-store.js';

const VAULT_KEY = 'vault';

export class DataService {
  private cache: Vault | undefined;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly storage: StorageAdapter,
    private readonly files: FileStore,
    private readonly codec: VaultCodec = new PlainCodec(),
  ) {}

  /** Loads (and caches) the vault; a missing or unreadable-but-absent store yields a fresh one. */
  async getVault(): Promise<Vault> {
    if (this.cache) return this.cache;
    const raw = await this.storage.local.get<unknown>(VAULT_KEY);
    if (raw === undefined) {
      const vault = createEmptyVault();
      await this.persist(vault);
      return vault;
    }
    if (!isStoredEnvelope(raw)) {
      // Unrecognized stored data is an error, not a silent wipe — the user's data is at stake.
      throw new Error('jobfill: stored vault has an unrecognized format');
    }
    const vault = await this.codec.decode(raw);
    this.cache = vault;
    return vault;
  }

  private async persist(vault: Vault): Promise<void> {
    vault.updatedAt = nowIso();
    this.cache = vault;
    const write = this.writeChain.then(async () => {
      const envelope = await this.codec.encode(vault);
      await this.storage.local.set(VAULT_KEY, envelope);
    });
    // Serialize writes so a slow encode can never land after a newer one.
    this.writeChain = write.catch(() => undefined);
    await write;
  }

  /** Applies typed section replacements (see messages.ts PatchOp) and persists. */
  async patch(ops: PatchOp[]): Promise<Vault> {
    const vault = await this.getVault();
    for (const op of ops) {
      switch (op.section) {
        case 'profile':
          vault.profile = op.value;
          break;
        case 'work':
          vault.work = op.value;
          break;
        case 'education':
          vault.education = op.value;
          break;
        case 'projects':
          vault.projects = op.value;
          break;
        case 'certifications':
          vault.certifications = op.value;
          break;
        case 'answers':
          vault.answers = op.value;
          break;
        case 'versions':
          vault.versions = op.value;
          break;
        case 'settings':
          vault.settings = op.value;
          break;
      }
    }
    normalizeVault(vault);
    await this.persist(vault);
    return vault;
  }

  /** Wipes everything: vault document and all stored file bytes. */
  async wipe(): Promise<Vault> {
    const old = await this.getVault();
    for (const record of old.files) {
      await this.files.delete(record);
    }
    const vault = createEmptyVault();
    await this.persist(vault);
    return vault;
  }

  async setActiveVersion(id: string): Promise<string> {
    const vault = await this.getVault();
    if (!vault.versions.some((v) => v.id === id)) {
      throw new Error(`jobfill: no version with id "${id}"`);
    }
    vault.settings.activeVersionId = id;
    await this.persist(vault);
    return id;
  }

  /** Builds the interchange export with file bytes inlined (SPEC §6.4). */
  async export(): Promise<InterchangeDocument> {
    const vault = await this.getVault();
    const bytes = new Map<string, Uint8Array>();
    for (const record of vault.files) {
      const file = await this.files.getFile(record);
      if (file) bytes.set(record.id, new Uint8Array(await file.arrayBuffer()));
    }
    return exportVault(vault, bytes);
  }

  /**
   * merge-add import (SPEC §9.2). The document must already be schema-validated by the
   * caller; this re-checks only the structural minimum before mutating.
   */
  async import(document: InterchangeDocument): Promise<{ vault: Vault; summary: ImportSummary }> {
    if (document.schemaVersion !== 1 || typeof document.profile !== 'object') {
      throw new Error('jobfill: import document failed structural check');
    }
    const vault = await this.getVault();
    const result = mergeAdd(vault, document);
    for (const payload of result.files) {
      await this.files.putBytes(payload.record.bytesRef, payload.bytes, payload.record.mime);
    }
    await this.persist(result.vault);
    return { vault: result.vault, summary: result.summary };
  }
}
