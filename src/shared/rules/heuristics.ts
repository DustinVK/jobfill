/**
 * SPEC Appendix B.2: heuristic regex seeds, encoded as data. Sources: Chromium
 * legacy_regex_patterns.json / Firefox HeuristicsRegExp (C/F) + job-application-specific
 * additions (J). Every rule: positive regex, optional negative regex, per-key notes.
 *
 * All regexes run against the canonicalized haystack of ONE signal at a time (lowercased,
 * whitespace/punctuation collapsed) — never the concatenation of all signals, so a page
 * with "first name" in a label and "company" in nearby text can't self-contradict.
 */
import type { CanonicalKey } from '../types.js';

export interface HeuristicRule {
  key: CanonicalKey;
  positive: RegExp;
  negative?: RegExp;
  /**
   * Rule only applies to these widget groups (e.g. documents.* only makes sense for file
   * inputs). Undefined = any widget.
   */
  widgets?: readonly ('file' | 'multiline' | 'singleline' | 'choice')[];
  /** Question-context rules only fire for long/question-shaped labels (SPEC §7.3). */
  questionContext?: boolean;
  /** Rule only applies to date-shaped inputs (MM/YYYY placeholder, type=month/date…). */
  dateShape?: boolean;
}

// Word-ish boundaries: the haystack is space-separated words after canonicalization.
const rules: HeuristicRule[] = [
  // --- identity (C) ---------------------------------------------------------
  {
    key: 'identity.firstName',
    positive: /first ?name|given ?name|fname|\bfirst\b|forename/,
    negative: /last|family|first ?(year|date|month|day|time)/,
  },
  {
    key: 'identity.lastName',
    positive: /last ?name|surname|family ?name|lname|\blast\b/,
    // "last year"/"last updated" etc. are dates, not names (live education-form bug).
    negative: /surname\d|last ?(year|date|month|day|time|updated|used|login|visit)/,
  },
  {
    key: 'identity.fullName',
    positive: /^name$|full ?name|your ?name|legal ?name|complete ?name/,
    negative: /user ?name|company|file|first|last|middle/,
  },
  { key: 'identity.middleName', positive: /middle ?name|\bmi\b|middle ?initial/ },
  { key: 'identity.preferredName', positive: /preferred ?name|nick ?name|known ?as|go ?by/ },
  { key: 'identity.pronouns', positive: /pronouns?/ },

  // --- contact (C) ----------------------------------------------------------
  { key: 'contact.email', positive: /e ?mail/, negative: /confirm|verify|repeat/ },
  {
    key: 'contact.phone',
    positive: /phone|mobile|contact ?number|cell|telephone/,
    negative: /type|country ?code|extension|ext\b/,
  },
  { key: 'contact.phoneCountryCode', positive: /country ?code|dial ?code|phone ?code/ },
  { key: 'contact.phoneType', positive: /phone ?type|device ?type/, widgets: ['choice'] },

  // --- address (C) ----------------------------------------------------------
  {
    key: 'address.line1',
    positive: /^address$|address ?line ?(1|one)?$|street|addr ?1|^address 1$/,
    negative: /email|address ?line ?2|city|state|country|zip|postal/,
  },
  { key: 'address.line2', positive: /address ?line ?(2|two)|addr ?2|apt|suite|unit ?number/ },
  { key: 'address.city', positive: /\bcity\b|\btown\b|suburb|municipality/ },
  {
    key: 'address.state',
    positive: /\bstate\b|province|\bregion\b|\bcounty\b/,
    negative: /united ?state|statement|state ?of/,
  },
  { key: 'address.postalCode', positive: /\bzip\b|postal ?code|post ?code|zip ?code/ },
  {
    key: 'address.country',
    positive: /country|nation(?!ality)/,
    negative: /country ?code/,
  },
  {
    // "Current location" fields (Lever/Ashby-style) want the applicant's whereabouts;
    // the popover offers city/state alternates for tighter formats.
    key: 'address.full',
    positive: /current ?location|your ?location|where ?are ?you ?(located|based)/,
    negative: /work ?location|job ?location|office|relocat|preference/,
  },

  // --- links (J) ------------------------------------------------------------
  { key: 'links.linkedin', positive: /linked ?in/ },
  { key: 'links.github', positive: /git ?hub/ },
  {
    key: 'links.portfolio',
    positive: /portfolio|personal ?site/,
    negative: /linkedin|github/,
  },
  {
    key: 'links.website',
    positive: /website|web ?site|personal ?url|\burl\b|homepage/,
    negative: /linkedin|github|portfolio|company/,
  },

  // --- work (C+J) -----------------------------------------------------------
  {
    key: 'work[0].company',
    positive: /company|employer|organi[sz]ation|business ?name|current ?employer/,
    negative: /title|description|url|website|size|type/,
  },
  {
    key: 'work[0].title',
    positive: /job ?title|^title$|^position$|current ?(job|position|role)|^role$/,
    // "describe your … current role" is a SUMMARY prompt, not a title field; and a job
    // title is never a textarea.
    negative: /honorific|book|film|describe|responsibilit|duties|description/,
    widgets: ['singleline', 'choice'],
  },
  {
    // In-group "Location" means the JOB's location; a location field on a page with no
    // work context is rationalized to address.full instead.
    key: 'work[0].location',
    positive: /^location$|work ?location|job ?location|company ?location/,
    negative: /current ?location|your ?location|relocat|preference/,
  },
  {
    key: 'work[0].current',
    positive:
      /currently ?work(ing)? ?(here|there)|i ?currently ?work|current(ly)? ?employed ?(here|there)/,
    widgets: ['choice'],
  },
  {
    key: 'work[0].summary',
    positive:
      /responsibilit|duties|describe .*(role|work|job)|accomplishment|impact|experience ?summary|role ?description|job ?description|position ?description|^description$/,
    widgets: ['multiline'],
  },
  { key: 'work[0].startDate', positive: /start ?date|from ?date|employed ?from|date ?started/ },
  {
    key: 'work[0].endDate',
    positive: /end ?date|to ?date|until|employed ?to|date ?ended|leave ?date/,
    negative: /intend|available|start/,
  },
  // Bare "From"/"To" labels only count on date-SHAPED inputs (MM/YYYY placeholders,
  // type=month/date) — Workday-style experience groups (SPEC §7.4 date-segmented).
  { key: 'work[0].startDate', positive: /^from$|^start$/, dateShape: true },
  {
    key: 'work[0].endDate',
    positive: /^to$|^to actual or expected$|^end$|^until$/,
    dateShape: true,
  },

  // --- education (J) --------------------------------------------------------
  {
    key: 'education[0].school',
    positive: /school|university|college|institution|alma ?mater/,
    negative: /high ?school ?(diploma|degree)/,
  },
  { key: 'education[0].degree', positive: /degree|qualification|diploma/, negative: /field/ },
  {
    key: 'education[0].field',
    positive: /field ?of ?study|major|discipline|concentration|area ?of ?study/,
  },
  { key: 'education[0].gpa', positive: /\bgpa\b|grade ?point/ },

  // --- top-level snippets (J) -----------------------------------------------
  {
    key: 'summary',
    positive:
      /professional ?summary|about ?(you|yourself|me)|objective|\bbio\b|personal ?statement/,
    widgets: ['multiline'],
  },
  {
    key: 'coverLetter.text',
    positive: /cover ?letter|why .*(join|work|interested|company)|motivation ?letter/,
    widgets: ['multiline'],
  },
  { key: 'skills', positive: /^skills?$|technical ?skills|technologies|competencies/ },

  // --- documents (J; file widgets only) --------------------------------------
  {
    key: 'documents.resume',
    positive: /resume|c\.? ?v\.?|\bcv\b|curriculum/,
    negative: /cover/,
    widgets: ['file'],
  },
  { key: 'documents.coverLetter', positive: /cover ?letter/, widgets: ['file'] },

  // --- answers (J; mostly question-context) ----------------------------------
  {
    key: 'answers.salaryExpectation',
    positive: /salary|compensation|pay ?(expectation|range|rate)|desired ?pay|expected ?pay/,
  },
  {
    key: 'answers.workAuthorization',
    positive: /authoriz|legally .*work|right ?to ?work|eligib.*work|work ?permit/,
  },
  { key: 'answers.sponsorship', positive: /sponsor/ },
  {
    key: 'answers.noticePeriod',
    positive: /notice ?period|availability|available .*start|start ?date|when .*start/,
    questionContext: true,
  },
  {
    key: 'answers.howDidYouHear',
    positive: /how ?did ?you ?hear|referr?al ?source|hear ?about|where ?did ?you ?(hear|find)/,
  },
  { key: 'answers.relocation', positive: /relocat|willing .*move|open ?to ?moving/ },
  {
    key: 'answers.remotePreference',
    positive: /\bremote\b|work ?from ?home|hybrid|on ?site ?preference/,
    questionContext: true,
  },
  { key: 'answers.over18', positive: /over ?18|18 ?years|at ?least ?18|legal ?age/ },
  {
    key: 'answers.previouslyEmployedHere',
    positive: /previously ?(worked|employed)|worked ?here ?before|former ?employee/,
  },
  { key: 'answers.referralName', positive: /referr?al ?name|who ?referred|referred ?by/ },

  // --- EEO (J; sensitive — composer/filler enforce confirm-first) ------------
  { key: 'eeo.gender', positive: /gender|\bsex\b/ },
  { key: 'eeo.race', positive: /\brace\b|racial/ },
  { key: 'eeo.ethnicity', positive: /ethnic|hispanic|latino/ },
  { key: 'eeo.veteranStatus', positive: /veteran/ },
  { key: 'eeo.disabilityStatus', positive: /disabilit|handicap/ },
];

export const HEURISTIC_RULES: readonly HeuristicRule[] = rules;

/**
 * Chromium's NAME_IGNORED anti-pattern guard, adopted wholesale (SPEC B.2): prevents the
 * identity rules from grabbing account-creation fields — Workday/Taleo/iCIMS front the
 * application with signup forms.
 */
export const NAME_IGNORED_RE =
  /user ?name|user ?id|nickname|maiden ?name|login|password|title(?! .*job)|prefix|suffix/;

/** Keys the anti-pattern guard protects (identity-shaped rules). */
export const NAME_GUARDED_KEYS: readonly CanonicalKey[] = [
  'identity.firstName',
  'identity.lastName',
  'identity.fullName',
  'identity.middleName',
];
