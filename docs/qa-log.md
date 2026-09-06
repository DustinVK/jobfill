# Manual QA log

Live-ATS and real-extension checks that automation cannot cover (SPEC §11.6, OVERNIGHT_PLAN §7).
Run before each release; log results here with date + Firefox version.

## Real-extension smoke (highest priority — never exercised by the e2e)

- [ ] `npm run build && npx web-ext run` — extension loads, no console errors in
      about:debugging → Inspect.
- [ ] Options page opens, sample import (ai/examples/sample-import.json) succeeds, data
      visible in all tabs, survives browser restart.
- [ ] Toolbar click / Alt+Shift+J on `npm run demo` → plain-form.html: overlay appears,
      Fill N fills, Review steps, Undo restores. (Real `browser.*` adapters + real
      structured-clone messaging in play here, unlike the e2e.)
- [ ] **`wrappedJSObject` attach branch** on dropzone.html: attach button delivers the PDF
      and the page's FileReader readout shows `%PDF`. This branch has NEVER run before
      manual QA — the e2e can only exercise the plain-DataTransfer branch.
- [ ] Palette (Alt+Shift+Space) on a page with no grants: opens, searches, fills.
- [ ] storage.session access level: content script cannot read the session area.

## Live ATS spot checks (ToS-respecting: no submissions, test postings only)

- [ ] A Greenhouse-hosted posting (boards.greenhouse.io): fields classify, fill-all sane,
      resume attaches into the drop-zone.
- [ ] A Lever posting (jobs.lever.co): single `name` field gets the FULL name; hidden
      `#resume-upload-input` receives the file.
- [ ] One bespoke small-company form.
- [ ] A login/signup page: NOTHING classifies as identity; password untouched.
- [ ] Cross-origin iframe career page: fill bar explains the frame situation rather than
      failing silently (flow ships in M4; tonight verify the failure is graceful).

## Results

| Date | Firefox | Commit | Result | Notes |
|---|---|---|---|---|
| _(none yet)_ | | | | |
