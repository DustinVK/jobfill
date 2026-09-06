import { describe, expect, it } from 'vitest';
import {
  activeVersion,
  compose,
  resolveVariant,
  variantAlternates,
} from '../../src/shared/compose.js';
import type { ResumeVersion, Snippet, Vault } from '../../src/shared/types.js';
import { createEmptyVault } from '../../src/shared/vault.js';
import { mergeAdd } from '../../src/shared/interchange.js';
import type { InterchangeDocument } from '../../src/shared/types.js';
import sampleImport from '../../ai/examples/sample-import.json';

/** A populated vault built through the real import path — no hand-rolled parallel fixtures. */
function sampleVault(): Vault {
  const vault = createEmptyVault();
  const result = mergeAdd(vault, sampleImport as unknown as InterchangeDocument);
  return result.vault;
}

function snippet(overrides: Partial<Snippet> = {}): Snippet {
  return {
    id: 's1',
    tags: [],
    variants: [
      { id: 'v-impact', style: 'impact', text: 'impact text' },
      { id: 'v-resp', style: 'responsibilities', text: 'responsibilities text' },
      { id: 'v-short', style: 'short', text: 'short text' },
    ],
    defaultVariantId: 'v-impact',
    ...overrides,
  };
}

function version(overrides: Partial<ResumeVersion> = {}): ResumeVersion {
  return {
    id: 'ver1',
    name: 'Test',
    include: { workIds: [], educationIds: [], projectIds: [], certificationIds: [] },
    stylePriority: ['impact', 'short'],
    variantPrefs: {},
    ...overrides,
  };
}

describe('resolveVariant (SPEC §5.1 order)', () => {
  it('1. explicit per-snippet pref wins', () => {
    const v = version({ variantPrefs: { s1: 'v-resp' }, stylePriority: ['impact'] });
    expect(resolveVariant(snippet(), v)).toBe('responsibilities text');
  });
  it('2. stylePriority order applies when no pref', () => {
    expect(resolveVariant(snippet(), version({ stylePriority: ['responsibilities'] }))).toBe(
      'responsibilities text',
    );
    expect(resolveVariant(snippet(), version({ stylePriority: ['long', 'short'] }))).toBe(
      'short text',
    );
  });
  it('3. defaultVariantId is the fallback', () => {
    const v = version({ stylePriority: ['nonexistent'] });
    expect(resolveVariant(snippet({ defaultVariantId: 'v-short' }), v)).toBe('short text');
  });
  it('ignores a dangling variantPrefs id', () => {
    const v = version({ variantPrefs: { s1: 'gone' } });
    expect(resolveVariant(snippet(), v)).toBe('impact text');
  });
  it('alternates cycle the remaining candidates without duplicates', () => {
    const alternates = variantAlternates(snippet(), version());
    expect(alternates).toEqual(['short text', 'responsibilities text']);
  });
});

