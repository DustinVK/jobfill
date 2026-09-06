# Morning Report — jobfill overnight build

Session: 2026-09-06, ~00:20 → ~02:35 · 24 commits · all local, nothing pushed.

## 1. Executive summary

The extension **works end-to-end on the harness pages**: enter or import data in the options
app, invoke on a form, fill via fill-all / review / popover / palette, and attach the stored
resume PDF into both hidden-input and drop-only uploaders — all four rungs are green, each
gated by a fresh-subagent review whose P0/P1 findings were fixed before moving on, plus a
final whole-night review (its P0 — a form-wrapped listbox button that could have submitted an
application — is fixed and regression-pinned). The one thing to know: everything was proven
through the in-memory-adapter harness, so the thin real `browser.*` adapters and the
`wrappedJSObject` attach branch are the morning's manual-QA surface — the code paths are
reviewed and unit-covered, but no loaded extension ran tonight.

## 2. Rung status

| Rung | Status | Evidence |
|---|---|---|
| 0 — Scaffold | **green** | verify pipeline (typecheck → lint → 281 unit tests → build → local-only gate → web-ext lint 0 errors) · smoke e2e ×3 · commits `e0d09dd`, review fixes in `8042655` |
| 1 — Data core | **green** | export→wipe→import round-trip incl. file bytes (`data-service.test.ts`) · schema-validated sample import · options e2e ×7 (work-experience-with-2-bullet-variants reload check = DoD-1) · commits `50e675d`, `9afebdb` |
| 2 — Fill engine | **green** | 54-fixture classifier corpus w/ actual-output snapshot gate (`fixtures/report.md`) · fill-engine e2e ×14 (values land, page listeners fire, React state mirror updates, undo restores, deny-list holds, late-mount rescan, shadow fill, iframe fill, palette) · commits `c49885e`…`8c25963` |
| 3 — File attach | **green** | attach e2e ×5 (hidden-input + drop paths, page-side FileReader byte assertions, deny-listed-uploader safety, product drop path) · files-manager e2e · commits `cd07233`, `cdcab43` |
| 4 — Polish | **all six items landed** | README · `npm run demo` · palette focus trap/ARIA · import dry-run preview · combobox + listbox-button drivers (e2e ×3 incl. the submit-trap regression) · CI yaml · plus the `ai/` deliverables |

Totals: **281 unit tests, 31 e2e tests, 54 corpus fixtures, 13 harness pages** — all green at
HEAD (`npm run verify` and `npm run e2e` both exit 0).

## 3. Try it now

```sh
npm ci
npm run verify          # the whole gate
npm run e2e             # 31 Playwright/Firefox tests against the harness
npm run demo            # harness pages + options app → http://localhost:5177
npm run build && npx web-ext run --source-dir=dist    # REAL extension (untested tonight!)
```

**60-second demo** (no extension load needed): `npm run demo` →
`http://localhost:5177/options-dev.html` → Import / Export → import
`ai/examples/sample-import.json` (preview screen → Import) — then open
`http://localhost:5177/plain-form.html`, paste `dist-harness/content.harness.js` into the
console (what the e2e does), and use **Fill 9 fields**, **Review**, **Undo**, and
`Alt+Shift+Space` for the palette. `dropzone.html` demos the resume attach.

## 4. Look at these first

1. **`src/content/attach.ts` — the `wrappedJSObject`/`cloneInto` branch.** Reviewed three
   times, never executed. The header comment names the exact residual risks (File compartment
   hand-off, page-view verification, stripped page globals). If anything breaks in real
   Firefox, it's here.
2. **`src/shared/classify.ts` + `src/content/session.ts` — the sensitivity/deny enforcement
   stack.** Three reviews found real bypasses here (sensitive salary in fill-all, palette
   deny bypass, map…-promotion of deny-listed fields, a submit-capable listbox button). All
   fixed and unit/e2e-pinned, but this is the product's safety core — worth a human read.
3. **`scripts/check-local-only.mjs` + the manifest CSP** — the local-only guarantee's
   mechanical form (URL scan + network-primitive scan + `connect-src 'none'`). The rung-0
   review defeated v1 of this gate four ways; v2 catches all four, but it guards the
   product's central promise.

## 5. Manual QA needed (tonight couldn't cover)

See `docs/qa-log.md` for the full checklist. Highest value, in order:

