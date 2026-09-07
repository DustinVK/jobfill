// @vitest-environment jsdom
/**
 * Rung 5 (SPEC §8.5): the overlay tracks the VISUAL viewport (on-screen keyboard / dynamic
 * URL bar) via CSS vars, and grows to touch targets on coarse pointers. The e2e sets the
 * vars/class directly (it can't drive a real keyboard); this exercises the JS wiring —
 * `updateViewportVars` and the visualViewport listeners in OverlayUI — so a typo'd var name
 * or an unwired listener fails here instead of only on a real device.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MemoryBlobStore,
  MemoryChannel,
  createMemoryRuntime,
  createMemoryScripting,
  createMemoryStorage,
} from '../../src/shared/adapters/memory.js';
import type { BackgroundEnv } from '../../src/shared/adapters/types.js';
import { createRouter } from '../../src/background/router.js';
import { bootstrap } from '../../src/content/bootstrap.js';
import { createEmptyVault } from '../../src/shared/vault.js';
import { mergeAdd } from '../../src/shared/interchange.js';
import type { InterchangeDocument } from '../../src/shared/types.js';
import sampleImport from '../../ai/examples/sample-import.json';

/** Minimal stand-in for window.visualViewport with a driveable resize. */
class FakeVisualViewport extends EventTarget {
  height = 800;
  offsetTop = 0;
  resizeTo(height: number, offsetTop = 0): void {
    this.height = height;
    this.offsetTop = offsetTop;
    this.dispatchEvent(new Event('resize'));
  }
}

async function bootstrapOverlay() {
  const channel = new MemoryChannel({ tabId: 1, frameId: 0, origin: 'https://jobs.example.com' });
  const storage = createMemoryStorage();
  const seeded = mergeAdd(createEmptyVault(), sampleImport as unknown as InterchangeDocument);
  await storage.local.set('vault', { v: 1, enc: 'none', data: seeded.vault });
  const env: BackgroundEnv = {
    storage,
    blobs: new MemoryBlobStore(),
    server: channel,
    scripting: createMemoryScripting(),
    runtime: createMemoryRuntime(),
  };
  env.server.serve(createRouter({ env }));
  const session = bootstrap({ transport: channel, scope: {} });
  return session;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('overlay visual-viewport tracking (SPEC §8.5)', () => {
  it('seeds --jf-vvh/--jf-vvt from visualViewport and follows a resize (keyboard)', async () => {
    const vv = new FakeVisualViewport();
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
    const session = await bootstrapOverlay();
    const layer = session.overlay.shadow.querySelector<HTMLElement>('.jf-layer')!;

    // Seeded at construction.
    expect(layer.style.getPropertyValue('--jf-vvh')).toBe('800px');
    expect(layer.style.getPropertyValue('--jf-vvt')).toBe('0px');

    // Keyboard opens: visual viewport shrinks and shifts down.
    vv.resizeTo(430, 40);
    expect(layer.style.getPropertyValue('--jf-vvh')).toBe('430px');
    expect(layer.style.getPropertyValue('--jf-vvt')).toBe('40px');

    session.teardown();
    // After teardown the listener is gone — a further resize must not throw or update.
    vv.resizeTo(700, 0);
    // The layer is detached; nothing to assert beyond "no throw".
  });

  it('keeps the palette-bound field visible when the keyboard resizes the viewport', async () => {
    const vv = new FakeVisualViewport();
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
    document.body.innerHTML = `<label for="city">City</label><input id="city">`;
    const session = await bootstrapOverlay();
    await session.session.refresh(document);

    const input = document.getElementById('city') as HTMLInputElement;
    const scrollSpy = vi.fn();
    input.scrollIntoView = scrollSpy;
    input.focus();
    session.ui.openPalette();

    vv.resizeTo(400, 0); // keyboard appears
    expect(scrollSpy).toHaveBeenCalled();

    session.teardown();
  });

  it('falls back to innerHeight when visualViewport is absent (desktop/older engines)', async () => {
    Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true });
    const session = await bootstrapOverlay();
    const layer = session.overlay.shadow.querySelector<HTMLElement>('.jf-layer')!;
    expect(layer.style.getPropertyValue('--jf-vvh')).toBe('900px');
    session.teardown();
  });
});
