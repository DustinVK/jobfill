// @vitest-environment jsdom
/**
 * Popup behavior (found in the first real-extension manual test): with default_popup set,
 * the popup IS the toolbar/Alt+Shift+J invocation path, so it must actually inject —
 * the Rung-0 placeholder silently did nothing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { h } from 'preact';
import { App, type PopupEnv } from '../../src/popup/App.js';

function makeEnv(overrides: Partial<PopupEnv> = {}): PopupEnv & {
  fillPage: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  openOptions: ReturnType<typeof vi.fn>;
} {
  return {
    getActiveTab: async () => ({ id: 7, url: 'https://jobs.example.com/apply' }),
    fillPage: vi.fn(async () => true),
    openOptions: vi.fn(async () => undefined),
    close: vi.fn(),
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
});
