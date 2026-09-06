/**
 * FileStore — file bytes behind the blob-store adapter, metadata in the vault (SPEC §6.2).
 * Firefox messaging is structured clone, so `getFile` returns a real `File`. The base64
 * transport SPEC §6.2 sketches for a future Chrome port is NOT implemented — the wire
 * format is Firefox structured-clone only tonight (logged in PROGRESS → Deviations).
 */
import type { BlobStoreAdapter } from '../shared/adapters/types.js';
import type { StoredFile, StoredFileKind } from '../shared/types.js';
import { newId, nowIso } from '../shared/vault.js';

export class FileStore {
  constructor(private readonly blobs: BlobStoreAdapter) {}

  /** Stores bytes and returns the metadata record to persist in the vault. */
  async add(opts: {
    kind: StoredFileKind;
    name: string;
    mime: string;
    bytes: ArrayBuffer | Uint8Array | Blob;
  }): Promise<StoredFile> {
    const blob =
      opts.bytes instanceof Blob
        ? opts.bytes
        : new Blob([opts.bytes as BlobPart], { type: opts.mime });
    const record: StoredFile = {
      id: newId(),
      kind: opts.kind,
      name: opts.name,
      mime: opts.mime,
      bytesRef: newId(),
      size: blob.size,
      addedAt: nowIso(),
    };
    await this.blobs.put(record.bytesRef, blob);
    return record;
  }

  /** Rebuilds a `File` from stored bytes + metadata. */
  async getFile(record: StoredFile): Promise<File | undefined> {
    const blob = await this.blobs.get(record.bytesRef);
    if (!blob) return undefined;
    return new File([blob], record.name, { type: record.mime });
  }

  /** Persists raw bytes under an already-assigned bytesRef (import path). */
  async putBytes(bytesRef: string, bytes: Uint8Array, mime: string): Promise<void> {
    await this.blobs.put(bytesRef, new Blob([bytes as BlobPart], { type: mime }));
  }

  async delete(record: StoredFile): Promise<void> {
    await this.blobs.delete(record.bytesRef);
  }

  /** Removes blobs whose metadata no longer exists (post-import hygiene). */
  async pruneOrphans(known: StoredFile[]): Promise<number> {
    const keep = new Set(known.map((f) => f.bytesRef));
    let removed = 0;
    for (const key of await this.blobs.keys()) {
      if (!keep.has(key)) {
        await this.blobs.delete(key);
        removed++;
      }
    }
    return removed;
  }
}
