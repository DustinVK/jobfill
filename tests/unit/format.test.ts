import { describe, expect, it } from 'vitest';
import {
  booleanChoiceTargets,
  dateSegments,
  defaultRenderer,
  fitToBudget,
  formatAddressFull,
  formatDate,
  formatEndDate,
  formatPhone,
  fullName,
  fullNameWithAffixes,
  joinList,
  matchChoice,
  normalizeChoice,
  parseYearMonth,
  phoneAlternates,
  render,
  truncateAtWord,
} from '../../src/shared/format.js';

describe('fullName', () => {
  it('joins first + last', () => {
    expect(fullName({ firstName: 'Maya', lastName: 'Okafor' })).toBe('Maya Okafor');
  });
  it('includes middle name when present', () => {
    expect(fullName({ firstName: 'Maya', middleName: 'A.', lastName: 'Okafor' })).toBe(
      'Maya A. Okafor',
    );
  });
  it('ignores blank parts', () => {
    expect(fullName({ firstName: ' Maya ', middleName: '  ', lastName: 'Okafor' })).toBe(
      'Maya Okafor',
    );
  });
  it('adds honorific and suffix only in the affixed form', () => {
    const identity = { firstName: 'Maya', lastName: 'Okafor', honorific: 'Dr.', suffix: 'PhD' };
    expect(fullName(identity)).toBe('Maya Okafor');
    expect(fullNameWithAffixes(identity)).toBe('Dr. Maya Okafor PhD');
  });
});

describe('formatPhone', () => {
  const phone = { countryCode: '1', national: '6165550142' };
  it('formats all four spec formats', () => {
    expect(formatPhone(phone, 'national')).toBe('(616) 555-0142');
    expect(formatPhone(phone, 'digits')).toBe('6165550142');
    expect(formatPhone(phone, 'e164')).toBe('+16165550142');
    expect(formatPhone(phone, 'dashed')).toBe('616-555-0142');
  });
  it('strips punctuation from stored input', () => {
    expect(formatPhone({ countryCode: '+1', national: '(616) 555-0142' }, 'e164')).toBe(
      '+16165550142',
    );
  });
  it('does not invent NANP grouping for non-10-digit numbers', () => {
    expect(formatPhone({ countryCode: '44', national: '2079460958' }, 'e164')).toBe(
      '+442079460958',
    );
    expect(formatPhone({ countryCode: '44', national: '079460958' }, 'national')).toBe('079460958');
  });
  it('returns empty for empty national number', () => {
    expect(formatPhone({ countryCode: '1', national: '' })).toBe('');
  });
  it('lists the other formats as alternates', () => {
    expect(phoneAlternates(phone, 'national')).toEqual([
      '6165550142',
      '+16165550142',
      '616-555-0142',
    ]);
  });
});

describe('formatAddressFull', () => {
  it('joins all present parts', () => {
    expect(
      formatAddressFull({
        line1: '11 Ionia Ave NW',
        line2: 'Suite 200',
        city: 'Grand Rapids',
        state: 'MI',
        postalCode: '49503',
        country: 'United States',
      }),
    ).toBe('11 Ionia Ave NW Suite 200, Grand Rapids, MI 49503, United States');
  });
  it('handles sparse addresses', () => {
    expect(formatAddressFull({ city: 'Grand Rapids', state: 'MI' })).toBe('Grand Rapids, MI');
    expect(formatAddressFull({})).toBe('');
  });
});

describe('dates', () => {
  it('parses valid YearMonth and rejects garbage', () => {
    expect(parseYearMonth('2021-05')).toEqual({ year: 2021, month: 5 });
    expect(parseYearMonth('2021-13')).toBeUndefined();
    expect(parseYearMonth('2021-5')).toBeUndefined();
    expect(parseYearMonth('May 2021')).toBeUndefined();
    expect(parseYearMonth(undefined)).toBeUndefined();
  });
  it('formats every spec format', () => {
    expect(formatDate('2021-05', 'MM/YYYY')).toBe('05/2021');
    expect(formatDate('2021-05', 'MM/DD/YYYY')).toBe('05/01/2021');
    expect(formatDate('2021-05', 'YYYY-MM')).toBe('2021-05');
    expect(formatDate('2021-05', 'Month YYYY')).toBe('May 2021');
    expect(formatDate('2021-05', 'Mon YYYY')).toBe('May 2021');
    expect(formatDate('2021-11', 'Mon YYYY')).toBe('Nov 2021');
    expect(formatDate('2021-05', 'YYYY')).toBe('2021');
  });
  it('returns empty string for unparseable input rather than garbage', () => {
    expect(formatDate('garbage')).toBe('');
  });
  it('renders Present for current entities', () => {
    expect(formatEndDate(undefined, true)).toBe('Present');
    expect(formatEndDate('2022-02', false)).toBe('02/2022');
    // current wins even if an endDate is (wrongly) present
    expect(formatEndDate('2022-02', true)).toBe('Present');
  });
  it('splits segments for segmented widgets', () => {
    expect(dateSegments('2021-05')).toEqual({ month: '05', day: '01', year: '2021' });
    expect(dateSegments('nope')).toBeUndefined();
  });
});

describe('joinList', () => {
  it('joins with each joiner and skips empties', () => {
    expect(joinList(['a', '', 'b'])).toBe('a, b');
    expect(joinList(['a', 'b'], 'newline')).toBe('a\nb');
    expect(joinList(['a', 'b'], 'middot')).toBe('a · b');
  });
});

