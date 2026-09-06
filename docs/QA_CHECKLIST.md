# jobfill — Manual QA Checklist

The full manual test pass. Run top to bottom before any release; the automated suites
(`npm run verify`, `npm run e2e`) must be green *before* starting — this checklist covers
what they structurally cannot: the real `browser.*` adapters, the `wrappedJSObject` attach
branch, and live-site behavior. Record results in `docs/qa-log.md`.

**Test data:** import `ai/examples/sample-import.json` (fictional "Maya Okafor") unless a
step says otherwise. Expected values below come from that fixture.

---

## 0. Preflight (automated gates)

- [ ] `npm ci && npm run verify` exits 0 (typecheck, lint, unit tests, build, local-only
      gate, web-ext lint).
- [ ] `npm run e2e` exits 0 (Playwright/Firefox against the harness pages).
- [ ] `git status` clean; note the commit SHA in the results log.

## 1. Real-extension smoke — highest priority

*These paths have the least automated coverage: the e2e harness substitutes in-memory
adapters for the real messaging/storage/injection stack.*

- [ ] `npm run build && npx web-ext run --source-dir=dist` — Firefox launches, jobfill
      appears in the toolbar, **no errors** in the Browser Console or in
      `about:debugging` → jobfill → Inspect.
- [ ] Options page opens from `about:addons`; all six tabs render.
- [ ] Import `ai/examples/sample-import.json`: preview screen appears ("Will add 2 work…"),
      **Import** succeeds, summary lists what was added.
- [ ] Data survives a full browser restart (close Firefox, reopen, options still populated).
      *(Skip under a temporary add-on profile that discards state; use a persistent profile.)*
- [ ] In a second terminal, `npm run demo`; in the extension's Firefox, open
      `http://localhost:5177/plain-form.html` and invoke jobfill (toolbar click AND
      Alt+Shift+J — test both). The fill bar appears with the version name
      "Everything / impact-first".
- [ ] **Fill N fields** fills first/last/email/phone/city/zip/linkedin/company/title with
      Maya's values through the REAL messaging adapters, scrolling each field into view.
- [ ] `storage.session` isolation: from the page's devtools console (not the extension's),
      confirm page scripts cannot read extension storage (no `browser.storage` access from
      the page context).

## 2. `wrappedJSObject` attach branch — runtime-unverified until this passes

*The single most important manual check. The page-compartment DataTransfer/File/DragEvent
construction in `src/content/attach.ts` cannot execute outside a real extension.*

On `http://localhost:5177/dropzone.html` with the real extension:

- [ ] The fill bar shows **Attach Maya_Okafor_Resume_2026.pdf**.
- [ ] Click it → the page's readout (`#received`) shows the file arrived via
      `input-change` with `"head":"%PDF-1.4"` — this proves **page JS** read the real
      bytes through the compartment boundary.
- [ ] On `http://localhost:5177/dropzone-only.html` (no input element): attach delivers
      via the drop path; readout shows `"via":"drop"` and the `%PDF` head.
- [ ] On `http://localhost:5177/attach-safety.html`: the attach button targets the
      **resume** input; the passport input's file list stays empty.
- [ ] Toast wording is honest: "Attached …" only when verified; "Dropped … — check the
      site accepted it" on the drop path.

## 3. Overlay behavior on real Firefox

- [ ] With the palette or a popover open, wait a few seconds on a page that re-renders
      (e.g. `late-mount.html`): jobfill must **not** badge its own search box or preview
      (the scanner-skips-own-overlay guard uses `openOrClosedShadowRoot`, which only the
      real extension exercises).
- [ ] Re-invoking (Alt+Shift+J again) re-scans without duplicating the fill bar.
- [ ] The **✕** button removes the overlay entirely; re-invoke brings it back.
- [ ] Page cannot restyle the overlay: on a page with aggressive global CSS, the fill bar
      still renders correctly (closed shadow root).

## 4. Options app pass

- [ ] **Profile**: edit first name → header shows `unsaved: profile` → Save → "Saved." →
      reload page → edit persisted.
- [ ] **Work**: add an experience, add a bullet, add a second variant with the
      `responsibilities` chip, set it default via the radio; char counters update live.
- [ ] **Answers**: add a custom answer; the Sensitive checkbox toggles. Pick
      `salaryExpectation` from the key dropdown → sensitivity switches ON automatically
      (but stays editable). Pick `criminalDisclosure` → sensitivity locks.
- [ ] **EEO gate**: EEO keys absent from the key dropdown until "Allow storing EEO
      answers" is checked; adding `veteranStatus` shows a locked sensitive flag;
      unchecking the gate removes the stored EEO entries after the explanation.
- [ ] **Versions**: add, rename, edit style priority, Make active (confirm prompt if
      unsaved edits elsewhere), remove disabled when only one remains.
