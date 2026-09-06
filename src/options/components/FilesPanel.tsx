/**
 * Files manager (SPEC M3 / Rung 3): upload into the FileStore, list, delete, link a file
 * to a version. Bytes travel as ArrayBuffer over the protocol; metadata lives in the vault.
 */
import { useState } from 'preact/hooks';
import type { ProtocolClient } from '../../shared/messages.js';
import type { ResumeVersion, StoredFile, StoredFileKind, Vault } from '../../shared/types.js';

const KIND_LABELS: Record<StoredFileKind, string> = {
  resume: 'Resume',
  coverLetter: 'Cover letter',
  other: 'Other',
};

export function FilesPanel({
  vault,
  client,
  onVersionsChange,
  onVaultChanged,
  confirmDiscard,
}: {
  vault: Vault;
  client: ProtocolClient;
  onVersionsChange: (versions: ResumeVersion[]) => void;
  onVaultChanged: () => void;
  confirmDiscard: () => boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [kind, setKind] = useState<StoredFileKind>('resume');

  const upload = async (file: File) => {
    if (!confirmDiscard()) return; // the post-upload reload would drop unsaved edits
    setBusy(true);
    setError('');
    try {
      await client.send({
        t: 'file.add',
        kind,
        name: file.name,
        mime: file.type || 'application/octet-stream',
        bytes: await file.arrayBuffer(),
      });
      onVaultChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (file: StoredFile) => {
    if (!confirmDiscard()) return;
    setBusy(true);
    try {
      await client.send({ t: 'file.delete', fileId: file.id });
      onVaultChanged();
    } finally {
      setBusy(false);
    }
  };

  const linkToVersion = (
    file: StoredFile,
    versionId: string,
    slot: 'fileId' | 'coverLetterFileId',
  ) => {
    onVersionsChange(
      vault.versions.map((v) => (v.id === versionId ? { ...v, [slot]: file.id } : v)),
    );
  };

  const linkedVersions = (file: StoredFile): string[] =>
    vault.versions
      .filter((v) => v.fileId === file.id || v.coverLetterFileId === file.id)
      .map((v) => v.name);

  return (
    <div>
      <section class="panel">
        <h2>Upload</h2>
        <div class="entry-head">
          <label class="field">
            <span>Kind</span>
            <select
              value={kind}
              data-testid="file-kind"
              onChange={(e) =>
                setKind((e.currentTarget as HTMLSelectElement).value as StoredFileKind)
              }
            >
              {(Object.keys(KIND_LABELS) as StoredFileKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label class="field field-grow">
            <span>File (PDF/DOCX)</span>
            <input
              type="file"
              data-testid="file-upload"
              accept=".pdf,.docx,.doc,.txt,.md,application/pdf"
              disabled={busy}
              onChange={(e) => {
                const file = (e.currentTarget as HTMLInputElement).files?.[0];
                if (file) void upload(file);
                (e.currentTarget as HTMLInputElement).value = '';
              }}
            />
          </label>
        </div>
        {error && (
          <p class="jf-warn" style={{ color: 'var(--danger)' }}>
            {error}
          </p>
        )}
      </section>

      <section class="panel">
        <h2>Stored files</h2>
        {vault.files.length === 0 && <p class="muted">No files yet. Upload a resume above.</p>}
        {vault.files.map((file) => (
          <div class="panel" key={file.id} data-testid="file-row">
            <div class="entry-head">
              <strong>{file.name}</strong>
              <span class="muted">
                {KIND_LABELS[file.kind]} · {file.mime} · {Math.max(1, Math.round(file.size / 1024))}{' '}
                KB
              </span>
              <span class="spacer" />
              <button
                type="button"
                class="btn-ghost"
                disabled={busy}
                onClick={() => void remove(file)}
              >
                Delete
              </button>
            </div>
            <div class="entry-head">
              <span class="muted">
                {linkedVersions(file).length > 0
                  ? `Attached to: ${linkedVersions(file).join(', ')}`
                  : 'Not attached to any version'}
              </span>
              <span class="spacer" />
              <label class="field">
                <span class="sr-only">Attach to version</span>
                <select
                  data-testid="link-version"
                  value=""
                  onChange={(e) => {
                    const versionId = (e.currentTarget as HTMLSelectElement).value;
                    if (versionId) {
                      linkToVersion(
                        file,
                        versionId,
                        file.kind === 'coverLetter' ? 'coverLetterFileId' : 'fileId',
                      );
                    }
                    (e.currentTarget as HTMLSelectElement).value = '';
                  }}
                >
                  <option value="">Attach to version…</option>
                  {vault.versions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        ))}
        <p class="muted">
          Version links save with the Versions section — hit Save after attaching.
        </p>
      </section>
    </div>
  );
}
