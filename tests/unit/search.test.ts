import { describe, expect, it } from 'vitest';
import { buildSearchIndex, searchIndex } from '../../src/shared/search.js';
import { mergeAdd } from '../../src/shared/interchange.js';
import { createEmptyVault } from '../../src/shared/vault.js';
import type { InterchangeDocument, Vault } from '../../src/shared/types.js';
import sampleImport from '../../ai/examples/sample-import.json';

function sampleVault(): Vault {
  return mergeAdd(createEmptyVault(), sampleImport as unknown as InterchangeDocument).vault;
}

describe('palette search', () => {
  const vault = sampleVault();
  const index = buildSearchIndex(vault);

  it('finds atoms by label prefix', () => {
    const results = searchIndex(index, 'email');
    expect(results[0]?.value).toBe('maya.okafor@example.com');
    expect(results[0]?.key).toBe('contact.email');
  });

  it('finds snippets by body text', () => {
    const results = searchIndex(index, 'routing engine');
    expect(results.some((r) => r.value.includes('Rewrote the routing engine'))).toBe(true);
  });

  it('finds snippets by tag', () => {
    const results = searchIndex(index, 'kubernetes');
    expect(results.length).toBeGreaterThan(0);
  });

  it('exposes non-default variants as separate results', () => {
    const results = searchIndex(index, 'established on-call');
    expect(results.some((r) => r.label.includes('responsibilities'))).toBe(true);
  });

  it('answers scope narrows to the answers bank', () => {
    const all = searchIndex(index, 'sponsor');
    const answersOnly = searchIndex(index, 'sponsor', { scope: 'answers' });
    expect(answersOnly.every((r) => r.kind === 'answer')).toBe(true);
    expect(all.length).toBeGreaterThanOrEqual(answersOnly.length);
    expect(answersOnly[0]?.key).toBe('answers.sponsorship');
  });

  it('flags sensitive answers so the UI can lock-badge them', () => {
    const results = searchIndex(index, 'salary');
    const salary = results.find((r) => r.key === 'answers.salaryExpectation');
    expect(salary?.sensitive).toBe(true);
  });

  it('matches by subsequence for sloppy queries', () => {
    const results = searchIndex(index, 'gvsu');
    expect(results.some((r) => r.value.includes('Grand Valley State University'))).toBe(true);
  });

  it('respects the limit and returns something for the empty query', () => {
    expect(searchIndex(index, '', { limit: 5 })).toHaveLength(5);
    expect(searchIndex(index, 'zzzznothing')).toHaveLength(0);
  });
});
