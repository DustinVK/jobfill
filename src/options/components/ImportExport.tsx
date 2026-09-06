/**
 * Import/export (SPEC §9.2, Rung 1 scope): export downloads the interchange JSON; import
 * validates with the precompiled schema validator, runs merge-add, and shows a summary
 * screen. The dry-run diff screen is Rung 4 optional.
 */
import { useState } from 'preact/hooks';
import type { ProtocolClient } from '../../shared/messages.js';
import type { InterchangeDocument } from '../../shared/types.js';
import { mergeAdd, type ImportSummary } from '../../shared/interchange.js';
import { formatValidationErrors, validateImport } from '../../shared/validate-import.js';

export function ImportExport({
  client,
  onVaultChanged,
  confirmDiscard,
}: {
  client: ProtocolClient;
  onVaultChanged: () => void;
  confirmDiscard: () => boolean;
}) {
  const [summary, setSummary] = useState<ImportSummary | undefined>();
  const [errorReport, setErrorReport] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [wipeArmed, setWipeArmed] = useState(false);
  /** Validated document awaiting confirmation, with its dry-run preview. */
  const [pending, setPending] = useState<
    { document: InterchangeDocument; preview: ImportSummary } | undefined
  >();

  const doExport = async () => {
    setBusy(true);
    try {
      const { document: doc } = await client.send({ t: 'vault.export' });
      const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `jobfill-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      // Revoking synchronously can cancel the download in Firefox; give it a beat.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } finally {
      setBusy(false);
    }
  };

  const stageImport = async (file: File) => {
    setSummary(undefined);
    setErrorReport(undefined);
    setPending(undefined);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setErrorReport('The file is not valid JSON.');
      return;
    }
    const validation = validateImport(parsed);
    if (!validation.valid) {
      // SPEC §9.2: errors render with JSON paths, designed to be pasted back to the AI.
      setErrorReport(formatValidationErrors(validation.errors));
      return;
    }
    // Dry-run (SPEC §9.2): merge-add against a CLONE of the current vault — nothing is
    // written until the user confirms. Merge-add never deletes or modifies, so the preview
    // is exactly "what will be added / what will be skipped".
    try {
      const { vault } = await client.send({ t: 'vault.get' });
      const preview = mergeAdd(structuredClone(vault), validation.document).summary;
      setPending({ document: validation.document, preview });
    } catch (err) {
      setErrorReport(err instanceof Error ? err.message : String(err));
    }
  };

  const confirmImport = async () => {
    if (!pending || !confirmDiscard()) return;
    setBusy(true);
    try {
      const result = await client.send({ t: 'vault.import', document: pending.document });
      setSummary(result.summary);
      setPending(undefined);
      onVaultChanged();
    } catch (err) {
      setErrorReport(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const doWipe = async () => {
    if (!wipeArmed) {
      setWipeArmed(true);
      return;
    }
    if (!confirmDiscard()) return;
    setBusy(true);
    try {
      await client.send({ t: 'vault.wipe', confirm: 'wipe' });
      setWipeArmed(false);
      setSummary(undefined);
      onVaultChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <section class="panel">
        <h2>Export</h2>
        <p class="muted">
          Everything (including stored files) as one JSON — the same format the import and the AI
          skill use.
        </p>
        <button type="button" disabled={busy} onClick={doExport} data-testid="export-btn">
          Export vault as JSON
        </button>
      </section>

      <section class="panel">
        <h2>Import</h2>
        <p class="muted">
          Accepts an <code>import.json</code> — hand-written, exported, or produced by the AI import
          skill in <code>ai/</code>. Merge-add: existing entries are never modified or deleted;
          duplicates are skipped.
        </p>
        <input
          type="file"
          accept="application/json,.json"
          data-testid="import-file"
          disabled={busy}
          onChange={(e) => {
            const file = (e.currentTarget as HTMLInputElement).files?.[0];
            if (file) void stageImport(file);
            (e.currentTarget as HTMLInputElement).value = '';
          }}
        />
        {pending && (
          <div class="import-summary" data-testid="import-preview">
            <h3>Preview — nothing imported yet</h3>
            <ul>
              {Object.entries(pending.preview.added)
                .filter(([, n]) => n > 0)
                .map(([what, n]) => (
                  <li key={what}>
                    Will add {n} {what}
                  </li>
                ))}
              {pending.preview.profileFieldsFilled.length > 0 && (
                <li>
                  Will fill empty profile fields: {pending.preview.profileFieldsFilled.join(', ')}
                </li>
              )}
              {Object.values(pending.preview.added).every((n) => n === 0) &&
                pending.preview.profileFieldsFilled.length === 0 && <li>Nothing new to add.</li>}
            </ul>
            {pending.preview.skipped.length > 0 && (
              <details>
                <summary>
                  {pending.preview.skipped.length} will be skipped (already present)
                </summary>
                <ul>
                  {pending.preview.skipped.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </details>
            )}
            <div class="entry-head">
              <button
                type="button"
                disabled={busy}
                onClick={() => void confirmImport()}
                data-testid="confirm-import"
              >
                Import
              </button>
              <button type="button" class="btn-ghost" onClick={() => setPending(undefined)}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {errorReport !== undefined && (
          <div class="error-report" data-testid="import-errors">
            <h3>Import failed validation</h3>
            <pre>{errorReport}</pre>
            <button type="button" onClick={() => void navigator.clipboard.writeText(errorReport)}>
              Copy error report
            </button>
            <p class="muted">
              Paste this back to whatever produced the file — it lists exact JSON paths.
            </p>
          </div>
        )}
        {summary && (
          <div class="import-summary" data-testid="import-summary">
            <h3>Import complete</h3>
            <ul>
              {Object.entries(summary.added)
                .filter(([, n]) => n > 0)
                .map(([what, n]) => (
                  <li key={what}>
                    Added {n} {what}
                  </li>
                ))}
              {summary.profileFieldsFilled.length > 0 && (
                <li>Filled profile fields: {summary.profileFieldsFilled.join(', ')}</li>
              )}
            </ul>
            {summary.skipped.length > 0 && (
              <details>
                <summary>{summary.skipped.length} skipped</summary>
                <ul>
                  {summary.skipped.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </section>

      <section class="panel danger-panel">
        <h2>Wipe</h2>
        <p class="muted">Deletes the entire vault and all stored files. Export first.</p>
        <button
          type="button"
          class="btn-danger"
          disabled={busy}
          onClick={doWipe}
          data-testid="wipe-btn"
        >
          {wipeArmed ? 'Click again to permanently wipe everything' : 'Wipe vault…'}
        </button>
        {wipeArmed && (
          <button type="button" class="btn-ghost" onClick={() => setWipeArmed(false)}>
            Cancel
          </button>
        )}
      </section>
    </div>
  );
}
