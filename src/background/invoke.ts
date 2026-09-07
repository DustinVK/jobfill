/**
 * Invocation paths (SPEC §8.4). With `action.default_popup` set, toolbar clicks and
 * Alt+Shift+J (`_execute_action`) open the POPUP, which does its own injection via its
 * "Fill this page" button — no background listener fires for those. The background handles
 * only the `open-palette` command (Alt+Shift+Space). `activeTab` covers the top frame and
 * same-origin frames; cross-origin frames fail silently and are reported, never retried
 * behind the user's back.
 */
import type { BackgroundEnv } from '../shared/adapters/types.js';

export const CONTENT_FILES = ['content.js'];

export async function injectContent(env: BackgroundEnv, tabId: number): Promise<boolean> {
  const results = await env.scripting.executeScript({
    tabId,
    allFrames: true,
    files: CONTENT_FILES,
  });
  const failures = results.filter((r) => !r.ok);
  for (const failure of failures) {
    console.warn(`jobfill: injection failed in frame ${failure.frameId}: ${failure.error ?? '?'}`);
  }
  return results.some((r) => r.ok);
}

/** Auto-run bundle: bootstraps in affordance mode (corner chip), not full-bar takeover. */
export const AUTO_CONTENT_FILES = ['content-auto.js'];
const AUTO_SCRIPT_ID = 'jobfill-auto-run';

/**
 * Reconciles the persistent content-script registration against granted host permissions
 * (SPEC §8.4.4 / §8.5): granted origins auto-run the affordance bundle. Idempotent by
 * design — called at every background wake (Android kills the event page aggressively) and
 * on every permission change; `persistAcrossSessions` keeps registrations alive across
 * browser restarts even when the event page never woke.
 */
export async function syncAutoRunRegistration(env: BackgroundEnv): Promise<void> {
  if (!env.permissions) return; // harness/demo env — nothing to reconcile
  const { origins } = await env.permissions.getAll();
  const registered = await env.scripting.getRegisteredContentScripts();
  const existing = registered.find((s) => s.id === AUTO_SCRIPT_ID);

  if (origins.length === 0) {
    if (existing) await env.scripting.unregisterContentScripts([AUTO_SCRIPT_ID]);
    return;
  }
  const wanted = [...origins].sort();
  if (existing && wanted.join('\n') === [...existing.matches].sort().join('\n')) return;
  if (existing) await env.scripting.unregisterContentScripts([AUTO_SCRIPT_ID]);
  await env.scripting.registerContentScripts([
    {
      id: AUTO_SCRIPT_ID,
      matches: wanted,
      js: AUTO_CONTENT_FILES,
      allFrames: true,
      runAt: 'document_idle',
      persistAcrossSessions: true,
    },
  ]);
}

export function registerInvocations(env: BackgroundEnv): void {
  env.runtime.onCommand((command, tabId) => {
    if (tabId === undefined) return;
    if (command === 'open-palette') void injectContent(env, tabId);
  });
  // Dead while default_popup is set (Firefox never fires action.onClicked then); kept so
  // removing the popup can't silently orphan the toolbar button.
  env.runtime.onActionClicked((tabId) => void injectContent(env, tabId));

  // Auto-run bookkeeping: popup grants/revokes site permission; we mirror it into the
  // persistent registration. The wake-time sync doubles as recovery after a process kill.
  // Serialized: two rapid permission events must not interleave their read-then-write
  // reconciles (the later, correct registration could be clobbered by the earlier one).
  let syncChain = Promise.resolve();
  const queueSync = () => {
    syncChain = syncChain.then(
      () => syncAutoRunRegistration(env),
      () => syncAutoRunRegistration(env),
    );
  };
  env.permissions?.onAdded(queueSync);
  env.permissions?.onRemoved(queueSync);
  queueSync();
}
