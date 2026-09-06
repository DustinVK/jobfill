/**
 * SPEC Appendix B.3 / §7.9: the deny-list. Fields matching any of these are tier `skip` —
 * never filled, never in fill-all, no exceptions and no allowlist. DOB is deny-listed for
 * filling AND nothing stores it; some ATS ask post-offer, which is out of scope.
 */

export const DENY_RULES: readonly { name: string; pattern: RegExp }[] = [
  { name: 'password', pattern: /password|passwd|pwd\b/ },
  { name: 'captcha', pattern: /captcha|recaptcha|hcaptcha/ },
  { name: 'otp', pattern: /one ?time|\botp\b|2 ?fa|verification ?code|security ?code/ },
  { name: 'ssn', pattern: /\bssn\b|social ?security/ },
  { name: 'national-id', pattern: /national ?id|passport|driver'?s? ?licen[cs]e/ },
  { name: 'dob', pattern: /date ?of ?birth|birth ?date|\bdob\b|birthday/ },
  { name: 'maiden-name', pattern: /mother'?s? ?maiden/ },
  {
    name: 'banking',
    pattern: /\bbank\b|routing|\biban\b|\bswift\b|card ?number|\bcvv\b|\bcvc\b|account ?number/,
  },
];

/** Returns the matching deny rule's name, or undefined when the haystack is clean. */
export function denyMatch(haystack: string): string | undefined {
  for (const rule of DENY_RULES) {
    if (rule.pattern.test(haystack)) return rule.name;
  }
  return undefined;
}

/** Password-type inputs are deny-listed by widget alone, whatever their labels say. */
export const DENY_INPUT_TYPES: readonly string[] = ['password'];
