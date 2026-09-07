/**
 * Content-bundle bootstrap: idempotent activation, session + overlay wiring.
 *
 * Injection can happen many times on one page (SPEC §8.4: re-invoke = re-scan + reopen).
 * Each `scripting.executeScript` runs the bundle in a fresh lexical scope but the *same*
 * content-script global, so the guard lives on `globalThis`, not in a module variable.
 */
import type { MessageTransport } from '../shared/adapters/types.js';
import { ProtocolClient } from '../shared/messages.js';
import { createOverlayRoot, overlayLayer, type OverlayRoot } from './overlay/root.js';
import { OverlayUI } from './overlay/ui.js';
import { FillSession } from './session.js';
import { observeAndRescan, type ScanScheduler } from './scan.js';

const GUARD = '__jobfillSession';

export interface ContentSession {
  client: ProtocolClient;
  overlay: OverlayRoot;
  session: FillSession;
  ui: OverlayUI;
  /** Re-invoked while already active: re-scan and re-show. */
  activate(): void;
  teardown(): void;
}

interface GuardedGlobal {
  [GUARD]?: ContentSession;
}

export function existingSession(scope: object = globalThis): ContentSession | undefined {
  return (scope as GuardedGlobal)[GUARD];
}

export interface BootstrapOptions {
  transport: MessageTransport;
  doc?: Document;
  scope?: object;
  /**
   * Affordance mode (SPEC §8.4.4/§8.5): injected automatically on a granted origin, so no
   * takeover — render a quiet corner chip; scanning + fill bar start on tap (or on a later
   * explicit invocation, which upgrades the session via activate()).
   */
  autoRun?: boolean;
}

export function bootstrap(options: BootstrapOptions): ContentSession {
  const scope = options.scope ?? globalThis;
  const already = existingSession(scope);
  if (already) {
    // An explicit re-invoke upgrades a chip-only session to the full bar; a duplicate
    // auto-injection (SPA soft navigation) leaves a dormant chip dormant.
    if (!options.autoRun) already.activate();
    return already;
  }

  const doc = options.doc ?? document;
  const client = new ProtocolClient(options.transport);
  const overlay = createOverlayRoot(doc);
  const layer = overlayLayer(overlay.shadow);
  const session = new FillSession(client);

  const schedulerRef: { current: ScanScheduler | undefined } = { current: undefined };

  const ui = new OverlayUI({
    layer,
    shadow: overlay.shadow,
    session,
    client,
    onClose: () => contentSession.teardown(),
  });

  let chip: HTMLButtonElement | undefined;
  const dismissChip = () => {
    chip?.remove();
    chip = undefined;
  };

  /**
   * Scan + show, failure-safe. The affordance chip (if any) is dismissed only AFTER the
   * first scan succeeds — a rejected `fill.context` (dead background on Android) must not
   * strand the user with neither chip nor bar (rung-5 review P1). On failure the chip is
   * re-armed so the tap is retryable.
   */
  const activate = (): Promise<void> => {
    if (chip) chip.disabled = true; // debounce double-taps while the scan is in flight
    return session.refresh(doc).then(
      () => {
        dismissChip();
        schedulerRef.current ??= observeAndRescan(doc, () => void session.refresh(doc));
      },
      (err: unknown) => {
        if (chip) chip.disabled = false;
        ui.notify('jobfill couldn’t start on this page — tap to retry');
        throw err;
      },
    );
  };

  const contentSession: ContentSession = {
    client,
    overlay,
    session,
    ui,
    activate() {
      void activate().catch(() => undefined);
    },
    teardown() {
      dismissChip();
      schedulerRef.current?.stop();
      ui.destroy();
      overlay.destroy();
      delete (scope as GuardedGlobal)[GUARD];
    },
  };

  (scope as GuardedGlobal)[GUARD] = contentSession;

  if (options.autoRun) {
    // Quiet corner chip: no scan, no bar, no observers until the user asks. A tap is not a
    // privileged gesture — the chip only spends permission that is already granted.
    chip = doc.createElement('button');
    chip.type = 'button';
    chip.className = 'jf-chip';
    chip.setAttribute('data-jf', 'chip');
    const dot = doc.createElement('span');
    dot.className = 'jf-chip-dot';
    chip.append(dot, doc.createTextNode('jobfill'));
    chip.addEventListener('click', () => contentSession.activate());
    layer.append(chip);
  } else {
    contentSession.activate();
  }

  return contentSession;
}
