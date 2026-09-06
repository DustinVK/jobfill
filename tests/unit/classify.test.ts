import { describe, expect, it } from 'vitest';
import {
  canonicalizeSignal,
  classifyFields,
  type FieldSignals,
} from '../../src/shared/classify.js';
import { mapAutocomplete } from '../../src/shared/rules/autocomplete-map.js';

function field(overrides: Partial<FieldSignals> & { fieldId: string }): FieldSignals {
  return { widget: 'text', ...overrides };
}

describe('canonicalizeSignal', () => {
  it('splits camelCase and separators like the Workday attribute style', () => {
    expect(canonicalizeSignal('legalNameSection_firstName')).toBe('legal name section first name');
    expect(canonicalizeSignal('job-application[email]')).toBe('job application email');
  });
  it('collapses punctuation but keeps question marks and apostrophes', () => {
    expect(canonicalizeSignal("Driver's license?  ")).toBe("driver's license?");
  });
});

describe('mapAutocomplete', () => {
  it('maps single tokens', () => {
    expect(mapAutocomplete('given-name')?.key).toBe('identity.firstName');
    expect(mapAutocomplete('email')?.key).toBe('contact.email');
  });
  it('takes the last recognized token of a multi-token value', () => {
    expect(mapAutocomplete('shipping address-line1')?.key).toBe('address.line1');
    expect(mapAutocomplete('section-contact tel')?.key).toBe('contact.phone');
  });
  it('carries the phone-format hint', () => {
    expect(mapAutocomplete('tel')?.phoneFormat).toBe('e164');
    expect(mapAutocomplete('tel-national')?.phoneFormat).toBe('national');
  });
  it('ignores off and unknown values', () => {
    expect(mapAutocomplete('off')).toBeUndefined();
    expect(mapAutocomplete('email off')).toBeUndefined();
    expect(mapAutocomplete('nonsense-token')).toBeUndefined();
    expect(mapAutocomplete(undefined)).toBeUndefined();
  });
});

describe('classifyFields — tier assignment', () => {
  it('respects custom thresholds from settings', () => {
    const fields = [field({ fieldId: 'f1', nameId: 'first name' })]; // nameId weight 0.7
    const strict = classifyFields(fields, { fillAllThreshold: 0.6, suggestThreshold: 0.5 });
    expect(strict.fields[0]?.tier).toBe('auto');
    const loose = classifyFields(fields, { fillAllThreshold: 0.9, suggestThreshold: 0.75 });
    expect(loose.fields[0]?.tier).toBe('manual');
  });

  it('question fields never reach auto tier even at score 0.85', () => {
    const result = classifyFields(
      [
        field({
          fieldId: 'q1',
          label: 'Will you now or in the future require sponsorship for employment?',
        }),
      ],
      {
        answers: [
          {
            id: 'a1',
            key: 'sponsorship',
            question: 'Sponsorship',
            patterns: ['sponsor'],
            sensitive: false,
          },
        ],
      },
    );
    expect(result.fields[0]?.key).toBe('answers.sponsorship');
    expect(result.fields[0]?.tier).toBe('suggest');
  });

  it('a hostile answers pattern (invalid regex) is skipped, not fatal', () => {
    const result = classifyFields(
      [field({ fieldId: 'q1', label: 'Do you require sponsorship for a visa application?' })],
      {
        answers: [
          { id: 'bad', question: 'Broken', patterns: ['('], sensitive: false },
          {
            id: 'good',
            key: 'sponsorship',
            question: 'S',
            patterns: ['sponsor'],
            sensitive: false,
          },
        ],
      },
    );
    expect(result.fields[0]?.answerId).toBe('good');
  });

  it('min-signal guard: two classified fields do not enable fill-all, one autocomplete does', () => {
    const two = classifyFields([
      field({ fieldId: 'a', label: 'First name' }),
      field({ fieldId: 'b', label: 'Last name' }),
    ]);
    expect(two.fillAllEligible).toBe(false);

    const withToken = classifyFields([field({ fieldId: 'a', autocomplete: 'email' })]);
    expect(withToken.fillAllEligible).toBe(true);
  });

  it('sensitive classifications never reach auto even at score 1', () => {
    const result = classifyFields([
      field({ fieldId: 'g', label: 'Gender' }),
      field({ fieldId: 'x', label: 'First name' }),
      field({ fieldId: 'y', label: 'Last name' }),
      field({ fieldId: 'z', label: 'Email' }),
    ]);
    const gender = result.fields.find((f) => f.key === 'eeo.gender');
    expect(gender).toBeDefined();
    expect(gender?.sensitive).toBe(true);
    expect(gender?.tier).not.toBe('auto');
  });
});
