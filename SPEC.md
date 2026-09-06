# jobfill — Local-Only Resume & Job Application Autofill for Firefox

**Working title:** `jobfill` (placeholder — rename freely)
**Author:** Dustin / Occam's Garage
**Status:** Draft v1 — 2026-09-06
**Target:** Firefox, Manifest V3, `strict_min_version: 128.0`
**License suggestion:** MIT or MPL-2.0 (sibling project to expurge)

---

## Table of contents

1. [Overview](#1-overview)
2. [Core concepts](#2-core-concepts)
3. [User experience](#3-user-experience)
4. [Data model](#4-data-model)
5. [Composition & rendering](#5-composition--rendering)
6. [Storage & crypto architecture](#6-storage--crypto-architecture)
7. [Autofill engine](#7-autofill-engine)
8. [Extension architecture](#8-extension-architecture)
9. [Import/export & the AI import skill](#9-importexport--the-ai-import-skill)
10. [Tech stack & repo layout](#10-tech-stack--repo-layout)
11. [Testing strategy](#11-testing-strategy)
12. [Milestones](#12-milestones)
13. [Risks & open questions](#13-risks--open-questions)
- [Appendix A: ATS reference (seed data for site profiles)](#appendix-a-ats-reference)
- [Appendix B: Classifier seed data](#appendix-b-classifier-seed-data)
- [Appendix C: Sources](#appendix-c-sources)

---

## 1. Overview

### 1.1 What it is

A Firefox extension that stores your resume and work history as **structured, atomic facts with multiple phrasings**, and helps you fill job applications fast. On any application form — a known ATS like Workday or a site it has never seen — it classifies the fields, proposes the right value for each one, and lets you confirm, swap in an alternate phrasing, or edit before it fills. It can also attach your stored resume PDF to file-upload fields.

Everything is local. No accounts, no servers, no telemetry, no network calls at runtime. The AMO listing declares `data_collection_permissions: { required: ["none"] }` and means it.

### 1.2 Why (positioning)

Every ATS asks for the same information in a slightly different shape: one wants a paragraph of *responsibilities*, another wants *impact bullets*; one wants first/last name split, another wants full name; one is Workday with stable `data-automation-id`s, another is a bespoke PHP form from 2011. Existing autofill tools are cloud services that hoover up your work history. This is the privacy-respecting version: your data never leaves the browser profile, and the tool's job is to make *you* fast, not to mass-apply on your behalf.

### 1.3 Goals

- **G1 — One canonical dataset, many phrasings.** Enter each job/project/bullet once; store variant phrasings (impact vs. responsibilities vs. short vs. long) and compose "resume versions" as saved selections over them.
- **G2 — Works everywhere.** Heuristic field detection on unknown sites; declarative site profiles for known ATS; a search-anything palette as the universal floor (worst case on any site: focus field → shortcut → search → Enter).
- **G3 — Confirm-first filling.** Nothing is written to the page without a user action. Per-field suggestion popovers, a fill-all action for high-confidence fields, visible results, one-keystroke undo.
- **G4 — File attach.** Store resume PDFs/DOCX per version and inject them into `<input type="file">` / dropzones so you never hunt the filesystem mid-application.
- **G5 — Gets smarter locally.** User corrections become per-site field mappings ("site memory"), so an unknown site becomes a known site after one application.
- **G6 — AI-assisted onboarding, AI-free runtime.** A companion Claude skill (and a portable prompt) converts an existing resume into the import JSON. The extension itself never calls an AI or any network endpoint.
- **G7 — Minimal permission footprint.** No install-time host permissions. `activeTab` for one-shot use; optional per-site grants only when the user asks to remember a site.

### 1.4 Non-goals (v1)

- **No auto-submit, ever.** The extension fills; the human reviews and submits. This is an assistive tool, not an application bot (also keeps us clear of ToS trouble on sites like LinkedIn).
- No cloud sync, accounts, or telemetry of any kind.
- No AI calls from the extension.
- No Chrome/Chromium port in v1 (portable seams are noted where cheap — Firefox-only APIs are flagged inline).
- No cover-letter *generation* (storage + variants of your own cover letter text: yes).
- No scraping/aggregating job postings.
- Named ATS adapter *packs* are post-v1; the declarative site-profile engine they plug into **is** v1 (§7.6), and Appendix A carries researched seed data so packs are cheap to add later.

### 1.5 Privacy & safety stance

- Local-only storage in the Firefox profile; optional encryption at rest (off by default, boundary designed in from day one — §6).
- Demographic/EEO answers (gender, race, veteran status, disability) are opt-in to even *store*, are flagged sensitive, are excluded from fill-all, and require an explicit per-field click to fill (§7.9).
- The extension never fills passwords, CAPTCHAs, SSNs/national IDs, or bank details, full stop.

---

## 2. Core concepts

Glossary used throughout the spec, the code, and the UI:

| Term | Meaning |
|---|---|
| **Atom** | A single canonical piece of data: a fact (`contact.email`), an entity (`work[2]`), or a snippet. Entered once, referenced everywhere. |
| **Snippet** | A text-bearing atom with one or more **variants** — e.g. one bullet of a job, or a job's summary paragraph. Searchable in the palette. |
| **Variant** | One phrasing of a snippet, tagged with a **style**: `impact`, `responsibilities`, `short`, `long`, or a custom label. |
| **Resume Version** | A saved lens over the atoms: which experiences/education/projects are included, which variant of each snippet is preferred, which resume file is attached, plus a style-priority fallback order. Examples: "Impact-focused SWE", "Responsibilities (gov/Workday)". Exactly one is *active* at a time. |
| **Canonical key** | A dot-path naming what a form field semantically wants: `identity.firstName`, `work[i].summary`, `answers.sponsorship`. The classifier maps DOM fields to canonical keys; the composer renders values for them. Full taxonomy in §4.5. |
| **Site profile** | A declarative JSON description of a known site: URL/DOM matchers plus field→canonical-key mappings and widget strategies. Shipped as data, not code (§7.6). |
| **Site memory** | The same structure as a site profile, but generated locally from the user's own corrections on a site, stored per-origin (§7.7). |
| **Palette** | A command-palette overlay (keyboard-first fuzzy search over all atoms/snippets) that fills the focused field. Works with zero classification on any site — the universal fallback (§3.6). |
| **Fill plan** | The scanner+classifier's output for a page: per-field `{element, canonical key, proposed value, confidence tier}`. Tiers: `auto` (fill-all eligible), `suggest` (popover pre-selected, needs confirm), `manual` (palette only), `skip` (deny-listed). |

---

## 3. User experience

### 3.1 First run & data entry

1. Install → options page opens with an empty-state screen offering three entry paths:
   - **Import JSON** — the fast path; the screen links to the AI import skill / portable prompt (§9) and accepts the resulting `import.json`.
   - **Guided manual entry** — profile → work experience → education → projects → skills → answers bank, in that order. Each experience editor has a bullets list; each bullet/summary has a variant editor (see 3.2).
   - **Start minimal** — just name/contact, add the rest as applications demand it (the palette's "save what I just typed" affordance, §3.6, feeds this).
2. The user then creates at least one **Resume Version** (a default "Everything / impact-first" version is auto-created) and optionally attaches a resume file to it.

### 3.2 Variant editor (the heart of G1)

Inside any snippet (bullet, summary, cover letter, title):

- Variants listed as tabs/rows with style chips (`impact`, `responsibilities`, `short`, `long`, custom).
- "Add variant" pre-fills with the current text for editing; "Generate offline hint" is a *copy prompt* button (copies snippet + instructions to clipboard for pasting into any AI chat — the extension itself does not call AI).
- Per-version preference is set in the Version composer, not here (one snippet, N phrasings; versions choose).
- A character count per variant, since many ATS fields have `maxlength` (composer prefers `short` variants under tight budgets, §5.3).

### 3.3 Invoking on a page

- **Toolbar click** or **keyboard shortcut** (`_execute_action`; default `Alt+Shift+J`) activates the extension on the current tab via `activeTab` — no permission prompt, works on any site immediately, one-shot.
- On activation, the content bundle is injected (idempotently), scans the page (§7.1–7.4), and shows the **overlay**: small unobtrusive badges on recognized fields + a bottom **fill bar**.
- The fill bar shows: active Resume Version (switchable inline), `Fill N fields` (auto tier), `Review M` (suggest tier), file-attach button when an upload field was found, undo, and close.
- If the page has no detectable form fields, the fill bar says so and offers the palette anyway.

### 3.4 Per-field popover (confirm / swap / edit — the core interaction)

Focusing (or clicking the badge of) a recognized field anchors a popover to it:

- **Proposed value** shown in an editable preview box, with the canonical key label ("Work experience 2 → Summary (responsibilities)") and a confidence indicator.
- **Enter** fills the field with the preview content. **Esc** dismisses. **Tab** moves to the next recognized field, keeping flow keyboard-only.
- **Variant switcher**: `↑/↓` or chips cycle through the snippet's other variants and derived formats (e.g. phone as `(616) 555-0100` vs `+16165550100`; date as `MM/YYYY` vs `May 2021`).
- **Type to filter**: typing in the popover's search row swaps the proposal for any other atom/snippet (same index as the palette).
- **Edit before insert**: the preview box is editable; edits fill as-is. A `Save as new variant` toggle persists the edit back to the snippet (default off).
- **Wrong mapping?** A `map…` action lets the user pick the correct canonical key; the correction is recorded to site memory (§7.7) so next time this site classifies correctly.

### 3.5 Fill-all and review flow

- `Fill N fields` fills every `auto`-tier field at once, animating briefly per field so changes are visible; filled fields get a subtle badge (✓, click to revert that field).
- `Review M` steps through `suggest`-tier fields one popover at a time (Enter=accept, arrows=swap variant, S=skip).
- **Undo** (button and `Ctrl+Z` while overlay is focused) restores all touched fields to their pre-fill values (snapshot per element, §7.8).
- Sensitive/deny-listed fields are never part of fill-all (§7.9); sensitive ones that have stored answers get a lock badge — click → explicit confirm popover.

### 3.6 The palette (universal fallback)

- Shortcut (default `Alt+Shift+Space`, also a `commands` entry so it grants `activeTab` by itself) opens a command palette bound to the currently focused field.
- Fuzzy search across all atoms and snippets (label, text, tags, company names…). Enter fills the focused field; `Shift+Enter` copies to clipboard instead (for exotic widgets the filler can't drive).
- Results are ranked by: field classification match (if any) → active version's preferences → recency of use.
- If the user types something not in the library and fills it manually, the palette offers **"Save '…' as…"** → quick-save into an atom or answers-bank entry. This is how the library grows organically.
- The palette works on completely unknown sites with zero classification — it is the guaranteed floor of G2.

### 3.7 File attach

- When an upload field/dropzone is detected, the fill bar shows `Attach resume (Dustin_Resume_2026_SWE.pdf)` — the file linked to the active version (switchable).
- Click → the file is injected (§7.5). If injection fails (exotic uploader), fall back to a toast explaining "click the field and pick from your Downloads" + an optional `Export copy to disk` action (uses the `downloads`-free route: an `<a download>` on a blob URL from the options page, avoiding an extra permission).

### 3.8 Remembering a site (persistent enable)

- One-shot `activeTab` use never prompts. If the user wants the extension to auto-scan this site in the future, the **popup** offers `Always enable on <origin>` → `permissions.request({origins})` → `scripting.registerContentScripts` scoped to that origin with `persistAcrossSessions: true`.
- Constraint: `permissions.request()` must run in a user-input handler in an extension context; content scripts can't call it. Therefore the grant button lives in the popup (and options page), not the in-page overlay. The overlay may *point* at the toolbar button, nothing more.
- The popup also lists granted sites with one-click revoke (`permissions.remove` + unregister scripts), and shows site-memory status ("4 field mappings learned here — view/clear").

### 3.9 Cross-origin embeds (Greenhouse iframes etc.)

`activeTab` covers the top page and same-origin frames only. Many career pages embed the actual form in a cross-origin iframe (`#grnhse_iframe`, `#icims_content_iframe`). The content script cannot see into those frames, but it **can** read the iframe elements' `src` from the top document. UX: the fill bar detects a known/plausible application iframe and shows `The form lives on boards.greenhouse.io — enable there?` → deep-links the popup flow for that origin → after grant, injection into the frame works (registered script with `allFrames: true` matching that origin).

### 3.10 Multi-step wizards

State is kept per-tab; on DOM mutation/navigation within the same application (Workday steps, iCIMS server round-trips), the scanner re-runs and the fill bar reappears with fresh counts. The overlay shows a small step indicator ("filled 6 on previous step") so the user trusts continuity. Repeating sections ("Add another experience") are handled per §7.10.

---

## 4. Data model

TypeScript-first; the JSON Schema in `ai/import.schema.json` is generated from (or kept in lockstep with) these types. All ids are `crypto.randomUUID()`.

### 4.1 Snippets and variants

```ts
type VariantStyle = "impact" | "responsibilities" | "short" | "long" | (string & {});

interface Variant {
  id: string;
  style: VariantStyle;
  text: string;
}

interface Snippet {
  id: string;
  label?: string;        // human name in the library ("Led CI migration")
  tags: string[];        // free-form, searchable ("kubernetes", "leadership")
  variants: Variant[];   // length >= 1
  defaultVariantId: string;
}
```

### 4.2 Entities

```ts
type YearMonth = string;   // "2021-05"; day precision not modeled — no ATS needs it for history

interface WorkExperience {
  id: string;
  company: string;
  companyUrl?: string;
  location?: string;          // "Grand Rapids, MI" / "Remote"
  title: string;              // canonical
  titleVariants?: Variant[];  // e.g. internal title vs. market title
  startDate: YearMonth;
  endDate?: YearMonth;        // absent + current=true → "Present"
  current: boolean;
  summary: Snippet;           // paragraph-form description (the impact/responsibilities split lives here)
  bullets: Snippet[];         // individual accomplishment/duty lines
  skills?: string[];
}

interface Education {
  id: string;
  school: string;
  degree?: string;            // "B.S."
  field?: string;             // "Digital Media Software Engineering"
  gpa?: string;
  location?: string;
  startDate?: YearMonth;
  endDate?: YearMonth;
  current: boolean;
  notes?: Snippet;
}

interface Project {
  id: string;
  name: string;
  role?: string;
  url?: string;
  startDate?: YearMonth;
  endDate?: YearMonth;
  summary: Snippet;
  bullets: Snippet[];
  skills?: string[];
}

interface Certification { id: string; name: string; issuer?: string; date?: YearMonth; url?: string; }

interface StoredFile {
  id: string;
  kind: "resume" | "coverLetter" | "other";
  name: string;               // "Dustin_Resume_2026_SWE.pdf"
  mime: string;
  bytesRef: string;           // key into the file store (§6.3); bytes never inline in the doc store
  size: number;
  addedAt: string;            // ISO
}
```

### 4.3 Identity, contact, links, answers

```ts
interface Profile {
  identity: { firstName: string; lastName: string; middleName?: string; preferredName?: string;
              honorific?: string; suffix?: string };
  contact:  { email: string; secondaryEmail?: string;
              phone: { countryCode: string; national: string };   // formats derived, §5.2
              phoneType?: "mobile" | "home" | "work" };
  address:  { line1?: string; line2?: string; city?: string; state?: string;
              postalCode?: string; country?: string };            // country as ISO name the user uses
  links:    { linkedin?: string; github?: string; portfolio?: string; website?: string;
              other?: { label: string; url: string }[] };
  summary?: Snippet;          // "professional summary" / objective, with variants
  coverLetter?: Snippet;      // base cover letter text, with variants
  skills: string[];           // master skill list (versions can subset)
  languages?: { name: string; level?: string }[];
}

interface AnswerEntry {
  id: string;
  key?: WellKnownAnswerKey;   // see below; undefined for fully custom Q&A
  question: string;           // canonical question text as the user thinks of it
  patterns: string[];         // regex fragments for matching site questions
  kind: "boolean" | "choice" | "text" | "number" | "date";
  value: string | number | boolean;
  choiceSynonyms?: string[];  // for choice widgets: acceptable option labels ("Yes", "I am authorized")
  variants?: Variant[];       // for text answers
  sensitive: boolean;         // sensitive ⇒ never auto/fill-all, explicit confirm only (§7.9)
}

type WellKnownAnswerKey =
  | "workAuthorization" | "sponsorship" | "relocation" | "remotePreference"
  | "salaryExpectation" | "noticePeriod" | "earliestStart" | "howDidYouHear"
  | "referralName" | "over18" | "previouslyEmployedHere" | "criminalDisclosure" /* sensitive */
  | "gender" | "race" | "ethnicity" | "veteranStatus" | "disabilityStatus"      /* EEO: sensitive */
  | "pronouns";

// EEO entries: storing them at all is opt-in in the options UI, they are forced sensitive,
// and the UI explains they exist only so *the user* can one-click them per field.
```

### 4.4 Resume versions

```ts
interface ResumeVersion {
  id: string;
  name: string;                       // "Impact-focused SWE"
  description?: string;
  fileId?: string;                    // attached StoredFile (kind: resume)
  coverLetterFileId?: string;
  include: {
    workIds: string[];                // ordered; order = fill order for repeating sections
    educationIds: string[];
    projectIds: string[];
    certificationIds: string[];
    skills?: string[];                // subset/reorder of Profile.skills; undefined = all
  };
  stylePriority: VariantStyle[];      // fallback order, e.g. ["impact", "short"] or ["responsibilities", "long"]
  variantPrefs: Record<string /* snippetId */, string /* variantId */>;  // explicit per-snippet overrides
  titlePrefs?: Record<string /* workId */, string /* variantId */>;
  answerOverrides?: Record<string /* answerId */, string | number | boolean>;
}

interface Settings {
  activeVersionId: string;
  encryption: { enabled: boolean };   // §6.4
  fillAllThreshold: number;           // default 0.8
  suggestThreshold: number;           // default 0.5
  paletteShortcutHint: string;        // display only; real binding via browser.commands
}
```

### 4.5 Canonical key taxonomy

The contract between classifier (§7.3) and composer (§5). Dot paths; `[i]` denotes the i-th *included* entity of the active version (0-based, in `include` order).

```
identity.firstName · identity.lastName · identity.middleName · identity.fullName*
identity.preferredName · identity.honorific · identity.suffix · identity.pronouns†
contact.email · contact.phone* (formats) · contact.phoneCountryCode · contact.phoneType
address.line1 · address.line2 · address.city · address.state · address.postalCode
address.country · address.full*
links.linkedin · links.github · links.portfolio · links.website
summary · coverLetter.text
work[i].company · work[i].title · work[i].location · work[i].startDate · work[i].endDate
work[i].current · work[i].summary · work[i].bullets* · work[i].companyUrl
education[i].school · education[i].degree · education[i].field · education[i].gpa
education[i].startDate · education[i].endDate
projects[i].name · projects[i].url · projects[i].summary
skills* (joined list) · certifications[i].name · languages*
documents.resume (file) · documents.coverLetter (file)
answers.<wellKnownKey> · answers.custom
eeo.gender · eeo.race · eeo.ethnicity · eeo.veteranStatus · eeo.disabilityStatus   [sensitive]
```

`*` = derived/composed values (§5.2). `†` = optional, only if the user stored it.

### 4.6 Root document

```ts
interface Vault {
  schemaVersion: 1;
  profile: Profile;
  work: WorkExperience[];
  education: Education[];
  projects: Project[];
  certifications: Certification[];
  answers: AnswerEntry[];
  versions: ResumeVersion[];
  files: StoredFile[];        // metadata only; bytes in the file store
  settings: Settings;
  siteMemory: Record<string /* origin */, SiteProfile>;   // §7.6–7.7
  updatedAt: string;
}
```

---

## 5. Composition & rendering

How a canonical key + the active Resume Version becomes the string (or file) that goes into a field.

### 5.1 Variant resolution

For any snippet-backed key:

1. `version.variantPrefs[snippetId]` if set;
2. else first variant whose style matches `version.stylePriority`, in priority order;
3. else `snippet.defaultVariantId`.

The popover's variant switcher cycles the *other* candidates in the same order.

### 5.2 Derived values & formatters

Pure functions in `shared/format.ts`, all covered by unit tests:

| Derived key / format | From | Notes |
|---|---|---|
| `identity.fullName` | first + [middle] + last | Lever's single `name` field, many others |
| `contact.phone` formats | countryCode + national | `national` `(616) 555-0100`, `digits` `6165550100`, `e164` `+16165550100`, `dashed` `616-555-0100` — popover-cyclable; classifier hints pick a default (`tel-national` etc.) |
| `address.full` | line1..country | one-line joined |
| Dates | `YearMonth` | `MM/YYYY`, `MM/DD/YYYY` (day=01), `YYYY-MM`, `Month YYYY`, month-name, bare year; segmented widgets get parts (§7.4) |
| `work[i].endDate` when `current` | — | "Present" for text contexts; for checkbox+date widgets, tick "current" and skip end date |
| `skills` | list | joiners: `", "`, newline, `" · "` |
| `work[i].bullets` | included bullets | renderers below |

### 5.3 Snippet renderers for big text fields

A `work[i].summary`-classified `<textarea>` can want very different shapes. Renderers, selectable in the popover (default chosen by heuristics on field size/`maxlength`):

- `paragraph` — the summary snippet's resolved variant, as-is.
- `bullets` — included bullets' resolved variants, prefixed `• ` (or `- `), newline-joined.
- `paragraph+bullets` — summary, blank line, bullets.
- `plain-join` — bullets joined as sentences (for sites that strip newlines).

**Length budget:** if the field exposes `maxlength` (or a profile sets one), the composer retries with `short` variants, then drops trailing bullets, and finally hard-truncates at a word boundary with the popover showing a "truncated" warning. Never silently exceed and let the site cut mid-word.

### 5.4 Choice widgets (selects, radios, comboboxes)

Choice-valued keys (country, state, phone type, boolean answers, EEO) resolve to a **target label set**: the stored value plus `choiceSynonyms`. The filler matches options by normalized text (case/punctuation-insensitive, substring-tolerant): e.g. `answers.sponsorship = false` matches "No", "I do not require sponsorship", "No, I will not require sponsorship now or in the future". If no option clears the match threshold the field drops to `suggest` with the options listed in the popover for one-click pick.

---

## 6. Storage & crypto architecture

### 6.1 Single data service, one code path

**All** vault reads/writes go through a `DataService` living in the background event page; content scripts and UI pages talk to it via typed `runtime.sendMessage` calls (§8.3). Content scripts never touch `browser.storage` directly, even though Firefox would allow it — this keeps the crypto boundary (and any future storage migration) in exactly one place.

### 6.2 Physical layout

- **Vault document** (everything in §4.6 except file bytes): `browser.storage.local` under key `vault`, wrapped in an envelope (§6.3). Firefox's `storage.local` has IndexedDB-scale quotas (no Chrome-style 10 MB cap), so no `unlimitedStorage` permission is needed — keeps the install prompt clean. Revisit only if `QuotaExceededError` ever appears.
- **File bytes**: IndexedDB in the background context (`moz-extension://` origin), object store `files`, keyed by `bytesRef`, values stored as native `Blob`s (no base64 overhead). Note: a content script's IndexedDB belongs to the *host page's* origin — never use it there; files travel by messaging.
- **Firefox-specific advantage:** extension messaging uses structured clone, so the background can respond to `file.get` with a real `File` object directly. Keep a `base64` transport fallback behind the same `FileStore` interface for a future Chrome port (Chrome messaging is JSON-only).
- **Session state** (unlocked crypto key, per-tab fill state): `browser.storage.session` (memory-only, cleared on browser exit, survives event-page suspends; 10 MB cap, enforced since FF 137). Access level stays default (`TRUSTED_CONTEXTS`) so content scripts can't read the key.

### 6.3 Storage provider interface (the crypto boundary)

```ts
interface VaultCodec {
  encode(vault: Vault): Promise<StoredEnvelope>;
  decode(env: StoredEnvelope): Promise<Vault>;
}

type StoredEnvelope =
  | { v: 1; enc: "none"; data: unknown }                                  // plaintext JSON
  | { v: 1; enc: "aes-gcm"; kdf: KdfParams; iv: string; ct: string };     // base64 fields

interface KdfParams { alg: "PBKDF2-SHA256"; iterations: number; salt: string }  // iterations ≥ 600_000
```

- v1 ships `PlainCodec` (default) and `AesGcmCodec` (implemented + unit-tested from day one; the settings UI to enable it may land post-v1, see §12).
- `AesGcmCodec`: WebCrypto only — PBKDF2-SHA256 → AES-256-GCM. (Argon2id would be nicer but needs WASM; noted as a future swap via `KdfParams.alg`.) File-store blobs are encrypted with the same session key when encryption is on (per-file random IV, stored beside the blob).
- Unlock flow (when enabled): background prompts via popup/options; derived key lives in `storage.session` only; auto-lock on browser exit is inherent, optional idle timer re-locks by deleting the session key.
- **Honest threat model in the UI:** encryption protects against casual filesystem/profile-directory snooping and stolen backups. It does not protect against malware running as the user while the vault is unlocked. Don't oversell it.

### 6.4 Export/backup

- `Export vault` from options: JSON file including file bytes as base64 (schema in §9.1, same as import). Optional passphrase-encrypt-the-export using the same envelope even when at-rest encryption is off — nice reuse, zero extra crypto surface.
- Import accepts both plain and encrypted exports; merge flow in §9.2.

---

## 7. Autofill engine

The heart of the extension. Runs in the content script; pure logic lives in `shared/` for unit-testability (DOM adapters are thin).

### 7.1 Field discovery

- Scan `document` for fillable controls: `input` (text/email/tel/url/number/search/date/month), `textarea`, `select`, `[contenteditable=true]`, `input[type=file]`, radio/checkbox groups (grouped by `name` or enclosing `fieldset`), and **custom widgets**: elements with `role=combobox`, `aria-haspopup=listbox`, `aria-autocomplete=list`, or (profile-declared) widget roots.
- Traverse open **and closed shadow roots** via Firefox's `element.openOrClosedShadowRoot` (recursive walk; Chrome equivalent exists for a future port).
- Same-origin iframes are reached by injecting with `allFrames: true`; each frame runs its own scanner and reports to a per-tab coordinator in the background (frames can't see each other). Bail out fast in frames with no fillable fields (ad iframes — MDN explicitly warns content scripts can fire dozens of times per page).
- Skip invisible/disabled controls (`offsetParent === null` heuristic + `disabled`/`readonly`), except inputs hidden behind styled upload dropzones (`input[type=file]` with zero size/opacity is *the* common pattern — keep those).
- **SPA readiness:** a debounced `MutationObserver` (150–300 ms settle) triggers incremental re-scans; a scan generation counter invalidates stale popovers. Route changes (History API) also trigger re-scan. This covers Workday/Ashby/Greenhouse-React/BambooHR-style late-mounting forms.

### 7.2 Field labeling (signal gathering)

For each control, gather in order (all kept, not first-match):

1. `autocomplete` attribute (authoritative when present and ≠ `off`);
2. `<label for=…>` / wrapping `<label>`;
3. `aria-labelledby` (resolved text) → `aria-label`;
4. `<legend>` of the enclosing `fieldset` (radio/checkbox groups);
5. `placeholder`;
6. humanized `name` / `id` / `data-automation-id` / other `data-*` (split camelCase and `_-`: `legalNameSection_firstName` → "legal name section first name");
7. nearby text: previous element sibling's text, parent's leading text node, same-row `<th>`/previous `<td>` for table layouts, `aria-describedby` — capped tree walk (≤3 hops).

Canonicalize into a `haystack` (lowercase, collapse whitespace/punctuation) but remember which signal contributed what (weights below). Record `maxlength`, options (for choice widgets), and required-ness (`required`/`aria-required`/label `*`).

### 7.3 Classification

Precedence: **site profile / site memory match** (exact selector → key) → **`autocomplete` token map** → **regex heuristics**.

Heuristics: an ordered rule table per canonical key with `positive` / `negative` regexes (seed table in Appendix B, derived from Chromium/Firefox autofill patterns + job-application-specific additions). Score = `max(signalWeight × ruleScore)` over signals:

| Signal | Weight |
|---|---|
| `autocomplete` token | 1.0 (authoritative) |
| label / legend | 0.9 |
| aria-label(ledby) | 0.85 |
| name/id/data-* | 0.7 |
| placeholder | 0.6 |
| nearby text | 0.4 |

- Tiers from `Settings`: score ≥ 0.8 → `auto`; ≥ 0.5 → `suggest`; else `manual`. Deny-list match → `skip` regardless (§7.9).
- **Rationalization pass** (Chromium's trick, keep it): drop illogical combos — a lone "name" field with no last-name sibling → `identity.fullName`, not `firstName`; "state" not preceded by any address signal on the page → suspect (score cut); two adjacent MM/YYYY inputs after a date label → date-segmented pair; a text input inside a combobox wrapper → the combobox, not a free-text field.
- **Min-signal guard:** on pages where the user explicitly invoked the extension, classify everything; but fill-all is only offered when ≥ 3 fields classified (or ≥ 1 exact `autocomplete` match) — avoids proudly filling a search box.
- **Question matching:** long-label controls (label > ~60 chars or ends with "?") are treated as *questions*: matched against the answers bank via `AnswerEntry.patterns`, not the field taxonomy. Unmatched questions surface in the popover with palette search defaulted to the answers bank.

### 7.4 Fill mechanics (widget strategies)

A registry of named `Filler` strategies; profiles may reference them by name. All fills snapshot prior state for undo (§7.8).

- **`text`** (input/textarea): the native-setter trick so React/Vue/Ember-controlled inputs notice —

  ```js
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
  Object.getOwnPropertyDescriptor(window[proto.name].prototype, "value").set.call(el, value);
  el.dispatchEvent(new Event("input",  { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.dispatchEvent(new Event("blur",   { bubbles: true }));   // Workday commits on blur
  ```

- **`select`**: match option per §5.4, set `selectedIndex`, dispatch `input`+`change`.
- **`radio-group` / `checkbox`**: find the matching input by its own label; `.click()` it (fires the framework's handlers naturally).
- **`combobox` (typeahead)**: focus → type value via native setter + `input` events (per keystroke not needed; one shot then a settle wait) → await listbox options (MutationObserver, 2 s timeout) → click best text-match option. On timeout, leave text in place and drop to `suggest` ("pick from the site's list").
- **`listbox-button`** (Workday-style `button[aria-haspopup=listbox]`): click → await popup → click option by normalized text → verify button text changed.
- **`date-segmented`**: split the formatted date into the detected segment inputs (MM / YYYY / DD), each via `text` filler.
- **`contenteditable`**: focus, `document.execCommand("insertText", false, value)` (deprecated but universally supported); fallback set `textContent` + `input` event.
- **`file`**: §7.5.
- **Verification:** after every fill, read the value back; mismatch (site JS rewrote/cleared it) → mark the field's badge amber and keep it out of "done" count. No silent failures.

### 7.5 File attach (Firefox-specific, research-confirmed)

The one true Firefox trap: a `DataTransfer` created in the content-script compartment presents an **empty `files` list** to page JS. Create it in the page compartment via `wrappedJSObject`:

```js
function attachFileToInput(input, bytes, name, mime) {
  const file = new File([bytes], name, { type: mime, lastModified: Date.now() });
  const dt = new window.wrappedJSObject.DataTransfer();   // page compartment — required
  dt.items.add(file);
  input.files = dt.files;                                  // WebIDL setter through the Xray
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.dispatchEvent(new Event("input",  { bubbles: true }));
}
```

- Prefer this even when a dropzone is visible: most dropzones (Greenhouse, Lever `#resume-upload-input`, Ashby `#_systemfield_resume`) wrap a hidden real `<input type=file>` — find it and set `.files`.
- **Dropzone fallback** when no input exists or the app ignores `change`: synthesize `dragenter` → `dragover` → `drop` `DragEvent`s carrying the page-compartment `DataTransfer` at the dropzone element.
- Bytes arrive from the background as a `File` via structured-clone messaging (§6.2). React file inputs need no `nativeInputValueSetter` trick — that's for text inputs only.
- Known constraints to document in code comments: events are `isTrusted: false` (frameworks don't care; exotic anti-bot layers might); content scripts never run on Mozilla-protected domains or quarantined domains; min Firefox already ≥ all relevant platform bugs (input.files settable FF57+, DataTransfer ctor FF62+, drop-data bug fixed FF90).

### 7.6 Site profiles (declarative, data not code)

```jsonc
{
  "id": "workday",
  "profileVersion": 1,
  "match": {
    "urlPatterns": ["*://*.myworkdayjobs.com/*", "*://*.myworkdaysite.com/*"],
    "domProbe": "[data-automation-id^='formField-']"
  },
  "readiness": { "probe": "[data-automation-id^='formField-']", "settleMs": 300 },
  "fields": [
    { "selector": "input[data-automation-id='legalNameSection_firstName']",
      "key": "identity.firstName", "widget": "text" },
    { "selector": "button[data-automation-id='phone-device-type']",
      "key": "contact.phoneType", "widget": "listbox-button" },
    { "selector": "div[data-automation-id='resumeSection'] input[type='file']",
      "key": "documents.resume", "widget": "file" }
  ],
  "multiStep": { "rescan": "mutation" },
  "notes": "data-automation-id is Workday's stable contract; ids like input-4 are NOT stable"
}
```

- Profile match beats heuristics for its fields; unmatched fields on the same page still get heuristics (tenant-custom questions).
- Profiles ship **bundled** in `src/profiles/*.json` and load into the vault at install/update. (Optional later: signed remote profile-pack updates — data, not code, using the Ed25519 dataset pattern from expurge; flag for AMO-review sensitivity and keep bundled as the default path.)
- v1 ships the engine + one seed profile (Workday, from Appendix A) to prove the format. Full adapter pack = post-v1.

### 7.7 Site memory (local learning)

- Every user correction (via popover `map…`, or filling an unclassified field from the palette) records `{selectorFingerprint, canonicalKey}` into `vault.siteMemory[origin]` — same shape as a site profile, `id: "memory:<origin>"`.
- **Selector fingerprint strategy** (in order): stable attribute selector (`data-automation-id`, `name`, stable-looking `id` — reject UUID-ish/numeric-suffix ids) → `label`-text hash + widget kind → structural path (nth-of-type chain, last resort, marked fragile).
- On next visit, site memory applies exactly like a profile (and outranks the bundled profile on conflicts — the user's correction wins).
- Options page: per-origin viewer with edit/delete/export ("export as site profile JSON" → shareable contribution path for a future community pack).

### 7.8 Undo

- Per-fill snapshot: `WeakMap<Element, priorState>` (value / checked / selectedIndex / files-was-empty).
- Fill-bar Undo and `Ctrl+Z` (while overlay focused) restore all touched fields of the last action; per-field ✓ badge click reverts just that field. Snapshots die with the scan generation (SPA re-render invalidates them safely).

### 7.9 Safety rules

- **Deny-list** (never filled, never in fill-all; regexes in Appendix B): password, CAPTCHA/OTP/2FA, SSN / national ID / passport number, driver's license, bank/routing/card numbers, date of birth, mother's maiden name.
- **Sensitive-but-storable** (EEO self-ID, criminal disclosure, salary if the user marks it): excluded from fill-all; lock-badged; explicit per-field confirm popover; EEO storage itself is opt-in (§4.3).
- **No auto-submit**: the engine never clicks submit/next/continue buttons. (Profiles may *identify* nav buttons purely to improve step detection — never to click.)
- Overlay renders inside a **closed shadow root** with all styles inlined; the page can't restyle or (easily) spoof it. The content script holds the only reference.
- Everything the extension writes is visible on screen; no background/hidden filling of fields outside the viewport without scrolling them into view during fill-all.

### 7.10 Repeating sections ("Add another experience")

- **v1 (heuristic sites):** detect repeated homogeneous field groups (same-shaped label sets, e.g. two "Job title" fields); fill the *first empty group* with the next not-yet-used included experience (version order). The fill bar shows which experience is "next"; a dropdown overrides. The user clicks the site's own "Add" button between groups.
- **Post-v1 (profile sites):** profiles may declare `repeatSection` with an `addButton` selector so the flow becomes "fill group → user clicks Add → next group auto-proposed". Still no automated clicking.
- Resume-parse collision note: several ATS (Workday, iCIMS, Lever, Ashby) parse an uploaded resume and pre-fill or later overwrite history fields. Guidance in UI: attach file first, let the site parse, then fill/correct the remainder. Verification read-backs (§7.4) catch post-fill overwrites and re-flag fields.

---

## 8. Extension architecture

### 8.1 Contexts

| Context | Responsibilities |
|---|---|
| **Background (event page)** | `DataService` (vault CRUD, crypto, file store), site-profile registry, per-tab fill-session coordinator, command handling, injection, permission bookkeeping. Non-persistent: no in-memory state that can't be rebuilt from `storage.session`/`storage.local`. Firefox MV3 has **no service workers** — `background.scripts` + `"type": "module"` (declare `service_worker` too only if a Chrome port ever happens). |
| **Content script bundle** | Scanner, labeler, classifier, fillers, overlay + popover + palette UI (closed shadow root), site-memory capture. Injected on demand (`activeTab`) or via registered scripts on granted origins. |
| **Popup** | Site status, active-version switcher, `Fill this page` trigger, per-site enable/revoke (the only place `permissions.request` can run from a user gesture), cross-origin-iframe enable flow. |
| **Options page** | The full app: data editors, variant editor, version composer, answers bank, files manager, import/export, site memory viewer, settings (incl. future encryption toggle). |

### 8.2 Manifest (v1 sketch)

```json
{
  "manifest_version": 3,
  "name": "jobfill",
  "version": "0.1.0",
  "description": "Local-only resume storage and job application autofill. Your data never leaves your browser.",
  "background": { "scripts": ["background.js"], "type": "module" },
  "action": { "default_popup": "popup.html", "default_icon": "icons/32.png" },
  "options_ui": { "page": "options.html", "open_in_tab": true },
  "permissions": ["storage", "scripting", "activeTab"],
  "optional_host_permissions": ["<all_urls>"],
  "commands": {
    "_execute_action": { "suggested_key": { "default": "Alt+Shift+J" } },
    "open-palette":    { "suggested_key": { "default": "Alt+Shift+Space" },
                         "description": "Search snippets and fill the focused field" }
  },
  "browser_specific_settings": {
    "gecko": {
      "id": "jobfill@occamsgarage.com",
      "strict_min_version": "128.0",
      "data_collection_permissions": { "required": ["none"] }
    }
  }
}
```

Notes:

- **Zero install-time host permissions** → no scary warning; `storage`/`scripting`/`activeTab` are silent. `optional_host_permissions: ["<all_urls>"]` lets `permissions.request({origins: ["https://site/*"]})` grant any single origin later (FF 128+).
- Keyboard shortcuts grant `activeTab` (FF 63+), so the palette works on a fresh site with no grants at all.
- MV3 on AMO requires the explicit gecko `id`. `data_collection_permissions` is mandatory for new AMO submissions since Nov 2025 — `required: ["none"]` shows "no data transmission" at install, which is the product pitch in a badge.
- No `unlimitedStorage` (§6.2), no `tabs`, no `webNavigation` (iframe detection reads `iframe.src` from the DOM instead).

### 8.3 Messaging protocol

Typed request/response over `runtime.sendMessage` (discriminated unions in `shared/messages.ts`; every handler validates payloads — content scripts run in hostile pages):

```ts
type Req =
  | { t: "vault.get" }                                    // → redacted-for-context Vault slice
  | { t: "vault.patch"; ops: PatchOp[] }
  | { t: "snippets.search"; q: string; scope?: "all" | "answers"; limit?: number }
  | { t: "version.list" } | { t: "version.setActive"; id: string }
  | { t: "compose"; key: CanonicalKey; opts?: ComposeOpts }   // → { value, alternates[] }
  | { t: "file.get"; fileId: string }                     // → File (structured clone; Firefox)
  | { t: "siteMemory.get"; origin: string }
  | { t: "siteMemory.record"; origin: string; mapping: FieldMapping }
  | { t: "fillSession.state"; tabId?: never }             // background derives tab from sender
  | { t: "profiles.match"; url: string };                 // → SiteProfile | null
```

- Composition (§5) runs in the background (it needs the whole vault); the content script asks `compose` per field and caches per scan generation.
- The palette streams `snippets.search` as the user types (debounced 80 ms).
- Origin checks: background verifies `sender` (tab id, frame id, origin) on every site-scoped call; site memory is keyed by the *sender frame's* origin, not the top tab's.

### 8.4 Injection flow

1. User invokes (toolbar/shortcut) → background has `activeTab`.
2. `scripting.executeScript({ target: { tabId, allFrames: true }, files: ["content.js"] })` — cross-origin frames fail silently under `activeTab` (same-origin only); results report which frames loaded.
3. Content bundle is idempotent (guard on a module-scope flag); re-invoke = re-scan + reopen overlay.
4. On granted origins, `scripting.registerContentScripts` (`persistAcrossSessions: true`, `runAt: "document_idle"`, `allFrames: true`) auto-injects; the overlay stays collapsed until fields are found (a quiet corner chip, not a takeover).

---

## 9. Import/export & the AI import skill

### 9.1 The interchange format

One JSON format for import, export, and the AI skill's output: essentially `Vault` minus `settings`/`siteMemory`, plus optional inline file bytes:

```jsonc
{
  "$schema": "https://occamsgarage.com/jobfill/import.schema.json",  // served copy of ai/import.schema.json
  "schemaVersion": 1,
  "profile": { /* §4.3 */ },
  "work": [ /* §4.2 */ ],
  "education": [], "projects": [], "certifications": [], "answers": [],
  "versions": [ /* optional; a default is synthesized if absent */ ],
  "files": [ { "kind": "resume", "name": "resume.pdf", "mime": "application/pdf",
               "base64": "..." } ]        // optional; ids assigned on import
}
```

- Formal JSON Schema lives at `ai/import.schema.json` (draft 2020-12), generated from the TS types; it is the contract the AI skill validates against.
- Ids in import files are optional — the importer assigns UUIDs and resolves `defaultVariantId` by position when omitted (first variant is default). This keeps hand- and AI-authored files forgiving.

### 9.2 Import UX

- Options → Import: file picker → schema validation (ajv, bundled) → **dry-run diff screen**: entities grouped as *new / updated / conflicting / unchanged*, with per-group accept toggles. Merge strategies: `replace all` (backup-first prompt), `merge-add` (default; never deletes), `update-matching` (match work entries by company+title+startDate).
- Validation errors render with JSON paths and human text — the file usually comes from an AI; make fixing it easy (copy error report button, designed to be pasted back to the AI).

### 9.3 The Claude skill (`ai/` directory — the "AI users" deliverable)

Shipped in-repo so AI-tooling users get a first-class onboarding path while the extension stays AI-free:

- **`ai/SKILL.md`** — a Claude skill ("jobfill-import"): given resume file(s) (PDF/DOCX/MD), an optional LinkedIn export, and optional old cover letters, produce a valid `import.json`. Skill instructions (summarized; the file is the real spec):
  1. Extract atoms faithfully — no invented employers, dates, degrees, or metrics; unknown → omit and list as an open question, never guess.
  2. For each work summary and bullet, write 3 variants: `impact` (metric-forward, strongest true claim the source supports), `responsibilities` (duty-phrased, for gov/Workday-style forms), `short` (≤ 140 chars). Preserve the user's original phrasing as a 4th variant labeled `original` when it differs.
  3. Interview the user for gaps that forms will demand (phone country code, address granularity, work-authorization/sponsorship/relocation answers, salary handling). One question round, batched.
  4. Never populate EEO entries unless the user explicitly provides them after the skill notes they're optional and sensitive.
  5. Validate against `import.schema.json` (run ajv via the environment if available; otherwise structural self-check) and emit `import.json` + a one-paragraph summary of what was extracted and what was left open.
- **`ai/PROMPT.md`** — the same procedure as a portable copy-paste prompt for users of any chatbot (no skill machinery), instructing the model to output only the JSON.
- **`ai/examples/`** — a fictional worked example: `sample-resume.md` → `sample-import.json` (doubles as a schema test fixture).

---

## 10. Tech stack & repo layout

### 10.1 Stack

- **TypeScript, strict** (consistent with expurge). Target `es2022`, ESM throughout.
- **Bundler:** Vite (or esbuild directly) with `web-ext` for run/lint/sign. **AMO source-submission rule:** any minified upload requires submitting source + a reproducible build README (exact Node/npm versions, `npm ci && npm run build`, committed lockfile). Alternative: ship unminified (bundled but not mangled) and skip the source-submission dance — recommended for v1; sizes are trivial.
- **UI:** Preact + signals (small, no runtime surprises) for options/popup; the in-page overlay/palette is hand-rolled DOM in the closed shadow root (keep the injected bundle lean and dependency-light; no framework in content scripts).
- **Validation:** ajv (bundled, also used at runtime for import) + `ajv-formats`.
- **Lint/format:** eslint + typescript-eslint + prettier. `web-ext lint` (addons-linter) in CI.
- **Polyfill note:** none needed — Firefox-only v1 uses `browser.*` natively. If a Chrome port ever lands, add `webextension-polyfill` then, not now.

### 10.2 Repo layout

```
jobfill/
├── SPEC.md                      # this file
├── manifest.json
├── src/
│   ├── background/
│   │   ├── index.ts             # message router, command handling, injection
│   │   ├── data-service.ts      # vault CRUD + codec boundary
│   │   ├── codecs.ts            # PlainCodec, AesGcmCodec
│   │   ├── file-store.ts        # IndexedDB blobs
│   │   ├── compose.ts           # §5 composition (background side)
│   │   └── profiles.ts          # bundled profile registry + match
│   ├── content/
│   │   ├── index.ts             # bootstrap, idempotence guard, session state
│   │   ├── scan.ts              # §7.1 discovery (DOM adapters)
│   │   ├── label.ts             # §7.2 signal gathering
│   │   ├── fillers/             # §7.4–7.5 one module per widget strategy
│   │   ├── overlay/             # fill bar, badges, popover, palette (shadow root)
│   │   └── site-memory.ts       # fingerprinting + correction capture
│   ├── shared/
│   │   ├── types.ts             # §4 data model
│   │   ├── messages.ts          # §8.3 protocol
│   │   ├── classify.ts          # §7.3 pure classifier (unit-tested hard)
│   │   ├── rules/               # Appendix B seed tables as data
│   │   ├── format.ts            # §5.2 formatters
│   │   └── schema/              # generated JSON Schema
│   ├── options/                 # Preact app
│   ├── popup/
│   └── profiles/                # workday.json (v1 seed), + future pack
├── ai/
│   ├── SKILL.md
│   ├── PROMPT.md
│   ├── import.schema.json
│   └── examples/
├── fixtures/                    # saved ATS form HTML (see §11 note on provenance)
├── tests/
│   ├── unit/                    # classifier, formatters, compose, codecs, fingerprints
│   ├── harness/                 # local test pages (React-controlled inputs, dropzone, etc.)
│   └── e2e/                     # Playwright + Firefox against harness pages
└── package.json / tsconfig.json / web-ext config / CI
```

---

## 11. Testing strategy

1. **Classifier corpus tests (highest value).** `fixtures/` holds labeled cases: HTML fragments (field + surrounding markup) + expected canonical key. Sources: hand-built minimal cases per rule; saved markup from real ATS pages for regression (keep fixtures private/gitignored if reproducing proprietary markup verbatim is a concern; a sanitized structural copy is usually enough). Every classifier bug fix adds a fixture. Track precision per key; changes that drop scores fail CI.
2. **Formatter/composer unit tests.** Dates, phones, name joins, length-budget behavior (short-variant fallback → bullet dropping → word-boundary truncation), choice matching synonyms.
3. **Codec tests.** Round-trip plaintext and AES-GCM (wrong passphrase, tampered ciphertext → clean errors, no partial state).
4. **Harness e2e (Playwright, Firefox channel).** Local pages replicating the hard mechanics with zero ATS dependence: React 18 controlled inputs, react-dropzone file upload, `button[aria-haspopup=listbox]` widget, MM/YYYY segmented dates, shadow-DOM form, same-origin iframe form, a MutationObserver-hostile late-mounting form. E2E asserts fills land, events fire (page-side listeners record them), undo restores, file attach produces a real `File` in page JS.
5. **Import pipeline tests.** `ai/examples/sample-import.json` validates against the schema; importer merge strategies covered; malformed files produce path-precise errors.
6. **Manual QA checklist** for live ATS (not automated — ToS + flakiness): a Workday sandbox posting, a Greenhouse/Lever public posting, one bespoke small-company form. Run before each release; results logged in `docs/qa-log.md`.
7. **`web-ext lint`** + a CI job that builds the zip and diffs it for unexpected remote-URL strings (belt-and-suspenders for the local-only claim).

---

## 12. Milestones

Ordered for demoable value; each lands green on CI.

| # | Milestone | Contents | Exit criteria |
|---|---|---|---|
| M0 | Scaffold | Repo, manifest, build, CI, empty options/popup, injection round-trip | `web-ext run` shows overlay chip on invoke |
| M1 | Data core | §4 types, DataService, PlainCodec + AesGcmCodec (no UI toggle yet), file store, options editors (profile, work + variant editor, answers), import/export JSON + dry-run diff | Enter data manually; export→wipe→import round-trips |
| M2 | Fill engine v0 | Scanner, labeler, classifier + seed rules, `text`/`select`/`radio`/`checkbox` fillers, popover, fill bar, fill-all + review + undo, palette (incl. "save what I typed") | Fills the harness pages and a real bespoke form end-to-end via popover/palette |
| M3 | Files | File manager UI, version↔file linking, `attachFileToInput` + dropzone fallback, popup attach flow | Resume lands in react-dropzone harness + one real site |
| M4 | Site memory + profiles | Correction capture, fingerprinting, per-origin apply, profile engine + Workday seed profile, popup grant/revoke + registered scripts, cross-origin iframe flow | Second visit to a corrected site classifies right; Workday demo posting fills |
| M5 | Versions & composition | Version composer UI, stylePriority resolution, renderers + length budgets, derived formats in popover switcher | Switch versions → different summaries/files fill on same form |
| M6 | Hardening & ship | Safety rules audit (§7.9), a11y pass on overlay (focus traps, ARIA), empty/error states, reproducible-build or unminified packaging, AMO listing + `data_collection_permissions`, README + `ai/` deliverables | AMO submission accepted |

**Post-v1 (rough order):** encryption settings UI + unlock flow (codec already shipped) · ATS profile pack from Appendix A (Greenhouse legacy+React, Lever, Ashby, iCIMS, Taleo) · repeat-section profile automation (§7.10) · sidebar review panel (`sidebar_action`) for long forms · community profile-pack format + signed remote data updates (expurge pattern) · Chrome port (swap file transport to base64, `service_worker` background, polyfill) · cover-letter per-version overrides.

---

## 13. Risks & open questions

| Risk | Mitigation |
|---|---|
| ATS DOM churn breaks profiles (LinkedIn fastest; Greenhouse legacy→React migration means two live generations) | Profiles are data (ship updates cheaply); heuristics + site memory as fallback; verification read-backs surface breakage honestly |
| Synthetic events flagged by anti-bot layers (`isTrusted: false`) | User-invoked, human-paced, no auto-submit; no confirmed ATS rejections in research — accept residual risk, document it |
| Cross-origin iframe grant friction confuses users | Explicit fill-bar explainer + one-click popup flow (§3.9); worst case palette + copy |
| Firefox quarantined domains can block non-recommended extensions on specific sites | Detect injection failure and say so plainly; nothing else to do |
| Event-page suspension loses in-memory state | All session state in `storage.session`; rebuild-on-wake is a design rule (§8.1) |
| AMO review friction (form-writing on arbitrary sites) | Zero install-time host permissions, `none` data collection, unminified build, honest listing copy |
| Repeating sections are genuinely hard on unknown sites | v1 scope honesty: first-empty-group heuristic + user-driven adds (§7.10) |
| EEO/sensitive data stored locally still feels risky to some users | Opt-in storage, sensitive flags, fill-all exclusion, encryption option, plain-language threat model (§6.3) |

Open questions (decide during build, none block M0–M2):

1. Name. `jobfill` is a placeholder — check AMO/npm collisions before listing.
2. Does the palette need a per-field "copy" affordance on deny-listed fields (e.g. user wants their own SSN typed elsewhere)? Current answer: no — deny-listed means untouched.
3. Ship `answers.salaryExpectation` as sensitive-by-default? Leaning yes (excluded from fill-all until the user unmarks it).
4. Store title variants per experience (§4.2) or promote titles to full snippets? Start with `Variant[]`, promote if the editor UX wants more.
5. i18n: v1 English-only (classifier rules are English); architecture keeps rule tables per-locale-loadable for later.

---

## Appendix A: ATS reference

Seed data for future site profiles, condensed from primary research (Sep 2026). Confidence: ✓ verified against live pages/fixtures/working automation code · ~ multiple secondary sources agree · ? verify against live DOM before shipping a profile. **All hashed/CSS-module class names are unstable by definition — never fingerprint on them.**

### Workday ✓

- **URLs:** `{tenant}.{wdN}.myworkdayjobs.com/...`, `{wdN}.myworkdaysite.com/.../recruiting/{tenant}/{site}/...`; internal JSON at `{origin}/wday/cxs/{tenant}/{site}/jobs`.
- **Fingerprint:** pervasive `data-automation-id`; field wrappers `[data-automation-id^="formField-"]`. This attribute is Workday's stable contract (years-stable); element `id`s (`input-4`) are not.
- **Key selectors:** names `legalNameSection_firstName/lastName`; address `addressSection_addressLine1/city/postalCode`, country/state as `button[data-automation-id='addressSection_countryRegion']`; phone `phone-number`, type `phone-device-type` (listbox button), code `country-phone-code`; work exp `jobTitle/company/location`, `textarea[data-automation-id='description']`, `currentlyWorkHere`, panels `workExperience-N`, add `button[data-automation-id='Add'|'Add Another']`; education `school/degree/fieldOfStudy/gpa`; resume `div[data-automation-id='resumeSection'] input[type=file]` (dropzone wrapper `file-upload-drop-zone`); LinkedIn `linkedinQuestion`; nav `bottom-navigation-next-button`; errors `errorBanner`; cookie banner `legalNoticeAcceptButton`.
- **Quirks:** multi-step wizard, re-render per step; no native `<select>` — `button[aria-haspopup=listbox]` everywhere; boolean questions = 2-radio groups in `formField-` wrappers; tenant-custom questions have no semantic automation-id (label text is the portable signal); dates via segmented `MM/YYYY` or spinner widgets; React — native-setter + blur required; account wall precedes application.

### Greenhouse — legacy hosted ✓

- **URLs:** `boards.greenhouse.io/{token}/jobs/{id}` (EU variant); embedded via `iframe#grnhse_iframe`.
- **Fields:** stable ids `#first_name #last_name #email #phone`; `#job_application_location` (Places-backed `<auto-complete>`); resume/cover `input[type=file][id*='resume'|'cover']` in `div[class*=drop-zone]`, paste variants `#resume_text #cover_letter_text`; custom questions `question_{n}`; EEO `job_application[gender|hispanic_ethnicity|race|veteran_status|disability_status]`; select2 dropdowns; MM/YYYY placeholder pairs.
- **Bonus:** public Job Board API returns each posting's exact field inventory (`boards-api.greenhouse.io/v1/boards/{token}/jobs/{id}?questions=true`) — a profile could classify from the API without scraping (still a network call — keep optional/off by default given the local-only stance; decide at profile-pack time).
- Server-rendered; direct value setting works. Main hazards: the cross-origin embed iframe and CAPTCHA on submit.

### Greenhouse — React boards ✓/~

- **URLs:** `job-boards.greenhouse.io/{token}/jobs/{id}` (+EU). Both generations are live in the wild — profiles must branch on host.
- Wrappers: `div.text-input-wrapper`, dropdowns `div.select` + `button[aria-label='Toggle flyout']`, `div.file-upload`, `fieldset.checkbox`; core ids persist (`first_name`…); labels properly associated. React-controlled; readiness probe `main form:has(input[type='file'])`.

### Lever ✓

- **URLs:** `jobs.lever.co/{company}/{uuid}[/apply]`. Server-rendered `form#application-form`; the easiest major ATS.
- **Fields:** single full-name `input[name='name']` (join first+last!), `email`, `phone`, `org`; `data-qa` attributes throughout (`resume` → `input#resume-upload-input[name='resume']`, hidden behind styled dropzone — set `.files` directly); links `urls[LinkedIn]`, `urls[GitHub]` (spelling varies — match loosely), `urls[Portfolio]`; custom questions `cards[{uuid}][fieldN]` with a **hidden input carrying the card's JSON schema** (parse it instead of scraping labels); EEO `eeo[gender|race|veteran]`; cover letter `textarea[name='comments']`.
- hCaptcha gates submit; resume upload triggers server-side parse that may overwrite name/email after a delay.

### Ashby ✓

- **URLs:** `jobs.ashbyhq.com/{org}/{jobId}[/application]` (never run on `app.ashbyhq.com` — that's the recruiter side). React SPA in `#root`; JSON-LD JobPosting in head survives hydration.
- **Fields:** system fields stable — `#_systemfield_name/email/resume/location`, education `#_systemfield_education_history-*`; custom questions get raw UUID ids (label is the only signal); comboboxes `input[role=combobox][aria-autocomplete=list]`; Yes/No = two buttons + hidden checkbox (click the button); semantic classes `ashby-application-form-*` stable, hashed classes churn every deploy; reCAPTCHA present; separate "Autofill from resume" dropzone may collide — attach-first guidance applies.

### iCIMS ~/? · Taleo ✓/? · Oracle Recruiting Cloud ✓(URL)/?

- **iCIMS:** `{tenant}.icims.com/jobs/...`; embeds as `iframe#icims_content_iframe` (top URL is the employer's domain — detect by frame URL); `iCIMS_`-prefixed classes; login wall, resume-parse step, multi-step with full server round-trips (re-scan per step); per-tenant field attrs — treat as label-driven generic.
- **Taleo:** `{tenant}.taleo.net/careersection/...` `.ftl` pages, full page reloads, verbose per-tenant JSF ids but proper `<label for>` — label-driven; account wall, session timeouts, up to 10 indexed history blocks.
- **Oracle Recruiting Cloud:** `{pod}.fa.oraclecloud.com/hcmUI/CandidateExperience/.../job/{id}`; React SPA; field conventions undocumented — generic handling.

### SmartRecruiters ? · BambooHR ✓(shell)/? · JazzHR ✓

- **SmartRecruiters:** postings `jobs.smartrecruiters.com/{Company}/{id}-slug`, apply `.../oneclick-ui/...`; React SPA, email-first flow, no public selector inventory.
- **BambooHR:** `{company}.bamboohr.com/careers/{id}`; SPA shell (client-rendered); `/careers/{id}/detail` JSON lists the configured application fields (~) — could inform classification (same optional-network caveat as Greenhouse API).
- **JazzHR:** `{company}.applytojob.com/apply/...`; server-rendered single page, underscore names (`first_name` ~), no login; simplest target after Lever.

### LinkedIn Easy Apply ✓ (high churn) · Indeed ~

- **LinkedIn:** modal `.jobs-easy-apply-modal`; input ids follow `{widget}-form-component-formElement-…easyApplyFormElement…` grammar; upload `input[type=file][id*='jobs-document-upload']`; multi-step modal; **selector churn is the fastest of any ATS, and automation violates LinkedIn ToS** — if a profile ships at all, fill-on-user-action only (which is our only mode anyway) and expect breakage.
- **Indeed:** apply flow on `smartapply.indeed.com` (SPA, login-gated, no stable public inventory).

---

## Appendix B: Classifier seed data

### B.1 `autocomplete` token → canonical key (authoritative fast path)

```
name→identity.fullName · given-name→identity.firstName · additional-name→identity.middleName
family-name→identity.lastName · honorific-prefix→identity.honorific · honorific-suffix→identity.suffix
email→contact.email · tel→contact.phone(e164) · tel-national→contact.phone(national)
tel-country-code→contact.phoneCountryCode
street-address→address.full · address-line1/2/3→address.line1/2/(2)
address-level1→address.state · address-level2→address.city · postal-code→address.postalCode
country→address.country(code) · country-name→address.country
organization→work[0].company · organization-title→work[0].title · url→links.website
```

Reality check from research: major ATS mostly *don't* set `autocomplete` (Workday/Ashby/LinkedIn use their own attribute systems) — this is a fast path, not the main path. Conversely, **emit** correct tokens in our own options-page forms.

### B.2 Heuristic regex seeds (haystack = canonicalized label+name+id+placeholder+nearby)

Derived from Chromium `legacy_regex_patterns.json` / Firefox `HeuristicsRegExp` (marked C/F) plus job-application-specific additions (marked J). Each rule: positive regex, optional negative regex.

| Key | Positive (abridged) | Negative | Src |
|---|---|---|---|
| identity.firstName | `first.*name\|given.*name\|fname\|first$` | `last` | C |
| identity.lastName | `last.*name\|surname\|family.*name\|lname\|last$` | `surname\d` | C |
| identity.fullName | `^name$\|full.?name\|your.?name\|legal.?name` | `user.?name\|company\|file` | C+J |
| contact.email | `e.?mail` | `confirm` (→ same value, second fill) | C |
| contact.phone | `phone\|mobile\|contact.?number\|cell` | `type\|country.?code\|extension` | C+J |
| address.line1 | `^address$\|address.?line.?(1\|one)?$\|street\|addr1` | `email\|address.?line.?2` | C |
| address.city | `city\|town\|suburb` (guard against `capacity` etc. via word boundaries) | | C |
| address.state | `state\|province\|region\|county` | `united.?state\|statement` | C |
| address.postalCode | `zip\|postal.?code\|postcode` | | C |
| address.country | `country\|nation(?!ality)` | `country.?code` | C+J |
| links.linkedin | `linked.?in` | | J |
| links.github | `git.?hub` | | J |
| links.portfolio/website | `portfolio\|website\|personal.?site\|url` | `linkedin\|github` | J |
| work[i].company | `company\|employer\|organi[sz]ation\|business` | `title\|description\|url` | C+J |
| work[i].title | `job.?title\|^title$\|position\|role` | `honorific` | C+J |
| work[i].summary | `responsibilit\|duties\|describe.*(role\|work)\|accomplishment\|impact` | | J |
| work[i].startDate/endDate | `start\|from\|end\|to\|until` + date-widget shape | | J |
| education[i].school | `school\|university\|college\|institution\|alma` | | J |
| education[i].degree | `degree\|qualification\|diploma` | `field` | J |
| education[i].field | `field.?of.?study\|major\|discipline\|concentration` | | J |
| education[i].gpa | `gpa\|grade.?point` | | J |
| summary | `professional.?summary\|about.?(you\|yourself)\|objective\|bio` | | J |
| coverLetter.text | `cover.?letter\|why.*(join\|work\|interested)\|motivation` | | J |
| documents.resume | `resume\|c\.?v\.?\|curriculum` + widget=file | `cover` | J |
| documents.coverLetter | `cover.?letter` + widget=file | | J |
| skills | `^skills?$\|technical.?skills\|technologies` | | J |
| answers.salaryExpectation | `salary\|compensation\|pay.?(expectation\|range)\|desired.?pay` | | J |
| answers.workAuthorization | `authoriz\|legally.*work\|right.?to.?work\|eligib.*work` | | J |
| answers.sponsorship | `sponsor` | | J |
| answers.noticePeriod | `notice.?period\|availability\|available.*start\|start.?date` (question context) | | J |
| answers.howDidYouHear | `how.?did.?you.?hear\|referr?al.?source\|source` | | J |
| answers.relocation | `relocat\|willing.*move` | | J |
| answers.remotePreference | `remote\|work.?from.?home\|hybrid\|on.?site` (question context) | | J |
| eeo.* [sensitive] | `gender\|race\|ethnic\|veteran\|disabilit\|hispanic\|latino` | | J |

Anti-pattern guard (Chromium's `NAME_IGNORED`, adopt wholesale): `user.?name|user.?id|nickname|maiden.?name|login|password|title(?!.*job)|prefix|suffix` prevents identity rules from grabbing account-creation fields — important because Workday/Taleo/iCIMS front the application with account signup forms.

### B.3 Deny-list (tier `skip`)

```
password · captcha|recaptcha|hcaptcha · one.?time|otp|2fa|verification.?code
ssn|social.?security · national.?id|passport|driver.?s?.?licen[cs]e
date.?of.?birth|birth.?date|dob · mother.?s.?maiden
bank|routing|iban|swift|card.?number|cvv|cvc
```

(DOB is deny-listed for filling, not for storage — nothing stores it either; some ATS ask post-offer, which is out of scope.)

### B.4 Combobox / custom-widget detection cues

Any of: `role=combobox` · `aria-haspopup=listbox|menu` · `aria-autocomplete=list|both` · `aria-expanded` present · `aria-controls`/`list` attr → treat as `combobox`/`listbox-button`, never plain text. Radio-pair booleans: `fieldset`/wrapper containing exactly 2 radios with yes/no-ish labels.

---

## Appendix C: Sources

Key primary sources behind the platform and ATS claims (retrieved Sep 2026):

- MDN WebExtensions: Background scripts; `host_permissions` / `optional_permissions` / `permissions.request`; `storage.local` / `storage.session`; `scripting.executeScript`; Content scripts; `Element.openOrClosedShadowRoot`; `commands`; `sidebarAction`; Chrome incompatibilities (structured-clone messaging). — developer.mozilla.org
- Extension Workshop: Add-on Policies (no remote code); Source Code Submission (reproducible builds); Firefox built-in data consent (`data_collection_permissions`, required for new submissions since 2025-11-03); Request the right permissions. — extensionworkshop.com
- Mozilla Add-ons Blog: MV3/MV2 March 2024 update (MV2 support continues); unified extensions button & MV3 host-permission handling; data-collection consent rollout (Oct 2025). — blog.mozilla.org/addons
- Bugzilla: 1384030 (`input.files` settable, FF57); 1351193 (DataTransfer constructor, FF62); 1707214 (drop `files` null bug, fixed FF90); 1915688 (`storage.session` 10 MB enforcement, FF137); 1736575 (`world: MAIN`, FF128); 1573659 (no background service workers).
- Mozilla Discourse: "Simulating drop event doesn't work in Firefox add-on but works in Chrome extension" — the page-compartment `DataTransfer` fix (§7.5), author-confirmed.
- Chromium autofill: `components/autofill` README + `form_parsing/` + `legacy_regex_patterns.json`; Firefox `toolkit/components/formautofill/shared/HeuristicsRegExp.sys.mjs`. WHATWG HTML autofill token spec.
- ATS field data: open-source autofill/apply projects (berellevy/job_app_filler, ritsth/job-autofill-extension, Kaitzz/Auto-Apply-Helper, Liam-Frost/AutoApply, Masterjx9/OpenPostings URL→ATS table, rpeng220/kaleidoscope, saved Lever/Ashby production fixtures), Greenhouse Job Board API docs, Ashby application-form/embed docs, Indeed Apply partner docs, live JazzHR/BambooHR boards.

*(Full URL list preserved in the research notes; re-verify churn-prone ATS selectors against live DOM before building each profile.)*

