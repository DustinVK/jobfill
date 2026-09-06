# jobfill

Local-only resume storage and job application autofill for Firefox.

Your resume lives in your browser as **structured, atomic facts with multiple phrasings** —
one bullet, three ways to say it (`impact` / `responsibilities` / `short`). On any job
application form, jobfill classifies the fields, proposes the right value for each, and lets
you confirm, swap phrasings, or edit before anything is written. It can also attach your
stored resume PDF to upload fields.

**Everything is local.** No accounts, no servers, no telemetry, no network calls at runtime —
enforced three ways: a build gate that fails on network primitives in the shipped bundle, a
manifest CSP with `connect-src 'none'`, and `data_collection_permissions: { required: ["none"] }`.

## Quickstart

```sh
npm ci
npm run build
npx web-ext run --source-dir=dist    # launches Firefox with the extension loaded
```

Then open the extension's options page (about:addons → jobfill → Preferences) and either:

- **Import JSON** — the fast path. Point an AI at `ai/PROMPT.md` with your resume and it
  produces a valid `import.json` (`ai/examples/sample-import.json` shows the shape), or
- enter your profile, work history, and answers bank by hand.

## 60-second demo

```sh
npm run demo          # serves the test harness + options app on http://localhost:5177
```

1. `npm run build && npx web-ext run` — Firefox opens with jobfill loaded.
2. Options page → Import / Export → import `ai/examples/sample-import.json`.
3. Browse to `http://localhost:5177/plain-form.html` (a realistic application form).
4. Invoke jobfill (toolbar button or `Alt+Shift+J`). The fill bar appears with
   **Fill N fields**.
5. Click it — identity, contact, address, links, employer land instantly. Click **Review**
   to step through the question fields (sponsorship, work authorization) one confirm at a
   time. **Undo** reverts everything.
6. On `http://localhost:5177/dropzone.html`, the stored resume PDF attaches into the upload
   field.

The palette (`Alt+Shift+Space`) fuzzy-searches everything you've stored and fills the
focused field — it works on any site, classified or not.

## Safety model

- **No auto-submit, ever.** There is no code path that clicks submit/next/continue.
- **Deny-list**: passwords, CAPTCHAs/OTPs, SSNs/national IDs, DOB, bank details are never
  filled, with no override.
- **Sensitive answers** (EEO self-ID, criminal disclosure, salary by default) are excluded
  from fill-all and need an explicit per-field confirmation. EEO storage itself is opt-in.
- **Confirm-first**: fill-all only touches high-confidence fields; everything else goes
  through the popover.

## Architecture map

`SPEC.md` is the full product and architecture authority. Orientation:

| Area | Where | SPEC |
|---|---|---|
| Data model (snippets, variants, versions, vault) | `src/shared/types.ts` | §4 |
| Composition (variant resolution, formats, budgets) | `src/shared/compose.ts`, `format.ts` | §5 |
| Storage + crypto boundary | `src/background/data-service.ts`, `codecs.ts` | §6 |
| Field discovery / labeling / classification | `src/content/scan.ts`, `label.ts`, `src/shared/classify.ts` + `rules/` | §7.1–7.3, App. B |
| Fillers + undo | `src/content/fillers/` | §7.4, §7.8 |
| File attach | `src/content/attach.ts` | §7.5 |
| Overlay (fill bar, popover, palette) | `src/content/overlay/` | §3.3–3.6 |
| Messaging protocol | `src/shared/messages.ts` | §8.3 |
| Adapter seam (`browser.*` isolation) | `src/shared/adapters/` | — |
| Import/export + AI interchange | `src/shared/interchange.ts`, `ai/` | §9 |

## Development

```sh
npm run verify        # typecheck → lint → unit tests → build → local-only gate → web-ext lint
npm run e2e           # Playwright (Firefox) against the harness pages
npm run dev:options   # options app in a plain tab on in-memory adapters
npm run demo          # harness pages + options app together
```

The e2e technique: Playwright cannot load WebExtensions into Firefox, so harness pages get
the built content bundle injected with an in-memory messaging adapter and a seeded vault —
exercising scanner → classifier → overlay → fillers exactly as shipped. The only untested
seams are the thin real `browser.*` adapters and the `wrappedJSObject` attach branch (manual
QA against `web-ext run`).

## License

MPL-2.0 (see SPEC.md header).
