/**
 * Overlay host: one element on the page, one CLOSED shadow root (SPEC §7.9).
 * The page cannot restyle or read it; the content script holds the only reference.
 * All styles are inlined here — no stylesheet fetches, ever.
 */

export const OVERLAY_HOST_ID = 'jobfill-overlay-host';

export interface OverlayRoot {
  host: HTMLElement;
  shadow: ShadowRoot;
  destroy(): void;
}

const BASE_STYLES = `
  :host { all: initial; }
  .jf-layer {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 2147483646;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    font-size: 13px;
    line-height: 1.4;
    color: #e7edf3;
  }
  .jf-layer > * { pointer-events: auto; }
  .jf-chip {
    position: fixed;
    right: 16px;
    bottom: 16px;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: 999px;
    background: #1f2a37;
    border: 1px solid #33465c;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
    cursor: pointer;
    user-select: none;
  }
  .jf-chip:focus-visible { outline: 2px solid #7dd3a0; outline-offset: 2px; }
  .jf-chip-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #7dd3a0;
  }
`;

/**
 * Creates a new overlay root (idempotence lives in bootstrap.ts, which calls this once per
 * page). `document.documentElement` is the mount point so the overlay survives pages that
 * replace `document.body`.
 */
export function createOverlayRoot(doc: Document = document): OverlayRoot {
  const host = doc.createElement('div');
  host.id = OVERLAY_HOST_ID;
  host.setAttribute('data-jobfill', 'overlay');
  // The host itself must not inherit page layout rules.
  host.style.setProperty('all', 'initial');
  host.style.setProperty('position', 'fixed');
  host.style.setProperty('z-index', '2147483646');

  const shadow = host.attachShadow({ mode: 'closed' });
  const style = doc.createElement('style');
  style.textContent = BASE_STYLES;
  shadow.append(style);

  const layer = doc.createElement('div');
  layer.className = 'jf-layer';
  shadow.append(layer);

  doc.documentElement.append(host);

  return {
    host,
    shadow,
    destroy() {
      host.remove();
    },
  };
}

export function overlayLayer(shadow: ShadowRoot): HTMLElement {
  const layer = shadow.querySelector<HTMLElement>('.jf-layer');
  if (!layer) throw new Error('jobfill: overlay layer missing');
  return layer;
}
