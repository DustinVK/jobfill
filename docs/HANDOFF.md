# jobfill — session handoff (2026-09-06)

Snapshot of the work done in this stretch, the current repo state, and how to pick each
thread back up. Local-only Firefox (MV3) extension; all the project rules in `CLAUDE.md`
still apply (no push/sign/publish, `npm run verify` is the gate, `Resumes/` never in git).

## What shipped this session

All on `main`, `npm run verify` green throughout (**341 unit + 52 e2e**), nothing added to
`dist/` beyond the real extension bundle.

1. **Search-menu grouping.** The palette's category tabs group Work entries by position under
   a dated heading (`TITLE — COMPANY · MM/YYYY–…`); rows carry short labels under the heading.
   Generic plumbing (`groupKey`/`group`/`shortLabel` on `SearchResult`) — Education/Projects
   can adopt it later. Commit `735e21e`.
2. **Interactive demo (`demo/`, gitignored dev artifact).** The real options app + real
   content bundle over in-memory adapters, vault seeded from `ai/examples/sample-import.json`
   (fictional "Maya Okafor", labeled SAMPLE). Landing page → options view + two form variants
   (plain / React) with a page-level touch toolbar (Invoke / Palette / Fill all / Undo).
   Built by `npm run demo:build` (folded into `npm run build`), `demo:watch` for live rebuild.
   Commits `c18aabb`, `bddfa89`.
3. **Tailnet serving.** `npm run demo:tailnet` builds + serves `demo/` (and
   `docs/screenshots/` under `/shots/`) via **Tailscale Serve** (HTTPS, tailnet-only, never
   funnel; teardown `tailscale serve reset`). `scripts/serve-demo.mjs`.
4. **Firefox for Android support (Rung 5, SPEC §8.5).** One extension, feature-detected, no
   fork, no desktop regression. Manifest `gecko_android`; popup as full-window primary
   trigger with synchronous-gesture inject + per-site `permissions.request`; auto-run on
   granted origins via `registerContentScripts` in affordance-mode (corner chip); touch
   overlay (`visualViewport` CSS vars, ≥44px targets, keyboard-safe palette); background
   kill-resilience audited. Commits `7a887f6`, `537c229`, `8b11ee0`, `2c0f72d`, `37bdfdc`;
   review fixes `ada95c5`.
5. **On-device testing setup + real-device fixes.** adb over Tailscale wireless debugging;
   `npm run run:android` + preflight (`scripts/run-android.mjs`); `docs/ANDROID_TESTING.md`.
   The phone test surfaced three issues, each now fixed with tests (commit `bf5232d`):
   - Empty vault was a silent no-op → the bar now shows "No data yet — import your résumé"
     + an **Open options** button (new narrow `options.open` background message).
   - Palette "Copied to clipboard" lied on the Pixel 9a → copy is awaited and honest, with a
     hardened Android `execCommand` fallback (explicit range-select + focus).
   - No way to dismiss the palette on touch (no Esc) → added an ✕ close button.

## On-device verification status

Ran on a real Pixel 9a (Firefox release) over Tailscale. **Confirmed working on device:**
page load, full-window popup, "Fill this page" injection, auto-run chip after granting a
site, and (after the fixes) the empty-vault prompt, honest clipboard, and palette close.
The three findings above were the only breakages; all fixed and re-verified on device.

## Current repo state

- Branch `main`, working tree clean (after this doc's commit).
- `npm run verify` green. Test harness technique unchanged (Playwright can't load a real
  extension; harness pages inject the built bundle over mock adapters — see
  `OVERNIGHT_PLAN.md` §7). Real `browser.*` seams + on-device behavior are covered by the
  manual Android pass, not Playwright.
- Nothing is left running after teardown (see below). No background servers, no adb link.

## How to resume each thread

- **Show the demo on the phone:** `npm run demo:tailnet` → open the printed
  `https://macbook-air.tailcff69d.ts.net/` on the phone. Teardown: `tailscale serve reset`.
- **On-device extension testing:** follow `docs/ANDROID_TESTING.md` (pair → connect → set
  `JOBFILL_ANDROID_DEVICE` → `npm run run:android`). Serve the clean form in
  `docs/examples/android-test-form.html` for the real extension to act on. The mobile-driven
  dev loop is documented there.
- **Continue Rung 5 grouping for other categories:** `SearchResult` already carries
  `groupKey`/`group`/`shortLabel`; wire Education/Projects in `src/shared/search.ts` the same
  way Work does, add fixtures in `tests/unit/search.test.ts`.

## Known pending / not done

- **Encryption at rest** is still the post-v1 milestone (`settings.encryption.enabled` stored
  but not honored; DataService uses PlainCodec). Unchanged this session.
- **Real per-origin site memory** (`map…` corrections) is still an in-memory stub (SPEC M4).
- Grouping is Work-only so far (see resume note above).
- The Parked list in `PROGRESS.md` is unchanged.

## Environment facts worth keeping

- Tailnet `dustinvk.github` (GitHub-login — the phone browser must be signed into
  login.tailscale.com with GitHub). Mac `macbook-air` = `100.91.29.91`,
  MagicDNS `macbook-air.tailcff69d.ts.net`. Phone `pixel-9a` = `100.92.139.79`. Tailscale is
  CLI-only (standalone `tailscaled`, no GUI). Serve/HTTPS is enabled on the tailnet.
- Wireless debugging on the phone needs Wi-Fi to *enable*; if cellular-only, bootstrap once
  over USB (`adb tcpip 5555`).