1. `npx web-ext run` smoke: extension loads, options page works, sample import round-trips,
   invoke on `npm run demo`'s plain-form fills through the REAL messaging adapters.
2. **`wrappedJSObject` attach** on dropzone.html — the one shipped branch with zero runtime
   coverage. Check the page's FileReader readout shows `%PDF`.
3. Real-Firefox overlay behavior: closed-shadow-root scan exclusion (the scanner must not
   badge its own palette), `storage.session` isolation from content scripts.
4. One real ATS spot-check per `docs/qa-log.md` (Greenhouse or Lever posting; no submissions).

## 6. Deviations & decisions (condensed — full log in PROGRESS.md)

- **manifest CSP added** (`connect-src 'none'`, deviates from SPEC §8.2 "verbatim") — the
  browser-enforced form of the local-only promise; forced the import validator to be
  precompiled at build time (ajv's `new Function` would violate it).
- **Pure logic in `src/shared/`** (compose/search) despite SPEC §10.2 placing compose under
  background — CLAUDE.md's invariant won.
- **`vault.patch` = typed section replacements**, not a generic patch grammar.
- **Sensitivity policy**: EEO + criminalDisclosure locked-sensitive; salary default-on but
  user-unmarkable (SPEC §13 open question 3 decided); one shared `isSensitiveTarget` rule.
- **Content scripts get a narrow protocol surface** (fill.context/compose/search/quickSave/
  offered-file-only file.get) — stricter than SPEC §8.3's "redacted slice".
- **Undo snapshots survive scan generations** (element-keyed WeakMaps) — more useful than
  SPEC §7.8's per-generation death, no less safe.
- **Chrome-port base64 file transport not implemented** — wire format is Firefox
  structured-clone only.
- devDependencies added with justifications: jsdom, globals, @eslint/js, @types/node,
  react+react-dom@18 (harness only, never shipped).
- Rung order overlapped twice (implementation proceeded while a review subagent ran); all
  review findings were fixed before any DoD claim — logged honestly in PROGRESS.

## 7. Blocked & parked

**Blocked: nothing.** No stuck-protocol entries all night.

**Parked** (P2s, full list in PROGRESS.md): pin innerHTML lint-warnings to source constructs ·
eslint guards for `globalThis.browser`/`fetch` in src (dist-level gate covers shipped code) ·
an e2e that executes `dist/content.js` itself · `FileStore.pruneOrphans` wiring ·
`settings.encryption.enabled` not honored (codec ships tested; unlock flow is post-v1) ·
shared base64 helper · named matchChoice thresholds · palette ranking tiers (classification →
version prefs → recency; text-relevance only tonight) · popover-on-focus (badge-click only) ·
inline version switcher in the fill bar · fill-all cancel during slow widget waits ·
shadow-host walk optimization.

## 8. Suggested next session

1. Morning manual QA (§5) — then fix whatever the real extension surfaces.
2. Site memory persistence (SPEC M4): the in-memory stub + fingerprinting already exist;
   wire `siteMemory.get/record` through the protocol and vault.
3. Popup: per-site enable/revoke (`permissions.request` + registered scripts), cross-origin
   iframe flow (SPEC §3.8–3.9).
4. Version composer UI (SPEC M5) — compose/variantPrefs plumbing is done and tested.
5. Workday seed profile + the profile engine (SPEC §7.6), leaning on Appendix A.
6. Parked-list burn-down, starting with palette ranking and popover-on-focus.

## 9. Stats

- **Commits:** 24 (seed → `8fb4675`), imperative, one story per line in `git log --oneline`.
- **Tests:** 281 unit (13 files) + 31 e2e (5 specs) — all green.
- **Classifier corpus:** 54 fixtures · 76 positive expectations · 11 deny · 7 must-not-classify,
  snapshot-gated on actual classifier output.
- **Code:** ~9.1k LOC in `src/`, ~3.0k in `tests/`, 13 harness pages.
- **Reviews:** 4 per-rung + 1 whole-night, all by fresh subagents; every P0/P1 fixed same-night
  (9 P0s and ~30 P1s found and closed across the five reviews).
- **Bundle:** `dist/content.js` 94 KB dependency-light IIFE; no ajv/preact/vault logic in it;
  0 web-ext lint errors; local-only gate green.
