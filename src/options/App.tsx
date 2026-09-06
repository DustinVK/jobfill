/**
 * The options app (SPEC §8.1). All data flows through the ProtocolClient — the app never
 * touches storage directly. Edits are local until "Save"; save sends a section PatchOp.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ProtocolClient, PatchOp } from '../shared/messages.js';
import type { Vault } from '../shared/types.js';
import { ProfileEditor } from './components/ProfileEditor.js';
import { WorkEditor } from './components/WorkEditor.js';
import { AnswersEditor } from './components/AnswersEditor.js';
import { VersionsEditor } from './components/VersionsEditor.js';
import { ImportExport } from './components/ImportExport.js';
import { FilesPanel } from './components/FilesPanel.js';

const TABS = ['Profile', 'Work', 'Answers', 'Versions', 'Files', 'Import / Export'] as const;
type Tab = (typeof TABS)[number];

export function App({ client }: { client: ProtocolClient }) {
  const [vault, setVault] = useState<Vault | undefined>();
  const [tab, setTab] = useState<Tab>('Profile');
  const [dirty, setDirty] = useState<Set<PatchOp['section']>>(new Set());
  const [status, setStatus] = useState('');

  const reload = useCallback(() => {
    client
      .send({ t: 'vault.get' })
      .then(({ vault: v }) => {
        setVault(v);
        setDirty(new Set());
      })
      .catch((e: unknown) => setStatus(`Failed to load: ${String(e)}`));
  }, [client]);

  useEffect(() => reload(), [reload]);

  // Unsaved edits must never vanish silently (rung-1 review P1-10).
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current.size > 0) e.preventDefault();
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, []);

  const confirmDiscard = useCallback((): boolean => {
    if (dirtyRef.current.size === 0) return true;
    return window.confirm('You have unsaved changes that will be discarded. Continue?');
  }, []);

  const edit = useCallback((section: PatchOp['section'], value: unknown) => {
    setVault((v) => (v ? ({ ...v, [section]: value } as Vault) : v));
    setDirty((d) => new Set(d).add(section));
  }, []);

  const save = useCallback(async () => {
    if (!vault || dirty.size === 0) return;
    setStatus('Saving…');
    try {
      const ops = [...dirty].map((section) => ({ section, value: vault[section] }) as PatchOp);
      const { vault: saved } = await client.send({ t: 'vault.patch', ops });
      setVault(saved);
      setDirty(new Set());
      setStatus('Saved.');
    } catch (e) {
      setStatus(`Save failed: ${String(e)}`);
    }
  }, [client, vault, dirty]);

  const setActive = useCallback(
    async (id: string) => {
      if (!confirmDiscard()) return;
      await client.send({ t: 'version.setActive', id });
      reload();
    },
    [client, reload, confirmDiscard],
  );

  const dirtyLabel = useMemo(() => [...dirty].join(', '), [dirty]);

  if (!vault) {
    return (
      <main>
        <h1>jobfill</h1>
        <p class="subtitle">{status || 'Loading…'}</p>
      </main>
    );
  }

  return (
    <main>
      <header class="app-head">
        <div>
          <h1>jobfill</h1>
          <p class="subtitle">Local-only resume storage and application autofill.</p>
        </div>
        <div class="save-area">
          {dirty.size > 0 && <span class="muted">unsaved: {dirtyLabel}</span>}
          <button
            type="button"
            onClick={() => void save()}
            disabled={dirty.size === 0}
            data-testid="save-btn"
          >
            Save
          </button>
          <span class="status" data-testid="status" aria-live="polite">
            {status}
          </span>
        </div>
      </header>

      <nav class="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            class={tab === t ? 'tab tab-on' : 'tab'}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </nav>

      {tab === 'Profile' && (
        <ProfileEditor profile={vault.profile} onChange={(p) => edit('profile', p)} />
      )}
      {tab === 'Work' && <WorkEditor work={vault.work} onChange={(w) => edit('work', w)} />}
      {tab === 'Answers' && (
        <AnswersEditor
          answers={vault.answers}
          settings={vault.settings}
          onChange={(a) => edit('answers', a)}
          onSettingsChange={(s) => edit('settings', s)}
        />
      )}
      {tab === 'Versions' && (
        <VersionsEditor
          vault={vault}
          onChange={(v) => edit('versions', v)}
          onSetActive={(id) => void setActive(id)}
        />
      )}
      {tab === 'Files' && (
        <FilesPanel
          vault={vault}
          client={client}
          onVersionsChange={(v) => edit('versions', v)}
          onVaultChanged={reload}
          confirmDiscard={confirmDiscard}
        />
      )}
      {tab === 'Import / Export' && (
        <ImportExport client={client} onVaultChanged={reload} confirmDiscard={confirmDiscard} />
      )}
    </main>
  );
}
