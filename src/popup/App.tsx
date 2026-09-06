/**
 * Popup (SPEC §8.1): the "Fill this page" trigger + options shortcut. Adapter-agnostic —
 * main.tsx passes in the browser-backed env, tests pass mocks.
 *
 * Why this exists: with `action.default_popup` set, a toolbar click (and Alt+Shift+J via
 * `_execute_action`) opens THIS popup instead of firing any background listener — so the
 * popup itself must do the injection. The click that opened us granted `activeTab`.
 */
import { useEffect, useState } from 'preact/hooks';

export interface PopupEnv {
  /** Active tab of the current window, if any. */
  getActiveTab(): Promise<{ id?: number; url?: string; title?: string } | undefined>;
  /** Injects the content bundle into the tab; resolves true when any frame loaded it. */
  fillPage(tabId: number): Promise<boolean>;
  openOptions(): Promise<void>;
  close(): void;
}

/** Pages the browser will never let a content script into. */
function isInjectablePage(url: string | undefined): boolean {
  if (!url) return false;
  return /^https?:|^file:/.test(url);
}

export function App({ env }: { env: PopupEnv }) {
  const [tab, setTab] = useState<{ id?: number; url?: string } | undefined>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    env
      .getActiveTab()
      .then(setTab)
      .catch(() => setTab(undefined));
  }, [env]);

  const injectable = tab?.id !== undefined && isInjectablePage(tab.url);

  const fill = async () => {
    if (tab?.id === undefined) return;
    setBusy(true);
    setError('');
    try {
      const ok = await env.fillPage(tab.id);
      if (ok) {
        env.close(); // hand the page back — the fill bar is up
      } else {
        setError('Firefox refused the injection on this page (protected or quarantined site).');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <strong>jobfill</strong>
      <button
        type="button"
        data-testid="fill-page"
        disabled={!injectable || busy}
        onClick={() => void fill()}
      >
        {busy ? 'Starting…' : 'Fill this page'}
      </button>
      {!injectable && tab !== undefined && (
        <p class="muted" data-testid="not-injectable">
          jobfill can’t run on this page — open a job application form first.
        </p>
      )}
      {error && (
        <p class="error" data-testid="popup-error">
          {error}
        </p>
      )}
      <p class="muted">
        Tip: <kbd>Alt+Shift+Space</kbd> opens the search palette on any page.
      </p>
      <button
        type="button"
        class="secondary"
        data-testid="open-options"
        onClick={() => void env.openOptions().then(() => env.close())}
      >
        Open options (your data)
      </button>
    </div>
  );
}
