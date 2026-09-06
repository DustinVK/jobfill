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

  it('groups every work entry under its position with a dated heading', () => {
    const work = index.filter((r) => r.category === 'work');
    expect(work.length).toBeGreaterThan(0);
    expect(work.every((r) => r.groupKey && r.group)).toBe(true);
    // One group per position, heading names title + company + dates.
    const groups = new Map(work.map((r) => [r.groupKey, r.group]));
    expect(groups.size).toBe(vault.work.length);
    for (const position of vault.work) {
      const heading = groups.get(position.id);
      expect(heading).toContain(position.title);
      expect(heading).toContain(position.company);
      expect(heading).toMatch(/\d{2}\/\d{4}/); // formatted start date
    }
    const current = vault.work.find((w) => w.current);
    if (current) expect(groups.get(current.id)).toContain('Present');
  });

  it('gives grouped work entries short labels without the entity decoration', () => {
    const work = index.filter((r) => r.category === 'work');
    const shorts = work.map((r) => r.shortLabel);
    expect(shorts).toContain('Company');
    expect(shorts).toContain('Title');
    expect(shorts).toContain('Summary');
    // A bullet with its own label keeps that handle as the short label.
    const labeledBullet = vault.work[0]?.bullets.find((b) => b.label);
    if (labeledBullet) expect(shorts).toContain(labeledBullet.label);
    // Variant rows keep the style suffix on the short label too.
    const variant = work.find((r) => r.label.includes('(responsibilities)'));
    expect(variant?.shortLabel).toMatch(/\(responsibilities\)$/);
    // Short labels never repeat the "X @ Y" decoration the heading already carries.
    expect(shorts.every((s) => s === undefined || !s.includes(' @ '))).toBe(true);
  });

  it('keeps non-work categories ungrouped (for now)', () => {
    const personal = index.filter((r) => r.category === 'personal');
    expect(personal.every((r) => r.groupKey === undefined)).toBe(true);
  });
});
