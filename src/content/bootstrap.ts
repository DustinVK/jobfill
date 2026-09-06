/**
 * Content-bundle bootstrap: idempotent activation, overlay mount.
 *
 * Injection can happen many times on one page (SPEC §8.4: re-invoke = re-scan + reopen).
 * Each `scripting.executeScript` runs the bundle in a fresh lexical scope but the *same*
 * content-script global, so the guard lives on `globalThis`, not in a module variable.
 */
import type { MessageTransport } from '../shared/adapters/types.js';
import { ProtocolClient } from '../shared/messages.js';
import { createOverlayRoot, overlayLayer, type OverlayRoot } from './overlay/root.js';

const GUARD = '__jobfillSession';

export interface ContentSession {
  client: ProtocolClient;
  overlay: OverlayRoot;
  /** Re-invoked while already active. TODO(rung 2): trigger a re-scan; today it only re-shows. */
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
}

export function bootstrap(options: BootstrapOptions): ContentSession {
  const scope = options.scope ?? globalThis;
  const already = existingSession(scope);
  if (already) {
    already.activate();
    return already;
  }

  const doc = options.doc ?? document;
  const client = new ProtocolClient(options.transport);
  const overlay = createOverlayRoot(doc);
  const layer = overlayLayer(overlay.shadow);

  const chip = doc.createElement('button');
  chip.type = 'button';
  chip.className = 'jf-chip';
  chip.setAttribute('data-jobfill-chip', '');
  const dot = doc.createElement('span');
  dot.className = 'jf-chip-dot';
  const label = doc.createElement('span');
  label.textContent = 'jobfill';
  chip.append(dot, label);
  layer.append(chip);

  const session: ContentSession = {
    client,
    overlay,
    activate() {
      chip.hidden = false;
    },
    teardown() {
      overlay.destroy();
      delete (scope as GuardedGlobal)[GUARD];
    },
  };

  (scope as GuardedGlobal)[GUARD] = session;
  return session;
}
