/**
 * Popup (SPEC §8.1, §8.5): the "Fill this page" trigger + per-site auto-run + options
 * shortcut. Adapter-agnostic — main.tsx passes in the browser-backed env, tests pass mocks.
 *
 * Why this exists: with `action.default_popup` set, a toolbar click (and Alt+Shift+J via
 * `_execute_action`) opens THIS popup instead of firing any background listener — so the
 * popup itself must do the injection. The click that opened us granted `activeTab`. On
 * Android the popup is the ONLY invocation surface (no commands, no sidebar), presented
 * full-window.
 *
 * Gesture rule (SPEC §8.5): `permissions.request` and `scripting.executeScript` are started
 * SYNCHRONOUSLY inside the click handlers — Firefox drops the user-gesture token at the
 * first `await`, and this popup is the only surface that can acquire site permission.
 */
import { useEffect, useState } from 'preact/hooks';

export interface PopupEnv {
  /** Active tab of the current window, if any. */
  getActiveTab(): Promise<{ id?: number; url?: string; title?: string } | undefined>;
  /** Injects the content bundle into the tab; resolves true when any frame loaded it.
   *  Callers MUST invoke this synchronously inside the user gesture. */
  fillPage(tabId: number): Promise<boolean>;
  /** True when the site's host permission is already granted (auto-run active). */
  hasSitePermission(url: string): Promise<boolean>;
  /** Prompts for the site's host permission. MUST be invoked synchronously in the gesture. */
  requestSitePermission(url: string): Promise<boolean>;
  removeSitePermission(url: string): Promise<boolean>;
  openOptions(): Promise<void>;
  close(): void;
  /** Coarse-pointer device (Android/tablet) — hides keyboard-only hints. */
  isTouch: boolean;
}

/** Pages the browser will never let a content script into. */
function isInjectablePage(url: string | undefined): boolean {
  if (!url) return false;
  return /^https?:|^file:/.test(url);
}

/** Host permissions only make sense for http(s) origins. */
function sitePermissionEligible(url: string | undefined): boolean {
  if (!url) return false;
  return /^https?:/.test(url);
}

function hostOf(url: string | undefined): string {
  try {
    return url ? new URL(url).host : '';
  } catch {
    return '';
  }
}

export function App({ env }: { env: PopupEnv }) {
  const [tab, setTab] = useState<{ id?: number; url?: string } | undefined>();
  const [autoRun, setAutoRun] = useState<boolean | undefined>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    env
      .getActiveTab()
      .then((active) => {
        setTab(active);
        if (sitePermissionEligible(active?.url)) {
          env
            .hasSitePermission(active!.url!)
            .then(setAutoRun)
            .catch(() => setAutoRun(undefined));
        }
      })
      .catch(() => setTab(undefined));
  }, [env]);

  const injectable = tab?.id !== undefined && isInjectablePage(tab.url);
  const host = hostOf(tab?.url);

  const fill = () => {
    if (tab?.id === undefined) return;
    // Start the injection synchronously — the gesture dies at the first await.
    const injection = env.fillPage(tab.id);
    setBusy(true);
    setError('');
    injection
      .then((ok) => {
        if (ok) {
          env.close(); // hand the page back — the fill bar is up
        } else {
          setError('Firefox refused the injection on this page (protected or quarantined site).');
        }
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };

  const toggleAutoRun = () => {
    if (!tab?.url || autoRun === undefined) return;
    // permissions.request MUST start synchronously in the click — after an await Firefox
    // treats it as gesture-less and rejects. remove() has no such rule but shares the path.
    const op = autoRun ? env.removeSitePermission(tab.url) : env.requestSitePermission(tab.url);
    const wasGrant = !autoRun;
    setBusy(true);
    setError('');
    op.then((changed) => {
      if (changed) setAutoRun(wasGrant);
    })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };

  return (
    <div class="popup">
      <header>
        <strong>jobfill</strong>
        {host && <span class="host">{host}</span>}
      </header>
      <button
        type="button"
        class="primary"
        data-testid="fill-page"
        disabled={!injectable || busy}
        onClick={fill}
      >
        {busy ? 'Starting…' : 'Fill this page'}
      </button>
      {!injectable && tab !== undefined && (
        <p class="muted" data-testid="not-injectable">
          jobfill can’t run on this page — open a job application form first.
        </p>
      )}
      {sitePermissionEligible(tab?.url) && autoRun !== undefined && (
        <button
          type="button"
          class="secondary"
          data-testid="auto-run"
          disabled={busy}
          onClick={toggleAutoRun}
        >
          {autoRun ? `✓ Auto-runs on ${host} — tap to stop` : `Always run on ${host}`}
        </button>
      )}
      {error && (
        <p class="error" data-testid="popup-error">
          {error}
        </p>
      )}
      {!env.isTouch && (
        <p class="muted" data-testid="kbd-tip">
          Tip: <kbd>Alt+Shift+Space</kbd> opens the search palette on any page.
        </p>
      )}
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
