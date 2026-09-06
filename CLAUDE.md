# jobfill — project rules

Local-only Firefox (MV3) extension: structured resume storage with variant phrasings + confirm-first autofill of job applications. `SPEC.md` is the product and architecture authority — read the relevant section before implementing an area, and do not edit SPEC.md (log proposed changes in PROGRESS.md → Deviations instead). If `docs/OVERNIGHT_PLAN.md` exists, it is the active work order.

## Architecture invariants

- All vault/file access goes through the background `DataService`; content scripts and UI pages talk to it via the typed protocol in `src/shared/messages.ts`. Content scripts never touch `browser.storage` directly, even though Firefox allows it (crypto boundary, SPEC §6.1).
- All `browser.*` access lives behind the adapter interfaces in `src/shared/adapters/`. UI pages and tests run on the in-memory adapters; only entrypoints wire the real ones. Never call `browser.*` outside an adapter.
- Pure logic (classify, format, compose, rules) lives in `src/shared/` with no DOM/extension imports — unit-testable by construction.
- The content bundle stays dependency-light: no UI framework in content scripts; overlay is hand-rolled DOM in a closed shadow root. Preact is for options/popup only.
- Firefox-only APIs are fine (this is a Firefox extension) but mark each use with `// FF-only:` for a future port.
- Runtime network calls are forbidden — the extension is local-only. `npm run verify` includes a check that fails on URLs in `dist/`.

## Code & tests

- TypeScript strict, ESM, no `any` (use `unknown` + narrowing). Small modules, named exports.
- Never weaken, skip, or delete a test to get green. Every classifier bug fix adds a fixture to the corpus. Tests assert behavior (page-observable effects, event logs), not implementation mirrors.
- `npm run verify` must be green before every rung-level commit.

## Git & safety

- Commit small and often, imperative messages. Local only: never `git push`, never publish/sign (`web-ext sign`, `npm publish`, `gh` are all off-limits).
- New dependencies beyond the approved set (preact, ajv + ajv-formats, vitest, @playwright/test, esbuild or vite, web-ext, typescript, eslint + typescript-eslint, prettier, fake-indexeddb) require a one-line justification in PROGRESS.md → Decisions before install.
- Autofill safety is product-critical: no auto-submit code paths, deny-list per SPEC §7.9, sensitive fields never in fill-all. Treat any shortcut here as a P0.
- Keep `PROGRESS.md` current before every commit — it is the re-anchor point after context loss.
