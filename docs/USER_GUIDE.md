# jobfill — User Guide

jobfill stores your resume as structured facts with multiple phrasings and fills job
application forms with them — confirm-first, entirely on your machine. No accounts, no
servers, no network calls, ever.

---

## 1. Install

jobfill is not on addons.mozilla.org yet; you load it from the repo:

```sh
npm ci
npm run build
npx web-ext run --source-dir=dist
```

`web-ext run` opens a clean Firefox profile with jobfill loaded. To use your everyday
Firefox instead: open `about:debugging` → **This Firefox** → **Load Temporary Add-on…** →
select `dist/manifest.json`. (Temporary add-ons unload when Firefox quits; reload after a
restart.)

jobfill requests no host permissions at install. It only touches a page when you invoke it
there, via the `activeTab` grant that your click/shortcut provides.

## 2. Enter your data

Open the options page: `about:addons` → jobfill → **Preferences** (or the puzzle-piece
extensions menu → jobfill → Manage).

### The fast path: AI import

1. Open `ai/PROMPT.md` in this repo and paste its contents into any capable AI chat,
   attaching your resume (PDF/DOCX/Markdown). It will ask you one round of questions
   (phone, address, work-authorization answers, salary handling) and then emit an
   `import.json`.
2. Options → **Import / Export** → choose the file.
3. A **preview screen** shows exactly what will be added and what will be skipped —
   nothing is written yet. Click **Import** to accept.

Import is merge-add: it never modifies or deletes anything you already have; duplicates
are skipped and listed. To see the flow with fictional data first, import
`ai/examples/sample-import.json`.

### Manual entry

Work through the tabs, then click **Save** (top right — edits are local to the page until
saved; the header shows which sections have unsaved changes):

- **Profile** — name, contact, address, links, master skill list, and a professional
  summary with variant phrasings.
- **Work** — one entry per job. Each has a summary and bullet points, and every summary/
  bullet can hold several **variants** of the same fact: `impact` (metric-forward),
  `responsibilities` (duty-phrased, for government/Workday-style forms), `short`
  (≤140 chars for tight fields), `long`, or your own label. The character counter matters —
  many application fields have length limits, and jobfill automatically falls back to
  `short` variants when a field is tight.
- **Answers** — the questions every application asks: work authorization, sponsorship,
  relocation, notice period, salary, and any custom Q&A. The **patterns** field holds
  match fragments ("sponsor", "notice.?period") so jobfill can recognize the question on
  a page. Mark anything **Sensitive** to keep it out of one-click filling.
  - **EEO / demographic answers** (gender, race, veteran status, disability) live behind
    an explicit opt-in at the bottom of this tab. They exist only so *you* can one-click
    them per field; they are always sensitive, never auto-filled, and turning the opt-in
    off deletes them.
  - Salary starts sensitive by default; you can unmark it if you want it in fill-all.
- **Versions** — a version is a saved lens over your data: which style of phrasing wins
  (`impact, short` vs `responsibilities, long`) and which resume file is attached. The
  default "Everything / impact-first" version is created for you. Make one **active**;
  that's what fills.
- **Files** — upload your resume PDF (and cover letter), then attach each to a version
  with the slot selector. Save the Versions section afterwards to persist the link.

### Backups

**Import / Export** → **Export vault as JSON** downloads everything — including file
bytes — in the same format the importer reads. Export before experimenting; **Wipe**
(double-click + confirm) erases everything.

## 3. Fill an application

1. Navigate to the application form.
2. Click the **jobfill toolbar button** (or press **Alt+Shift+J**) — a small popup opens —
   and click **Fill this page**. (**Alt+Shift+Space** skips the popup and activates jobfill
   with the palette directly.)
3. The **fill bar** appears at the bottom of the page showing your active version's name,
   and dots appear on recognized fields:

   | Badge | Meaning |
   |---|---|
   | 🟢 solid green | high confidence — included in **Fill N fields** |
   | 🟡 amber | recognized, but wants your confirmation — included in **Review** |
   | 🟣 purple | sensitive (EEO, salary…) — fills only via its own explicit confirm |
   | ⚪ hollow | unrecognized — click to search your library or **map…** it |
   | 🟢 glowing green | already filled — click to revert just that field |
   | 🟠 orange | filled, but the site rewrote the value — check it |

