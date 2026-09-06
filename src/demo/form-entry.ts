/**
 * Demo form entrypoint (built to demo/, never shipped, no `browser.*`).
 *
 * Same technique as the e2e harness: the real content bundle over the in-memory transport
 * with an in-process background router, but the vault is the localStorage-backed demo vault
 * (see seed.ts) so edits made in the demo options view show up here after a refresh.
 *
 * Phones have no keyboard shortcuts, so a page-level touch toolbar drives the overlay:
 * Invoke, Palette (the search menu), Fill all, Undo. The toolbar lives in the PAGE, outside
 * the extension overlay — it stands in for the toolbar button / Alt+Shift+J, it is not part
 * of the product UI.
 */
import { createRouter } from '../background/router.js';
import {
  MemoryBlobStore,
  MemoryChannel,
  createMemoryRuntime,
  createMemoryScripting,
} from '../shared/adapters/memory.js';
import { createWebStorage } from '../shared/adapters/web-storage.js';
import type { BackgroundEnv } from '../shared/adapters/types.js';
import { bootstrap, type ContentSession } from '../content/bootstrap.js';
import { seedDemoVault } from './seed.js';

async function main(): Promise<void> {
  const channel = new MemoryChannel({ tabId: 1, frameId: 0, origin: location.origin });
  const storage = createWebStorage();
  const blobs = new MemoryBlobStore();
  await seedDemoVault(storage, blobs);

  const env: BackgroundEnv = {
    storage,
    blobs,
    server: channel,
    scripting: createMemoryScripting(),
    runtime: createMemoryRuntime(),
  };
  env.server.serve(createRouter({ env }));

  let session: ContentSession | undefined;

  // Remember the last real form field the user touched: tapping a toolbar button blurs it,
  // and the palette binds to the field focused at open time.
  let lastField: HTMLElement | undefined;
  document.addEventListener('focusin', (event) => {
    const t = event.target;
    if (
      t instanceof HTMLInputElement ||
      t instanceof HTMLTextAreaElement ||
      (t instanceof HTMLElement && t.isContentEditable)
    ) {
      lastField = t;
    }
  });

  const ensureSession = (): ContentSession => {
    session = bootstrap({ transport: channel });
    return session;
  };

  const clickShadow = (attr: string): void => {
    const s = ensureSession();
    s.overlay.shadow.querySelector<HTMLButtonElement>(`[data-jf="${attr}"]`)?.click();
  };

  const actions: [label: string, run: () => void][] = [
    ['Invoke', () => ensureSession().activate()],
    [
      'Palette',
      () => {
        const s = ensureSession();
        const active = document.activeElement;
        const activeIsField =
          active instanceof HTMLInputElement ||
          active instanceof HTMLTextAreaElement ||
          (active instanceof HTMLElement && active.isContentEditable);
        if (!activeIsField && lastField?.isConnected) lastField.focus();
        s.ui.openPalette();
      },
    ],
    ['Fill all', () => clickShadow('fill-all')],
    ['Undo', () => clickShadow('undo')],
  ];

  const bar = document.createElement('div');
  bar.id = 'demo-toolbar';
  bar.setAttribute(
    'style',
    'position:fixed;left:0;right:0;bottom:0;z-index:2147483646;display:flex;gap:8px;' +
      'padding:10px 12px calc(10px + env(safe-area-inset-bottom));background:#111826f2;' +
      'backdrop-filter:blur(6px);font:14px system-ui,sans-serif;',
  );
  for (const [label, run] of actions) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.setAttribute('data-demo', label.toLowerCase().replace(/\s+/g, '-'));
    btn.setAttribute(
      'style',
      'flex:1;min-height:44px;border:1px solid #3a4a63;border-radius:10px;' +
        'background:#1d2940;color:#e7edf7;font-weight:600;font-size:14px;',
    );
    // pointerdown + preventDefault: act without stealing focus from the tapped form field.
    btn.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      run();
    });
    bar.appendChild(btn);
  }
  document.body.appendChild(bar);
  // Keep the page's own bottom content reachable above the fixed toolbar.
  document.body.style.paddingBottom = '90px';
}

void main();