describe('render', () => {
  const input = { paragraph: 'Summary here.', bullets: ['Did X', 'Did Y.'] };
  it('paragraph renders the paragraph only', () => {
    expect(render(input, 'paragraph')).toBe('Summary here.');
  });
  it('bullets renders prefixed lines', () => {
    expect(render(input, 'bullets')).toBe('• Did X\n• Did Y.');
  });
  it('paragraph+bullets separates with a blank line', () => {
    expect(render(input, 'paragraph+bullets')).toBe('Summary here.\n\n• Did X\n• Did Y.');
  });
  it('plain-join terminates sentences and joins with spaces', () => {
    expect(render(input, 'plain-join')).toBe('Did X. Did Y.');
  });
  it('supports a custom bullet prefix', () => {
    expect(render({ ...input, bulletPrefix: '- ' }, 'bullets')).toBe('- Did X\n- Did Y.');
  });
  it('omits the blank line when the paragraph is empty', () => {
    expect(render({ paragraph: '', bullets: ['Did X'] }, 'paragraph+bullets')).toBe('• Did X');
  });
});

describe('defaultRenderer', () => {
  it('single-line fields always get paragraph', () => {
    expect(defaultRenderer({ multiline: false })).toBe('paragraph');
    expect(defaultRenderer({ multiline: false, maxLength: 5000 })).toBe('paragraph');
  });
  it('tight budgets get paragraph, medium get bullets, roomy get both', () => {
    expect(defaultRenderer({ multiline: true, maxLength: 200 })).toBe('paragraph');
    expect(defaultRenderer({ multiline: true, maxLength: 500 })).toBe('bullets');
    expect(defaultRenderer({ multiline: true })).toBe('paragraph+bullets');
    expect(defaultRenderer({ multiline: true, rows: 8, maxLength: 5000 })).toBe(
      'paragraph+bullets',
    );
  });
});

describe('truncateAtWord', () => {
  it('returns short text unchanged', () => {
    expect(truncateAtWord('hello world', 50)).toBe('hello world');
  });
  it('cuts at a word boundary', () => {
    expect(truncateAtWord('the quick brown fox jumps', 16)).toBe('the quick brown');
  });
  it('hard-cuts when no boundary exists in the usable tail', () => {
    expect(truncateAtWord('supercalifragilistic', 10)).toBe('supercalif');
  });
  it('handles zero budget', () => {
    expect(truncateAtWord('anything', 0)).toBe('');
  });
});

describe('fitToBudget (SPEC §5.3 ladder)', () => {
  const preferred = {
    paragraph: 'A long impact-styled paragraph about the work that was done here.',
    bullets: ['First long bullet about a thing.', 'Second long bullet about another thing.'],
  };
  const short = { paragraph: 'Short version.', bullets: ['Bullet 1.', 'Bullet 2.'] };

  it('passes preferred content through when it fits', () => {
    const result = fitToBudget({ preferred, short }, 'paragraph+bullets', 10_000);
    expect(result.text).toContain('impact-styled');
    expect(result).toMatchObject({ truncated: false, droppedBullets: 0, usedShortVariants: false });
  });
  it('ignores budget when none is given', () => {
    const result = fitToBudget({ preferred }, 'paragraph+bullets');
    expect(result.truncated).toBe(false);
  });
  it('falls back to short variants before dropping content', () => {
    const shortFull = render(short, 'paragraph+bullets');
    const result = fitToBudget({ preferred, short }, 'paragraph+bullets', shortFull.length);
    expect(result.text).toBe(shortFull);
    expect(result.usedShortVariants).toBe(true);
    expect(result.truncated).toBe(false);
  });
  it('drops trailing bullets when even short variants overflow', () => {
    const oneBullet = render({ ...short, bullets: short.bullets.slice(0, 1) }, 'paragraph+bullets');
    const result = fitToBudget({ preferred, short }, 'paragraph+bullets', oneBullet.length);
    expect(result.text).toBe(oneBullet);
    expect(result.droppedBullets).toBe(1);
    expect(result.truncated).toBe(false);
  });
  it('hard-truncates at a word boundary as the last resort and flags it', () => {
    const result = fitToBudget({ preferred, short }, 'paragraph+bullets', 10);
    expect(result.text.length).toBeLessThanOrEqual(10);
    expect(result.truncated).toBe(true);
    expect(result.text).not.toMatch(/\s$/);
  });
});

describe('choice matching (SPEC §5.4)', () => {
  it('normalizes case and punctuation', () => {
    expect(normalizeChoice("  No, I won't! ")).toBe("no i won't");
  });
  it('matches exact labels', () => {
    const match = matchChoice(['Yes', 'No'], ['no']);
    expect(match?.index).toBe(1);
    expect(match?.score).toBe(1);
  });
  it('matches verbose ATS labels by containment', () => {
    const options = [
      'Yes, I require sponsorship',
      'No, I will not require sponsorship now or in the future',
    ];
    const match = matchChoice(options, ['no', 'i will not require sponsorship']);
    expect(match?.index).toBe(1);
  });
  it('returns undefined below threshold so callers drop to suggest', () => {
    expect(matchChoice(['Red', 'Green'], ['sponsorship'])).toBeUndefined();
    expect(matchChoice(['Red', 'Green'], [])).toBeUndefined();
  });
  it('prefers the fuller match for a specific target', () => {
    const options = ['No', 'No, I will not require sponsorship'];
    const match = matchChoice(options, ['no i will not require sponsorship']);
    expect(match?.index).toBe(1);
  });
  it('boolean targets read naturally', () => {
    expect(booleanChoiceTargets(true)).toContain('yes');
    expect(booleanChoiceTargets(false)).toContain('no');
  });
});