- [ ] **Files**: upload a PDF → row appears with kind/size; attach to a version (note the
      "save the Versions section to persist" hint) → Save → link survives reload. Delete
      prompts with the file's name. A >25 MB file is refused with a clear message.
- [ ] **Export** downloads a JSON that re-imports cleanly ("already exists — configuration
      merged in" skips, nothing duplicated).
- [ ] **Wipe** requires the double-click ("Click again to permanently wipe") and warns
      about unsaved edits; everything is gone after, including files.

## 5. Fill engine pass (demo harness, real extension)

For each page under `http://localhost:5177/`:

- [ ] **plain-form.html** — Fill N lands the identity/contact/address/links/work block;
      page listeners fire (values stick on blur); **Review** proposes the sponsorship
      radio ("No, I will not require sponsorship…" — the sample answer is *No*) and
      authorization select ("Yes"); the password field has **no badge** and stays empty;
      `window.__submitted` remains `false` throughout; **Undo** restores everything
      including a value you pre-typed yourself.
- [ ] **react-form.html** — after Fill N, the `#state-mirror` JSON shows React's own state
      updated (not just the DOM); Undo returns the mirror to empty strings.
- [ ] **late-mount.html** — invoke *before* the form renders; within ~1s of the form
      mounting, badges and the Fill button appear without re-invoking.
- [ ] **shadow-form.html** — fields inside the shadow root fill.
- [ ] **iframe-form.html** — the same-origin framed form fills (invoke injects all frames).
- [ ] **widgets.html** — the Country combobox types, waits for suggestions, and clicks
      "United States" (page shows `country=United States`); the Phone Type listbox button
      opens, picks "Mobile", button text updates; the form-wrapped trap button gets **no
      badge** and the page's `__submitted` stays `false`.
- [ ] **Popover interactions** on any amber field: editable preview fills as-edited;
      ↑/↓ cycles variants (work summary: impact ↔ responsibilities phrasing) and formats
      (phone, dates); type-to-filter swaps in another snippet; **map…** on a hollow badge
      reclassifies and re-proposes; Tab walks to the next field's popover.
- [ ] **Palette**: with `#summary` focused, Alt+Shift+Space → search "routing" → Enter
      fills the textarea; Shift+Enter copies; a 🔒 result (search "salary") demands a
      second Enter; an unknown string offers **Save "…" as an answer** with an inline
      question row (no browser dialog); Esc closes; Tab is trapped inside the palette.

## 6. Safety pass — must all hold, no exceptions

- [ ] Deny-list: password, SSN, DOB, passport/license, bank/routing/card, OTP/CAPTCHA
      fields never get badges, are refused by the palette even when focused, and cannot be
      promoted via **map…** (spot-check at least password + SSN + DOB on hand-made HTML,
      e.g. edit a harness page).
- [ ] Sensitive answers (salary with default flag, any EEO entry): excluded from Fill N,
      excluded from Review stepping, purple-badged, Enter in their popover shows the
      "click Confirm & fill" toast instead of filling.
- [ ] No submit: complete an entire fill+review+attach cycle on plain-form.html —
      `window.__submitted` still `false`; visually confirm nothing navigated.
- [ ] Nothing fills off-screen invisibly: on a form taller than the window, Fill N
      visibly scrolls through the fields it writes.
- [ ] Network silence: devtools Network tab on any harness page during a full session —
      zero requests from the extension (only the page's own).

## 7. Live ATS spot checks — ToS-respecting

*Real postings, real DOM churn. Fill only; never submit; prefer test/sandbox postings.*

- [ ] A **Greenhouse**-hosted posting (`boards.greenhouse.io/...`): first/last/email/phone
      classify and fill; resume lands in the drop zone; custom questions surface in Review
      or as hollow badges — never mis-filled silently.
- [ ] A **Lever** posting (`jobs.lever.co/...`): the single `name` field receives the
      **full** name (not just "Maya"); the hidden `#resume-upload-input` receives the file;
      note whether Lever's post-upload resume-parse overwrites fields (expected; re-fill
      and note it).
- [ ] One **bespoke** small-company form.
- [ ] A **login/signup page** (any site): username/password get no identity proposals,
      nothing fills, no Fill N offered.
- [ ] A career page with a **cross-origin iframe** (Greenhouse embed): confirm the
      failure is graceful — "No form fields found" — not a broken overlay. (Reaching into
      the frame ships in M4.)

Log ATS observations (selector drift, mis-classifications) as corpus-fixture candidates.

## 8. Wrap-up

- [ ] Re-run `npm run verify` if anything was touched during QA.
- [ ] Record the pass in `docs/qa-log.md` (date, Firefox version, commit, result, notes).
- [ ] File every failure with: page URL/harness file, expected vs observed, and the
      Browser Console output.
