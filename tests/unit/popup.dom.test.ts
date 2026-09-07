// @vitest-environment jsdom
/**
 * Popup behavior (found in the first real-extension manual test): with default_popup set,
 * the popup IS the toolbar/Alt+Shift+J invocation path, so it must actually inject —
 * the Rung-0 placeholder silently did nothing.
 *
 * Rung 5 (Android): the popup is the ONLY invocation + permission surface on Android, so
 * these tests also pin the gesture rule — executeScript/permissions.request start
 * SYNCHRONOUSLY inside the click dispatch, before any await can drop the gesture token.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { h } from 'preact';
import { App, type PopupEnv } from '../../src/popup/App.js';

function makeEnv(overrides: Partial<PopupEnv> = {}): PopupEnv & {
  fillPage: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  openOptions: ReturnType<typeof vi.fn>;
  requestSitePermission: ReturnType<typeof vi.fn>;
  removeSitePermission: ReturnType<typeof vi.fn>;
  showAffordance: ReturnType<typeof vi.fn>;
} {
  return {
    getActiveTab: async () => ({ id: 7, url: 'https://jobs.example.com/apply' }),
    fillPage: vi.fn(async () => true),
    hasSitePermission: async () => false,
    requestSitePermission: vi.fn(async () => true),
    removeSitePermission: vi.fn(async () => true),
    showAffordance: vi.fn(async () => undefined),
    openOptions: vi.fn(async () => undefined),
    close: vi.fn(),
    isTouch: false,
    ...overrides,
  } as never;
}

/** Preact flushes effects via setTimeout(~100ms) when jsdom has no rAF — wait it out. */
async function settle(condition: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error('settle timeout');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function mount(env: PopupEnv): Promise<HTMLElement> {
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app')!;
  render(h(App, { env }), root);
  // getActiveTab resolved ⇒ either the button enabled or the not-injectable note rendered
  await settle(
    () =>
      !root.querySelector<HTMLButtonElement>('[data-testid="fill-page"]')!.disabled ||
      root.querySelector('[data-testid="not-injectable"]') !== null,
  );
  return root;
}

const click = (root: HTMLElement, testid: string) => {
  const btn = root.querySelector<HTMLButtonElement>(`[data-testid="${testid}"]`);
  if (!btn) throw new Error(`no ${testid}`);
  btn.click();
};

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('popup', () => {
  it('Fill this page injects into the active tab and closes the popup', async () => {
    const env = makeEnv();
    const root = await mount(env);
    const fillBtn = root.querySelector<HTMLButtonElement>('[data-testid="fill-page"]');
    expect(fillBtn?.disabled).toBe(false);
    click(root, 'fill-page');
    await settle(() => env.close.mock.calls.length > 0);
    expect(env.fillPage).toHaveBeenCalledWith(7);
    expect(env.close).toHaveBeenCalled();
  });

  it('starts the injection SYNCHRONOUSLY inside the click dispatch (gesture rule)', async () => {
    const env = makeEnv();
    const root = await mount(env);
    // dispatchEvent is synchronous: if fillPage was recorded by the time click() returns,
    // no await preceded it in the handler.
    click(root, 'fill-page');
    expect(env.fillPage).toHaveBeenCalledTimes(1);
  });

  it('a refused injection shows an error instead of closing', async () => {
    const env = makeEnv({ fillPage: vi.fn(async () => false) as never });
    const root = await mount(env);
    click(root, 'fill-page');
    await settle(() => root.querySelector('[data-testid="popup-error"]') !== null);
    expect(env.close).not.toHaveBeenCalled();
    expect(root.querySelector('[data-testid="popup-error"]')?.textContent).toContain('refused');
  });

  it('non-injectable pages (about:, extension pages) disable the button and say why', async () => {
    const env = makeEnv({ getActiveTab: async () => ({ id: 3, url: 'about:newtab' }) });
    const root = await mount(env);
    expect(root.querySelector<HTMLButtonElement>('[data-testid="fill-page"]')?.disabled).toBe(true);
    expect(root.querySelector('[data-testid="not-injectable"]')).not.toBeNull();
    expect(env.fillPage).not.toHaveBeenCalled();
  });

  it('Open options opens the options page', async () => {
    const env = makeEnv();
    const root = await mount(env);
    click(root, 'open-options');
    await settle(() => (env.openOptions as ReturnType<typeof vi.fn>).mock.calls.length > 0);
    expect(env.openOptions).toHaveBeenCalled();
  });

  describe('per-site auto-run (the only permission-acquiring surface)', () => {
    /** Stateful permission backing: request/remove flip what hasSitePermission reports. */
    function statefulEnv(startGranted: boolean, overrides: Partial<PopupEnv> = {}) {
      let granted = startGranted;
      return makeEnv({
        hasSitePermission: async () => granted,
        requestSitePermission: vi.fn(async () => {
          granted = true;
          return true;
        }),
        removeSitePermission: vi.fn(async () => {
          granted = false;
          return true;
        }),
        ...overrides,
      });
    }

    it('requests the host permission SYNCHRONOUSLY in the gesture and reflects the grant', async () => {
      const env = statefulEnv(false);
      const root = await mount(env);
      await settle(() => root.querySelector('[data-testid="auto-run"]') !== null);
      expect(root.querySelector('[data-testid="auto-run"]')?.textContent).toContain(
        'Always run on jobs.example.com',
      );
      click(root, 'auto-run');
      // Synchronous within the dispatch — same gesture rule as injection.
      expect(env.requestSitePermission).toHaveBeenCalledTimes(1);
      expect(env.requestSitePermission).toHaveBeenCalledWith('https://jobs.example.com/apply');
      await settle(
        () =>
          root.querySelector('[data-testid="auto-run"]')?.textContent?.includes('Auto-runs') ??
          false,
      );
      // Fresh grant shows the chip on the already-open page without waiting for a reload.
      expect(env.showAffordance).toHaveBeenCalledWith(7);
    });

    it('a denied prompt leaves auto-run off', async () => {
      const env = makeEnv({
        hasSitePermission: async () => false,
        requestSitePermission: vi.fn(async () => false) as never,
      });
      const root = await mount(env);
      await settle(() => root.querySelector('[data-testid="auto-run"]') !== null);
      click(root, 'auto-run');
      await settle(
        () => !(root.querySelector('[data-testid="auto-run"]') as HTMLButtonElement).disabled,
      );
      expect(root.querySelector('[data-testid="auto-run"]')?.textContent).toContain('Always run');
      expect(env.showAffordance).not.toHaveBeenCalled();
    });

    it('an already-granted site offers revoke and removes the permission', async () => {
      const env = statefulEnv(true);
      const root = await mount(env);
      await settle(
        () =>
          root.querySelector('[data-testid="auto-run"]')?.textContent?.includes('Auto-runs') ??
          false,
      );
      click(root, 'auto-run');
      expect(env.removeSitePermission).toHaveBeenCalledWith('https://jobs.example.com/apply');
      await settle(
        () =>
          root.querySelector('[data-testid="auto-run"]')?.textContent?.includes('Always run') ??
          false,
      );
    });

    it('a broad grant that a per-site remove cannot revoke keeps the toggle honest', async () => {
      // <all_urls> covers the origin: contains() stays true, remove() changes nothing.
      const env = makeEnv({
        hasSitePermission: async () => true,
        removeSitePermission: vi.fn(async () => false) as never,
      });
      const root = await mount(env);
      await settle(
        () =>
          root.querySelector('[data-testid="auto-run"]')?.textContent?.includes('Auto-runs') ??
          false,
      );
      click(root, 'auto-run');
      await settle(
        () => !(root.querySelector('[data-testid="auto-run"]') as HTMLButtonElement).disabled,
      );
      // Still granted (via the broad grant) → the button must NOT claim it's off.
      expect(root.querySelector('[data-testid="auto-run"]')?.textContent).toContain('Auto-runs');
    });

    it('never offers site permission on non-http(s) pages', async () => {
      const env = makeEnv({ getActiveTab: async () => ({ id: 4, url: 'file:///tmp/form.html' }) });
      const root = await mount(env);
      expect(root.querySelector('[data-testid="auto-run"]')).toBeNull();
    });
  });

  it('hides the keyboard-shortcut tip on touch devices', async () => {
    const desktop = await mount(makeEnv());
    expect(desktop.querySelector('[data-testid="kbd-tip"]')).not.toBeNull();
    const touch = await mount(makeEnv({ isTouch: true }));
    expect(touch.querySelector('[data-testid="kbd-tip"]')).toBeNull();
  });
});