describe('compose over the sample vault', () => {
  const vault = sampleVault();

  it('identity and contact', () => {
    expect(compose(vault, 'identity.firstName')?.value).toBe('Maya');
    expect(compose(vault, 'identity.fullName')?.value).toBe('Maya Okafor');
    expect(compose(vault, 'contact.email')?.value).toBe('maya.okafor@example.com');
    expect(compose(vault, 'contact.phone')?.value).toBe('(616) 555-0142');
    expect(compose(vault, 'contact.phone', { phoneFormat: 'e164' })?.value).toBe('+16165550142');
    expect(compose(vault, 'contact.phone')?.alternates).toContain('+16165550142');
  });

  it('address including derived full', () => {
    expect(compose(vault, 'address.city')?.value).toBe('Grand Rapids');
    expect(compose(vault, 'address.full')?.value).toBe('Grand Rapids, MI 49503, United States');
    const state = compose(vault, 'address.state');
    expect(state?.value).toBe('MI');
    expect(state?.choiceTargets).toContain('MI');
  });

  it('links', () => {
    expect(compose(vault, 'links.github')?.value).toContain('github.com');
    // portfolio falls back to website and vice versa
    expect(compose(vault, 'links.website')?.value).toBe('https://mayaokafor.example.com');
  });

  it('work[i] follows the active version include order', () => {
    expect(compose(vault, 'work[0].company')?.value).toBe('Harbor Freight Logistics');
    expect(compose(vault, 'work[1].company')?.value).toBe('Brightline Health');
    expect(compose(vault, 'work[0].startDate')?.value).toBe('03/2022');
    expect(compose(vault, 'work[0].endDate')?.value).toBe('Present');
    expect(compose(vault, 'work[1].endDate')?.value).toBe('02/2022');
    expect(compose(vault, 'work[0].current')?.value).toBe('Yes');
  });

  it('work[i] out of range composes empty, not an error', () => {
    expect(compose(vault, 'work[9].company')?.value).toBe('');
  });

  it('work summary resolves impact-first per default version priority', () => {
    const summary = compose(vault, 'work[0].summary', { multiline: false });
    expect(summary?.value).toContain('2M packages/month');
    expect(summary?.alternates.some((a) => a.includes('Responsible for'))).toBe(true);
  });

  it('multiline work summary renders paragraph+bullets under a roomy budget', () => {
    const summary = compose(vault, 'work[0].summary', { multiline: true });
    expect(summary?.value).toContain('• ');
    expect(summary?.value).toContain('Rewrote the routing engine');
  });

  it('respects maxlength by dropping to short variants', () => {
    const tight = compose(vault, 'work[0].summary', { multiline: true, maxLength: 60 });
    expect(tight).toBeDefined();
    expect(tight!.value.length).toBeLessThanOrEqual(60);
  });

  it('education and projects', () => {
    expect(compose(vault, 'education[0].school')?.value).toBe('Grand Valley State University');
    expect(compose(vault, 'education[0].degree')?.value).toBe('B.S.');
    expect(compose(vault, 'projects[0].name')?.value).toBe('opensky-tracker');
    expect(compose(vault, 'certifications[0].name')?.value).toContain('AWS');
  });

  it('skills joined with alternates for other joiners', () => {
    const skills = compose(vault, 'skills');
    expect(skills?.value).toContain('TypeScript, Node.js');
    expect(skills?.alternates.some((a) => a.includes('\n'))).toBe(true);
  });

  it('languages', () => {
    expect(compose(vault, 'languages')?.value).toBe('English (Native), Igbo (Conversational)');
  });

  it('boolean answers produce Yes/No plus choice targets with synonyms', () => {
    const sponsorship = compose(vault, 'answers.sponsorship');
    expect(sponsorship?.value).toBe('No');
    expect(sponsorship?.choiceTargets).toContain('I will not require sponsorship');
    const auth = compose(vault, 'answers.workAuthorization');
    expect(auth?.value).toBe('Yes');
  });

  it('text answers with variants resolve through stylePriority', () => {
    const salary = compose(vault, 'answers.salaryExpectation');
    // default version priority is impact,short → no impact variant → falls through to... short
    expect(salary?.value).toBe('$150k');
    expect(salary?.alternates).toContain('$145,000–$165,000 depending on total compensation');
  });

  it('summary uses the version stylePriority', () => {
    const summary = compose(vault, 'summary', { multiline: false });
    expect(summary?.value).toContain('cut fulfillment latency 40%');
  });

  it('unknown or file keys return undefined', () => {
    expect(compose(vault, 'not.a.key')).toBeUndefined();
    expect(compose(vault, 'documents.resume')).toBeUndefined();
    expect(compose(vault, 'work[0].nonsense')).toBeUndefined();
  });

  it('missing answers compose empty rather than throwing', () => {
    expect(compose(vault, 'answers.relocation')?.value).toBe('');
  });
});

describe('version switching changes composed output', () => {
  it('responsibilities version resolves duty-phrased variants', () => {
    const vault = sampleVault();
    const responsibilities = vault.versions.find((v) => v.name.startsWith('Responsibilities'));
    expect(responsibilities).toBeDefined();
    vault.settings.activeVersionId = responsibilities!.id;
    expect(activeVersion(vault).id).toBe(responsibilities!.id);
    const summary = compose(vault, 'work[0].summary', { multiline: false });
    expect(summary?.value).toContain('Responsible for the order-routing platform');
  });
});
