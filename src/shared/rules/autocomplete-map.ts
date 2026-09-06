/**
 * SPEC Appendix B.1: `autocomplete` token → canonical key. The authoritative fast path —
 * weight 1.0 when present and ≠ "off". Reality check from the research: major ATS mostly
 * don't set autocomplete, so this is a fast path, not the main path.
 */
import type { CanonicalKey } from '../types.js';
import type { PhoneFormat } from '../format.js';

export interface AutocompleteMapping {
  key: CanonicalKey;
  /** Format hint the token itself implies (e.g. tel → e164, tel-national → national). */
  phoneFormat?: PhoneFormat;
}

export const AUTOCOMPLETE_MAP: Record<string, AutocompleteMapping> = {
  name: { key: 'identity.fullName' },
  'given-name': { key: 'identity.firstName' },
  'additional-name': { key: 'identity.middleName' },
  'family-name': { key: 'identity.lastName' },
  'honorific-prefix': { key: 'identity.honorific' },
  'honorific-suffix': { key: 'identity.suffix' },
  email: { key: 'contact.email' },
  tel: { key: 'contact.phone', phoneFormat: 'e164' },
  'tel-national': { key: 'contact.phone', phoneFormat: 'national' },
  'tel-country-code': { key: 'contact.phoneCountryCode' },
  'street-address': { key: 'address.full' },
  'address-line1': { key: 'address.line1' },
  'address-line2': { key: 'address.line2' },
  // address-line3 folds into line2 per Appendix B.1.
  'address-line3': { key: 'address.line2' },
  'address-level1': { key: 'address.state' },
  'address-level2': { key: 'address.city' },
  'postal-code': { key: 'address.postalCode' },
  country: { key: 'address.country' },
  'country-name': { key: 'address.country' },
  organization: { key: 'work[0].company' },
  'organization-title': { key: 'work[0].title' },
  url: { key: 'links.website' },
};

/**
 * Looks up an autocomplete attribute value. Handles multi-token values ("shipping
 * address-line1", "section-work tel"): the *last* recognized token wins, per the HTML
 * autofill grammar where the field type token comes last.
 */
export function mapAutocomplete(value: string | undefined): AutocompleteMapping | undefined {
  if (!value) return undefined;
  const tokens = value.trim().toLowerCase().split(/\s+/);
  if (tokens.includes('off')) return undefined;
  for (let i = tokens.length - 1; i >= 0; i--) {
    const token = tokens[i];
    if (token !== undefined) {
      const hit = AUTOCOMPLETE_MAP[token];
      if (hit) return hit;
    }
  }
  return undefined;
}