4. **Fill N fields** fills every green field, scrolling each into view as it goes.
5. **Review M** steps through the amber fields one popover at a time:
   - the proposed value sits in an editable preview — edit freely, it fills as-is;
   - **Enter** fills · **S** skips · **Esc** stops the review;
   - **↑ / ↓** cycle alternate phrasings and formats (impact vs responsibilities wording,
     `(616) 555-0100` vs `+16165550100`, `05/2021` vs `May 2021`);
   - the search row swaps in anything else from your library;
   - **map…** corrects a wrong guess ("that's actually my city") — jobfill re-proposes
     immediately and remembers for the rest of your visit.
6. Purple (sensitive) fields: click the badge, review the value, and click
   **Confirm & fill** — deliberately a button, not a keystroke.
7. **Attach *your-resume.pdf*** appears when an upload field or dropzone is detected;
   one click puts the file linked to your active version into it.
8. **Undo** (or **Ctrl/Cmd+Z** while the overlay has focus) restores every touched field
   to what it held before. Clicking a filled field's badge reverts just that one.
9. Submit the application yourself. jobfill has no submit path — it will never click
   submit/next/continue for you.

### The palette — works anywhere

Press **Alt+Shift+Space** (or the **Search** button in the fill bar) on any page, even one
jobfill can't classify at all:

- fuzzy-search everything you've stored — snippets, bullets, answers, links;
- **Enter** fills the field that was focused when you opened the palette;
- **Shift+Enter** copies to the clipboard instead (for widgets that resist filling);
- 🔒-marked results are sensitive and ask for a second Enter before filling;
- type something new and choose **Save "…" as an answer** to grow your library on the spot.

## 4. What jobfill will never do

- **Never submits a form.** You always click the site's own submit button.
- **Never fills** passwords, CAPTCHA/OTP codes, SSNs or national IDs, passport or
  driver's-license numbers, dates of birth, or bank details — no setting overrides this.
- **Never bulk-fills sensitive answers.** EEO, criminal disclosure, and (by default)
  salary need an explicit per-field confirmation every time.
- **Never talks to the network.** Storage is your Firefox profile; the AMO data-collection
  declaration is "none", and the build fails if a network call ever appears in the bundle.

## 5. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| **Fill this page** is greyed out or errors | Some pages refuse content scripts (Mozilla-protected domains, `about:`/extension pages, quarantined domains). Nothing can be done there; the palette also won't work. |
| Fill bar says "No form fields found" | The form may live in a **cross-origin iframe** (common with Greenhouse/iCIMS embeds) — tonight's build can't reach into those; open the form's own URL directly. Also appears briefly on slow SPAs — jobfill rescans automatically as fields mount. |
| No **Fill N** button, only Review | Fewer than 3 fields classified confidently — a guard against filling search boxes. Use Review or the palette. |
| A field filled then went orange | The site's own JavaScript rewrote the value after filling. Click the field and fix it by hand, or use the popover again. |
| Dropdown/combobox not filled | jobfill types and picks from the site's suggestion list when it can; when it can't, the popover shows the value with a copy option — paste it via the site's own widget. |
| Attach button missing | No upload field/dropzone detected, no resume linked to the active version, or the only uploader looks like an ID/bank-document field (which jobfill refuses on purpose). |
| Imported data doesn't fill | Check the right **version** is active (Versions tab) — filling uses the active version's included entries and style priority. |
| Import rejected | The error report lists exact JSON paths; **Copy error report** and paste it back to the AI that produced the file. |

## 6. Keyboard reference

| Keys | Where | Action |
|---|---|---|
| **Alt+Shift+J** | any page | open the popup (then **Fill this page**) |
| **Alt+Shift+Space** | any page (overlay active) | open the palette |
| **Enter** | popover / palette | fill (non-sensitive) |
| **Shift+Enter** | palette | copy instead of fill |
| **↑ / ↓** | popover preview | cycle variants & formats |
| **Tab** | popover | jump to the next recognized field |
| **S** | review mode | skip this field |
| **Esc** | anywhere in the overlay | close popover / palette / stop review |
| **Ctrl/Cmd+Z** | overlay focused | undo all fills |
