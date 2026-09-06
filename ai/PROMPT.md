# jobfill import prompt (portable)

Copy everything below the line into any capable AI chat, attach your resume file(s) (PDF,
DOCX, or Markdown — plus optionally a LinkedIn export and old cover letters), and paste the
JSON it returns into jobfill's **Options → Import / Export → Import**.

---

You are converting a resume into `import.json` for **jobfill**, a local-only Firefox
extension that stores structured resume data and autofills job applications. Follow this
procedure exactly.

## Rules

1. **Extract atoms faithfully.** Never invent employers, dates, titles, degrees, or metrics.
   If something is unknown or ambiguous, omit it and list it under "Open questions" at the
   end — do not guess.
2. **Write variant phrasings.** For each work summary and each bullet, produce up to 4
   variants of the same fact:
   - `impact` — metric-forward; the strongest TRUE claim the source supports.
   - `responsibilities` — duty-phrased ("Responsible for…"), for government/Workday-style forms.
   - `short` — ≤ 140 characters.
   - `original` — the user's own phrasing, only when it differs from the above.
3. **Interview once, batched.** Before emitting JSON, ask ONE round of questions covering
   the gaps application forms will demand: phone country code, address granularity (city/state
   at minimum), work-authorization / sponsorship / relocation answers, and how to handle
   salary questions. Then emit.
4. **Never populate EEO entries** (gender, race, ethnicity, veteranStatus, disabilityStatus)
   unless the user explicitly provides them after you note they are optional and sensitive.
5. **Validate before emitting.** The output must conform to the schema at
   `ai/import.schema.json` in the jobfill repo (JSON Schema draft 2020-12). If you can run
   a validator, do; otherwise self-check the structure against the shape notes below. Then
   output ONLY the JSON (no prose around it), followed by a one-paragraph summary of what
   was extracted and what was left open.

## Shape notes (abbreviated — the schema is authoritative)

```jsonc
{
  "schemaVersion": 1,
  "profile": {
    "identity": { "firstName": "…", "lastName": "…" },          // required
    "contact": { "email": "…", "phone": { "countryCode": "1", "national": "6165550100" } }, // required
    "address": { "city": "…", "state": "…", "postalCode": "…", "country": "…" },
    "links": { "linkedin": "https://…", "github": "https://…" },
    "summary": { "variants": [{ "style": "impact", "text": "…" }, { "style": "responsibilities", "text": "…" }, { "style": "short", "text": "…" }] },
    "skills": ["…"]
  },
  "work": [{
    "company": "…", "title": "…",
    "startDate": "2022-03",                                      // always YYYY-MM
    "endDate": "2024-01",                                        // omit if current
    "current": false,
    "summary": { "variants": [ /* impact, responsibilities, short */ ] },
    "bullets": [{ "label": "short handle", "tags": ["…"], "variants": [ /* … */ ] }]
  }],
  "education": [{ "school": "…", "degree": "B.S.", "field": "…", "endDate": "2017-04", "current": false }],
  "projects": [], "certifications": [],
  "answers": [{
    "key": "sponsorship",                                        // wellKnown key when one fits
    "question": "Will you now or in the future require sponsorship?",
    "patterns": ["sponsor"],                                     // regex fragments for matching site questions
    "kind": "boolean", "value": false,
    "choiceSynonyms": ["No", "I will not require sponsorship"],
    "sensitive": false
  }]
}
```

Well-known answer keys: `workAuthorization`, `sponsorship`, `relocation`, `remotePreference`,
`salaryExpectation`, `noticePeriod`, `earliestStart`, `howDidYouHear`, `referralName`,
`over18`, `previouslyEmployedHere`, `criminalDisclosure`, plus the EEO keys (rule 4) and
`pronouns`. Ids are optional everywhere — jobfill assigns them on import. Dates are always
`"YYYY-MM"`.
