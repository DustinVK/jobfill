/**
 * Shared demo seeding: the SAMPLE vault (fictional "Maya Okafor" from
 * ai/examples/sample-import.json) into the localStorage-backed storage adapter, so the
 * options view and the form views share one editable vault on the phone. File BYTES live
 * in a per-page memory blob store, so they are re-seeded on every load against whatever
 * bytesRef the stored vault carries.
 *
 * Demo-only code: never shipped, never touches `browser.*`.
 */
import type { BlobStoreAdapter, StorageAdapter } from '../shared/adapters/types.js';
import type { InterchangeDocument, Vault } from '../shared/types.js';
import { createEmptyVault } from '../shared/vault.js';
import { mergeAdd } from '../shared/interchange.js';
import sampleImport from '../../ai/examples/sample-import.json';

interface StoredPlainEnvelope {
  v: 1;
  enc: 'none';
  data: Vault;
}

export async function seedDemoVault(
  storage: StorageAdapter,
  blobs: BlobStoreAdapter,
): Promise<void> {
  const existing = await storage.local.get<StoredPlainEnvelope>('vault');
  let vault: Vault;
  let sampleBytesByName: Map<string, Uint8Array>;

  if (existing?.data) {
    vault = existing.data;
    // Bytes are memory-only: recover them from the sample for any file we recognize.
    const fresh = mergeAdd(createEmptyVault(), sampleImport as unknown as InterchangeDocument);
    sampleBytesByName = new Map(fresh.files.map((f) => [f.record.name, f.bytes]));
  } else {
    const seeded = mergeAdd(createEmptyVault(), sampleImport as unknown as InterchangeDocument);
    vault = seeded.vault;
    const resume = vault.files.find((f) => f.kind === 'resume');
    const active = vault.versions.find((v) => v.id === vault.settings.activeVersionId);
    if (resume && active) active.fileId = resume.id;
    sampleBytesByName = new Map(seeded.files.map((f) => [f.record.name, f.bytes]));
    await storage.local.set('vault', { v: 1, enc: 'none', data: vault });
  }

  for (const record of vault.files) {
    const bytes = sampleBytesByName.get(record.name);
    if (bytes) {
      await blobs.put(
        record.bytesRef,
        new Blob([bytes as unknown as BlobPart], { type: record.mime }),
      );
    }
  }
}
