/** All overlay styles, inlined into the closed shadow root (SPEC §7.9 — no external fetches). */

export const OVERLAY_STYLES = `
  .jf-bar[hidden] { display: none; } /* author display:flex would beat the UA [hidden] rule */
  .jf-bar {
    position: fixed;
    left: 16px;
    top: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px;
    border-radius: 12px;
    background: #1f2a37;
    border: 1px solid #33465c;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    z-index: 2;
    width: 200px;
    min-width: 150px;
    max-width: min(92vw, 760px);
    min-height: 64px;
    max-height: 92vh;
    resize: both;
    overflow: hidden;
  }
  .jf-bar-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .jf-bar-body {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    align-content: flex-start;
    /* If the user drags the bar SHORTER than its content, the body scrolls — controls
       must never become unreachable. The header row stays pinned. */
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
  }
  .jf-bar-body > .jf-btn { flex: 1 1 auto; }
  .jf-drag {
    cursor: grab;
    color: #9bb0c3;
    user-select: none;
    padding: 2px 4px;
    touch-action: none;
  }
  .jf-drag:active { cursor: grabbing; }
  .jf-btn[aria-pressed='false'] { opacity: 0.6; }
  .jf-version-select {
    font: inherit;
    font-size: 12px;
    flex: 1 1 100%;
    min-width: 0;
    padding: 4px 6px;
    border-radius: 8px;
    border: 1px solid #33465c;
    background: #131a21;
    color: #9bb0c3;
    text-overflow: ellipsis;
  }
  .jf-btn {
    font: inherit;
    padding: 6px 12px;
    border-radius: 8px;
    border: 1px solid #33465c;
    background: #2a3a4d;
    color: #e7edf3;
    cursor: pointer;
  }
  .jf-btn:hover { background: #33465c; }
  .jf-btn:focus-visible { outline: 2px solid #7dd3a0; outline-offset: 1px; }
  .jf-btn-primary { background: #17795e; border-color: #17795e; color: #fff; }
  .jf-btn-primary:hover { background: #1d9271; }
  .jf-btn:disabled { opacity: 0.45; cursor: default; }
  .jf-btn-quiet { background: transparent; border-color: transparent; color: #9bb0c3; }

  .jf-badge {
    position: absolute;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2px solid #10231b;
    background: #7dd3a0;
    cursor: pointer;
    z-index: 1;
    padding: 0;
  }
  .jf-badge.jf-suggest { background: #e8b04b; }
  .jf-badge.jf-manual { background: transparent; border-color: #9bb0c3; }
  .jf-badge.jf-sensitive { background: #b86ee0; }
  .jf-badge.jf-filled { background: #7dd3a0; box-shadow: 0 0 0 3px rgba(125, 211, 160, 0.35); }
  .jf-badge.jf-unverified { background: #e8804b; }
  .jf-badge:focus-visible { outline: 2px solid #fff; }

  .jf-popover {
    position: absolute;
    z-index: 3;
    width: min(420px, 92vw);
    background: #1f2a37;
    border: 1px solid #33465c;
    border-radius: 12px;
    box-shadow: 0 10px 36px rgba(0, 0, 0, 0.45);
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .jf-popover-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-size: 12px;
    color: #9bb0c3;
  }
  .jf-popover-key { font-weight: 600; color: #e7edf3; }
  .jf-conf { margin-left: auto; }
  .jf-preview {
    font: inherit;
    width: 100%;
    min-height: 40px;
    max-height: 220px;
    resize: vertical;
    padding: 8px;
    border-radius: 8px;
    border: 1px solid #33465c;
    background: #131a21;
    color: #e7edf3;
    box-sizing: border-box;
  }
  .jf-hint { font-size: 11px; color: #9bb0c3; }
  .jf-warn { color: #e8b04b; font-size: 12px; }
  .jf-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .jf-search {
    font: inherit;
    flex: 1;
    padding: 6px 8px;
    border-radius: 8px;
    border: 1px solid #33465c;
    background: #131a21;
    color: #e7edf3;
  }
  .jf-options { display: flex; flex-direction: column; gap: 2px; max-height: 180px; overflow: auto; }
  .jf-option {
    text-align: left;
    font: inherit;
    padding: 6px 8px;
    border-radius: 6px;
    border: none;
    background: transparent;
    color: #e7edf3;
    cursor: pointer;
    display: flex;
    gap: 8px;
    align-items: baseline;
  }
  .jf-option:hover, .jf-option.jf-active { background: #2a3a4d; }
  .jf-option .jf-option-label { color: #9bb0c3; font-size: 12px; flex-shrink: 0; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .jf-option .jf-option-value { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .jf-lock { font-size: 11px; }

  .jf-palette {
    position: fixed;
    left: 50%;
    top: 12vh;
    transform: translateX(-50%);
    width: min(560px, 94vw);
    z-index: 4;
    background: #1f2a37;
    border: 1px solid #33465c;
    border-radius: 12px;
    box-shadow: 0 14px 48px rgba(0, 0, 0, 0.5);
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .jf-palette .jf-search { width: 100%; box-sizing: border-box; font-size: 15px; padding: 9px 10px; }
  .jf-palette-target { font-size: 11px; color: #9bb0c3; }
  .jf-cats { display: flex; gap: 4px; flex-wrap: wrap; }
  .jf-group {
    /* overflow:hidden (ellipsis) zeroes the flex auto-min-size — without flex-shrink:0 the
       over-full column squeezes headings to their padding. */
    flex-shrink: 0;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #7fd08f;
    padding: 8px 8px 2px;
    border-top: 1px solid #2a3a4d;
    margin-top: 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .jf-group:first-child { border-top: none; margin-top: 0; padding-top: 2px; }
  .jf-cat {
    font: inherit;
    font-size: 11px;
    padding: 2px 9px;
    border-radius: 999px;
    border: 1px solid #33465c;
    background: transparent;
    color: #9bb0c3;
    cursor: pointer;
  }
  .jf-cat:hover { background: #2a3a4d; }
  .jf-cat-on { background: #17795e; border-color: #17795e; color: #fff; }

  .jf-toast {
    position: fixed;
    left: 50%;
    bottom: 76px;
    transform: translateX(-50%);
    background: #2a3a4d;
    color: #e7edf3;
    border: 1px solid #33465c;
    padding: 8px 14px;
    border-radius: 8px;
    z-index: 5;
    box-shadow: 0 6px 20px rgba(0,0,0,0.4);
  }
`;
