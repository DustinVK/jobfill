---
name: jobfill-import
description: >
  Convert resume file(s) (PDF/DOCX/MD), an optional LinkedIn export, and optional old cover
  letters into a valid import.json for the jobfill Firefox extension. Use when the user wants
  to onboard their resume into jobfill or produce/repair a jobfill import file.
---

# jobfill-import

Produce an `import.json` that validates against `ai/import.schema.json` (JSON Schema
draft 2020-12, in this directory) from the user's resume materials. jobfill itself is
local-only and never calls an AI — this skill is the onboarding path.

## Procedure

1. **Read the inputs.** Resume file(s) first; LinkedIn export and cover letters fill gaps.
   Extract atoms faithfully — no invented employers, dates, degrees, titles, or metrics.
   Anything unknown is omitted and listed as an open question at the end. Never guess.

2. **Write variants** for every work summary and bullet — the same fact, up to 4 phrasings:
   - `impact`: metric-forward, the strongest true claim the source supports;
   - `responsibilities`: duty-phrased, for gov/Workday-style forms;
   - `short`: ≤ 140 chars (many ATS fields have maxlength);
   - `original`: the user's own phrasing as a 4th variant when it differs.
   Give bullets a short `label` (palette search handle) and lowercase topic `tags`.

3. **Interview for form-critical gaps — one batched round.** Ask about: phone country code;
   address granularity (city/state minimum — many forms require them); work authorization,
   sponsorship, relocation, remote preference (boolean answers with `choiceSynonyms` like
   "No, I will not require sponsorship"); notice period / earliest start; how to handle
   salary questions (stored value + whether to keep it `sensitive`). Also cover letters:
   if one was provided, store it as `profile.coverLetter` with variants.

4. **EEO stays empty** unless the user explicitly provides those answers after you note
   they are optional, sensitive, and excluded from autofill. Never transcribe EEO data
   from documents unprompted.

5. **Validate, then emit.** If ajv (or any 2020-12 validator) is available in the
   environment, run it against `ai/import.schema.json`; otherwise structurally self-check
   (required: `schemaVersion: 1`, `profile.identity.firstName/lastName`, `profile.contact.
   email/phone`; all dates `YYYY-MM`; every snippet ≥ 1 variant). Emit `import.json` as a
   file (or a single JSON code block), plus a one-paragraph summary: what was extracted,
   how many variants written, and the open questions.

## Conventions

- Ids are optional everywhere; jobfill assigns UUIDs on import (first variant = default).
- `answers[].patterns` are lowercase regex fragments matched against site question text
  ("sponsor", "notice.?period", "legally.*work").
- `versions` may be omitted (a default is synthesized) or include e.g. an
  "Impact-focused" (`stylePriority: ["impact", "short"]`) and a
  "Responsibilities (gov/Workday)" (`["responsibilities", "long"]`) pair.
- A resume file can be embedded in `files[]` as base64 with `kind: "resume"` — offer it,
  but only embed when the user wants the PDF stored in jobfill too.
- The worked example in `ai/examples/` (`sample-resume.md` → `sample-import.json`) shows
  the expected fidelity.
