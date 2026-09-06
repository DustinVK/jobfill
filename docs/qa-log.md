# Manual QA log

Results of manual test passes. The checklist itself lives in
[`docs/QA_CHECKLIST.md`](QA_CHECKLIST.md) — run it top to bottom (SPEC §11.6) before each
release and record the outcome here.

| Date | Firefox | Commit | Sections run | Result | Notes |
|---|---|---|---|---|---|
| 2026-09-06 (morning) | — | 84607d7 | §1 partial (first real-extension use) | **FAIL → fixed** | Toolbar click / Alt+Shift+J only showed the Rung-0 placeholder popup ("Open the options page…") — with `default_popup` set, no background listener fires, so nothing injected; only Alt+Shift+Space worked. Fixed: popup now has a working **Fill this page** (injects via its own `activeTab` grant), options shortcut, and non-injectable-page handling; unit-tested in `tests/unit/popup.dom.test.ts`. Re-run §1 from scratch. |
