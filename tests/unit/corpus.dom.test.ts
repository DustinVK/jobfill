// @vitest-environment jsdom
/**
 * Classifier corpus test (SPEC §11.1 — highest value). Each fixture in fixtures/corpus/ is
 * an HTML fragment with a metadata comment declaring per-selector expectations. The full
 * pipeline runs as shipped: scanFields → gatherSignals → classifyFields.
 *
 * The per-key report snapshot (fixtures/report.md) is committed; any classification change
 * that alters it fails this suite until the report is regenerated deliberately
 * (`npx vitest run corpus -u`) and the diff reviewed.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyFields, type Classification } from '../../src/shared/classify.js';
import { gatherSignals } from '../../src/content/label.js';
import { resetFieldIds, scanFields } from '../../src/content/scan.js';

const CORPUS_DIR = join(__dirname, '../../fixtures/corpus');

interface FixtureMeta {
  /** selector → expected canonical key, must classify at tier suggest or auto. */
  expect?: Record<string, string>;
  /** selector → deny rule name, must be tier skip. */
  deny?: Record<string, string>;
  /** selectors that must NOT carry a key at suggest+ tier. */
  none?: string[];
  /** selectors whose classification must be flagged sensitive. */
  sensitive?: string[];
  /** assertion on the min-signal guard result. */
  fillAll?: boolean;
}

interface LoadedFixture {
  name: string;
  meta: FixtureMeta;
  classifications: Map<Element, Classification>;
  fillAllEligible: boolean;
  document: Document;
}

/** The answers bank available during corpus runs — patterns as a user would configure them. */
const CORPUS_ANSWERS = [
  {
    id: 'a-auth',
    key: 'workAuthorization' as const,
    question: 'Work authorization',
    patterns: ['authoriz', 'legally.*work'],
    sensitive: false,
  },
  {
    id: 'a-sponsor',
    key: 'sponsorship' as const,
    question: 'Sponsorship',
    patterns: ['sponsor'],
    sensitive: false,
  },
  {
    id: 'a-notice',
    key: 'noticePeriod' as const,
    question: 'Notice period',
    patterns: ['notice.?period', 'available.*start'],
    sensitive: false,
  },
  {
    id: 'a-remote',
    key: 'remotePreference' as const,
    question: 'Remote preference',
    patterns: ['remote', 'work.?from.?home', 'hybrid'],
    sensitive: false,
  },
  {
    id: 'a-prev',
    key: 'previouslyEmployedHere' as const,
    question: 'Previously employed',
    patterns: ['previously.?work', 'worked.*before'],
    sensitive: false,
  },
];

function loadFixture(name: string): LoadedFixture {
  const raw = readFileSync(join(CORPUS_DIR, name), 'utf8');
  const metaMatch = /<!-- jobfill-fixture\n([\s\S]*?)\n-->/.exec(raw);
  if (!metaMatch?.[1]) throw new Error(`${name}: missing jobfill-fixture metadata comment`);
  const meta = JSON.parse(metaMatch[1]) as FixtureMeta;

  // Each fixture gets its own detached document so describe-time loading can't cross-talk.
  const doc = new DOMParser().parseFromString(raw, 'text/html');
  resetFieldIds();
  const scanned = scanFields(doc);
  const signals = scanned.map(gatherSignals);
  const result = classifyFields(signals, { answers: CORPUS_ANSWERS });

  const classifications = new Map<Element, Classification>();
  scanned.forEach((field, i) => {
    const classification = result.fields[i];
    if (classification) {
      classifications.set(field.element, classification);
      // Radio groups: every member element maps to the group's classification.
      for (const member of field.groupElements ?? []) classifications.set(member, classification);
    }
  });
  return { name, meta, classifications, fillAllEligible: result.fillAllEligible, document: doc };
}

function classificationOf(fixture: LoadedFixture, selector: string): Classification {
  const el = fixture.document.querySelector(selector);
  if (!el) throw new Error(`${fixture.name}: selector ${selector} matches nothing`);
  const classification = fixture.classifications.get(el);
  if (!classification) {
    throw new Error(`${fixture.name}: ${selector} was not scanned as a fillable field`);
  }
  return classification;
}

const fixtureNames = readdirSync(CORPUS_DIR).filter((f) => f.endsWith('.html'));

describe('classifier corpus', () => {
  it('has at least 40 fixtures', () => {
    expect(fixtureNames.length).toBeGreaterThanOrEqual(40);
  });

  for (const name of fixtureNames) {
    describe(name, () => {
      const fixture = loadFixture(name);

      for (const [selector, expectedKey] of Object.entries(fixture.meta.expect ?? {})) {
        it(`${selector} → ${expectedKey}`, () => {
          const c = classificationOf(fixture, selector);
          expect(
            c.key,
            `expected ${expectedKey}, got ${c.key ?? 'nothing'} (score ${c.score})`,
          ).toBe(expectedKey);
          expect(['auto', 'suggest']).toContain(c.tier);
        });
      }

      for (const [selector, denyReason] of Object.entries(fixture.meta.deny ?? {})) {
        it(`${selector} is deny-listed (${denyReason})`, () => {
          const c = classificationOf(fixture, selector);
          expect(c.tier).toBe('skip');
          expect(c.denyReason).toBe(denyReason);
        });
      }

      for (const selector of fixture.meta.none ?? []) {
        it(`${selector} must not classify`, () => {
          const c = classificationOf(fixture, selector);
          const confident = c.key !== undefined && (c.tier === 'auto' || c.tier === 'suggest');
          expect(confident, `unexpectedly classified as ${c.key} (${c.tier})`).toBe(false);
        });
      }

      for (const selector of fixture.meta.sensitive ?? []) {
        it(`${selector} is flagged sensitive and never auto`, () => {
          const c = classificationOf(fixture, selector);
          expect(c.sensitive).toBe(true);
          expect(c.tier).not.toBe('auto');
        });
      }

      if (fixture.meta.fillAll !== undefined) {
        it(`fill-all eligibility is ${fixture.meta.fillAll}`, () => {
          expect(fixture.fillAllEligible).toBe(fixture.meta.fillAll);
        });
      }
    });
  }

  it('per-key coverage report matches the committed snapshot', async () => {
    const perKey = new Map<string, { fixtures: Set<string>; hits: number }>();
    let denyCount = 0;
    let negativeCount = 0;
    for (const name of fixtureNames) {
      const fixture = loadFixture(name);
      for (const key of Object.values(fixture.meta.expect ?? {})) {
        const entry = perKey.get(key) ?? { fixtures: new Set<string>(), hits: 0 };
        entry.fixtures.add(name);
        entry.hits++;
        perKey.set(key, entry);
      }
      denyCount += Object.keys(fixture.meta.deny ?? {}).length;
      negativeCount += (fixture.meta.none ?? []).length;
    }
    const lines = [
      '# Classifier corpus — per-key coverage',
      '',
      'Generated by tests/unit/corpus.dom.test.ts (snapshot; regenerate with `npx vitest run corpus -u`).',
      '',
      `Fixtures: ${fixtureNames.length} · positive expectations: ${[...perKey.values()].reduce((n, e) => n + e.hits, 0)} · deny expectations: ${denyCount} · must-not-classify: ${negativeCount}`,
      '',
      '| Canonical key | Expectations | Fixtures |',
      '|---|---|---|',
      ...[...perKey.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(
          ([key, entry]) => `| ${key} | ${entry.hits} | ${[...entry.fixtures].sort().join(', ')} |`,
        ),
      '',
    ];
    await expect(lines.join('\n')).toMatchFileSnapshot('../../fixtures/report.md');
  });
});
