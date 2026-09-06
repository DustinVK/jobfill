# Overnight Build Plan — jobfill

**Audience:** the Claude Code session executing this plan, unattended.
**Authority order on conflict:** `SPEC.md` (product & architecture) → this plan (tonight's work order) → `CLAUDE.md` (standing rules).
**Tonight's mission:** a *working version* of the extension. Working means: a human can `web-ext run` it, enter their data in the options page, invoke it on a real form, fill fields through popover/palette/fill-all, and attach a stored resume file. That is the end of Rung 3. Rung count is not the goal — honest, reviewed, green rungs are.

---

## 1. Ground rules

1. **Read first.** Read `SPEC.md`, `CLAUDE.md`, and this plan completely before writing any code.
2. **Strict rung order.** Never start a rung until the previous rung's Definition of Done (DoD) is fully green and its review protocol (§4) has run. Do not reinterpret or trim a DoD; if one proves wrong, log the deviation (§5) and satisfy its intent.
3. **Autonomy.** Do not wait for user input. Make the reasonable call, log it under Decisions in `PROGRESS.md`, and continue.
4. **Honesty is the top constraint.** Never weaken, skip, or delete a test to get green. Never mark a DoD item done that isn't. A partial rung honestly reported is a success; a faked green is the only real failure tonight.
5. **Scope discipline.** Nothing from SPEC M4+ tonight: no site profiles, no site-memory persistence, no version-composer UI, no encryption settings UI (the codec itself IS in scope), no sidebar, no Chrome port. Park ideas in `PROGRESS.md` → Parked.
6. **Local only.** Commits stay local; never push, publish, or sign. The built extension must contain no runtime network calls (enforced by the check in §6).
7. **Stuck protocol.** If one obstacle survives 3 distinct approaches or ~30 minutes of effort: write it up under Blocked in `PROGRESS.md` (symptom, approaches tried, best hypothesis), leave an honest `TODO(blocked):` comment, and route around it. Return only if a later rung unblocks it naturally.

## 2. Session start & re-anchor checklist

At session start, and again after any context compaction or restart:

1. Re-read `SPEC.md` §4–§8, this plan, `PROGRESS.md`, and `git log --oneline -20`.
2. `git status` must be clean or explainable; commit or stash strays before proceeding.
3. Confirm `npm run verify` status matches what `PROGRESS.md` claims. Trust the repo over your memory.

## 3. The rung ladder

### Rung 0 — Scaffold (SPEC M0)

Build the skeleton per SPEC §10.2 with working toolchain.

- Repo layout per SPEC §10.2 (omit `.github/` — CI yaml is Rung 4 optional; `npm run verify` is tonight's CI).
- `manifest.json` per SPEC §8.2 verbatim (placeholder icons are fine — generate simple ones).
- Toolchain: TypeScript strict ESM; esbuild (or Vite) building `background.js`, `content.js`, `options`, `popup` into `dist/` alongside the manifest; vitest; eslint + typescript-eslint + prettier; `web-ext` as devDependency.
- **Adapter seam (critical for everything after):** wrap all `browser.*` access behind interfaces in `src/shared/adapters/` (storage, messaging, scripting). Two implementations each: real (`browser.*`) and in-memory/mock. UI pages and tests run on mocks; only thin entrypoints touch the real thing. This is what makes tonight's UI work testable outside a loaded extension.
- Scripts: `build`, `test`, `lint`, `typecheck`, `e2e`, `verify` (§6), `dev:options` (serve options UI in a plain browser tab on the in-memory adapter).
- Playwright installed with the Firefox browser; one smoke e2e proving the harness technique of §7: inject built `content.js` (with mocked messaging adapter) into a blank harness page → overlay chip appears.

**DoD-0:** `npm run verify` green · `npx web-ext lint` clean on `dist/` · smoke e2e green · `PROGRESS.md` created with the rung checklist.

### Rung 1 — Data core (SPEC M1, trimmed)

- `src/shared/types.ts` — the full §4 data model, as specced.
- `src/shared/messages.ts` — §8.3 protocol types + payload validation helpers.
- Background `DataService` over the storage adapter; `PlainCodec` and `AesGcmCodec` (§6.3 of SPEC) both implemented and unit-tested (round-trip, wrong passphrase, tampered ciphertext ⇒ clean errors). Default remains plain; no settings UI for encryption tonight.
- `FileStore` over IndexedDB (unit-test with `fake-indexeddb`), metadata in the vault.
- `compose.ts` + `format.ts` — §5 variant resolution, derived formats (fullName, phone formats, date formats, "Present"), renderers with length-budget behavior. Thorough unit tests; these are pure functions, test them hard.
- Options app (Preact) on the adapter seam: Profile editor, Work Experience editor (bullets + variant editor with style chips + char counts), Answers bank editor (with `sensitive` flag; EEO storage opt-in gate per SPEC §4.3), Versions list (auto-created default version; name/stylePriority editable; composer UI itself is out of scope), Files manager placeholder (real in Rung 3).
- Export JSON (interchange format §9.1). Import: ajv validation against `ai/import.schema.json` (write the schema — hand-authored is fine if generation is friction; ids optional per SPEC) + `merge-add` strategy + a post-import summary screen. The dry-run diff screen is Rung 4 optional.
- `ai/examples/sample-import.json` — fictional but realistic, used as a test fixture.

**DoD-1:** verify green · export→wipe→import round-trip proven by an integration test on the in-memory adapter · sample import validates against the schema in a test · options app usable via `npm run dev:options` (manually sanity-checked via Playwright e2e: create a work experience with 2 bullet variants, reload, still there).

### Rung 2 — Fill engine core (SPEC M2) — the big one

- `scan.ts` (§7.1: fillable controls, shadow DOM via `openOrClosedShadowRoot` with fallback, hidden-file-input exception, MutationObserver settle + scan generations), `label.ts` (§7.2 signals), `classify.ts` (§7.3: weights, tiers, rationalization pass, min-signal guard, question matching) with the seed rules from SPEC Appendix B encoded as data in `src/shared/rules/`.
- **Classifier corpus:** ≥ 40 labeled fixtures in `fixtures/` covering every Appendix B key you implement, plus negatives (search box, login form, newsletter signup — must NOT classify) and the anti-pattern guard (account-signup username/password near identity fields). Corpus test reports per-key hits; any regression fails.
- Fillers: `text` (native-setter + input/change/blur), `select`, `radio-group`, `checkbox`. `combobox`/`listbox-button` are Rung 4 optional — on encounter, classify and drop to `suggest` with popover option list (§5.4 fallback), never pretend.
- Overlay in closed shadow root: fill bar (version display, Fill N / Review M, undo, close), field badges, popover (proposed value editable preview, Enter fills, variant/format cycling, type-to-filter, `map…` recording to an in-memory-only site-memory stub tonight), palette (fuzzy search all snippets/answers, Enter fills focused field, Shift+Enter copies, "Save '…' as" quick-save), fill-all + review stepping + undo (§7.8 snapshots).
- Safety rules live from day one: §7.9 deny-list tiers, sensitive lock-badges, no auto-submit anywhere.
- Harness pages (`tests/harness/`): plain HTML form · React 18 controlled form (real React via CDN or bundled fixture) · late-mounting SPA form (600 ms delayed render) · shadow-DOM form · same-origin iframe form. Each page records received events into `window.__eventLog` for assertions.
- e2e (§7 technique): fills land with correct values · page-side listeners observed `input`/`change` · React state actually updated (assert rendered state, not just input value) · undo restores priors · deny-listed password field untouched by fill-all · late-mount form gets scanned after settle.

**DoD-2:** verify + e2e green · corpus test green with per-key report committed · the "working version" bar is now demonstrable on harness pages end-to-end.

### Rung 3 — File attach (SPEC M3)

- Options Files manager: upload (into FileStore), list, delete, link file to a version.
- Content side: fill-bar attach button when a file field/dropzone is detected; bytes fetched from background as `File` via structured-clone messaging (real adapter) / direct handoff (mock adapter).
- `attachFileToInput` per SPEC §7.5 with **environment detection**: use `window.wrappedJSObject.DataTransfer` when present (real Firefox content script), else plain `DataTransfer` (harness/e2e context). Unit-test the branch selection; e2e exercises the plain branch.
- Dropzone fallback: synthesized `dragenter/dragover/drop` carrying the DataTransfer.
- e2e: react-dropzone-style harness receives a real `File` (name, size, bytes asserted via page-side FileReader) through both the hidden-input path and the drop path.
- **Honest limitation to record in PROGRESS + morning report:** the `wrappedJSObject` branch cannot be exercised outside a real extension; it ships code-reviewed but runtime-unverified, top of the morning manual-QA list.

**DoD-3:** verify + e2e green including both attach paths on harness · a stored file survives export/import round-trip (base64 in interchange).

### Rung 4 — Polish & demo (only if Rungs 0–3 fully green)

In priority order; stop anywhere:

1. `README.md`: what it is, quickstart (`npm i && npm run build && npx web-ext run`), 60-second demo script (enter data → open harness page → fill), architecture map pointing into SPEC.
2. `npm run demo`: serves harness pages + dev options together.
3. Overlay a11y: focus trap in popover/palette, Esc everywhere, ARIA roles, visible focus.
4. Import dry-run diff screen (deferred from Rung 1).
5. `combobox` + `listbox-button` fillers with harness page + e2e.
6. GitHub Actions workflow mirroring `npm run verify`.

**Explicitly forbidden even here:** anything in §1 rule 5.

## 4. Review protocol (end of every rung)

1. `npm run verify` and (Rung ≥ 0) `npm run e2e` green.
2. Spawn a **fresh subagent** (Task tool) — not self-review — with: the rung's goals from this plan, the relevant SPEC sections, and `git diff <last-rung-commit>..HEAD`. Ask it for concrete defects ranked P0 (broken/unsafe/spec-violating), P1 (will bite the user soon), P2 (nits), specifically checking: spec conformance, the local-only guarantee, test honesty (do tests assert behavior or mirror the implementation?), adapter-seam leaks (`browser.*` outside adapters), and dead code.
3. Fix every P0 and P1; re-run verify. Log P2s in `PROGRESS.md` → Parked.
4. Commit `rung N: <what shipped>` and update `PROGRESS.md` (checklist state, review findings summary, decisions).

Mid-rung: commit at every green sub-step with imperative messages. The morning `git log --oneline` should read as the night's story.

## 5. PROGRESS.md protocol

Single file at repo root, updated **before every commit**. Sections, in order:

```
# Progress
Status: <rung N — short phrase> | Last green checkpoint: <commit sha> <time>
## Rung checklists   (mirror of §3 DoDs, [x]/[ ]/[~partial])
## Decisions         (timestamped; anything SPEC/plan didn't dictate, with 1-line rationale)
## Deviations        (anything done differently than SPEC/plan says, with why)
## Blocked           (stuck-protocol entries: symptom, tried, hypothesis)
## Parked            (P2s + out-of-scope ideas)
```

This file is the re-anchor point after compaction — write it for a reader with no memory of the session.

## 6. `npm run verify` (single gate, must stay fast)

`typecheck` (tsc --noEmit) → `lint` (eslint + prettier check) → `test` (vitest run) → `build` → `check:local-only` → `web-ext lint` on `dist/`.

`scripts/check-local-only.mjs`: scan `dist/` for `http://` / `https://` / `ws(s)://` occurrences; allowed exceptions listed in the script with a comment each (expected: none, or the schema `$schema` URL if it ends up in a bundle). Any other hit fails the build. This enforces SPEC §1.1 mechanically.

## 7. e2e technique (do not fight Playwright about extensions)

Playwright cannot load WebExtensions into Firefox. Do not attempt it, and do not switch to Chromium to get `--load-extension`. Instead: harness pages are plain `file://`/localhost pages; tests inject the built `content.js` bundle configured with the **mock messaging adapter** preloaded with a fixture vault (Rung 0's seam makes this a one-liner). This exercises scanner → classifier → overlay → fillers exactly as shipped; the only untested seams are the real `browser.*` adapters and the `wrappedJSObject` branch — both thin, both flagged for morning manual QA in the report.

## 8. MORNING_REPORT.md (the final act)

When Rung 4 is done, or no further honest progress is possible, write `MORNING_REPORT.md`:

1. **Executive summary** — 3 sentences: what works now, how far the ladder got, the one thing to know.
2. **Rung status table** — per rung: green/partial/not started + evidence (test counts, e2e names, commit shas).
3. **Try it now** — exact commands, then a 60-second demo path (install, enter one job, fill the harness or a real page, attach the file).
4. **Look at these first** — top 3 files/decisions that most deserve human judgment, with why.
5. **Manual QA needed** — the real-extension checks tonight couldn't cover (`web-ext run` smoke, `wrappedJSObject` attach on a real upload field, cross-frame behavior).
6. **Deviations & Decisions** — copied/condensed from PROGRESS.md.
7. **Blocked & Parked** — what's stuck and what's queued.
8. **Suggested next session** — ordered list for tomorrow night.
9. **Stats** — commits, tests passing, fixture count, rough LOC.

Then: final commit `overnight run complete: <summary>` — and stop. Do not start new work after the report.
