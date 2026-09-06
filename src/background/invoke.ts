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

export function registerInvocations(env: BackgroundEnv): void {
  env.runtime.onCommand((command, tabId) => {
    if (tabId === undefined) return;
    if (command === 'open-palette') void injectContent(env, tabId);
  });
  // Dead while default_popup is set (Firefox never fires action.onClicked then); kept so
  // removing the popup can't silently orphan the toolbar button.
  env.runtime.onActionClicked((tabId) => void injectContent(env, tabId));
}
