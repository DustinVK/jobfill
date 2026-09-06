/**
 * Validation of interchange documents against `ai/import.schema.json` (SPEC §9.2).
 * Used by the options page before import and by the background as defense in depth.
 *
 * The validator is *precompiled at build time* (scripts/gen-validator.mjs → ajv standalone
 * code): the extension's CSP has no 'unsafe-eval', so ajv's runtime schema compilation
 * (`new Function`) would throw in extension pages. No ajv runtime ships in any bundle.
 *
 * Errors render with JSON paths and human text — import files usually come from an AI, and
 * the report is designed to be pasted back to one.
 */
import type { InterchangeDocument } from './types.js';
import validate from './schema/validate-import.gen.cjs';

export interface ImportValidationError {
  /** JSON path into the document, e.g. `/work/0/startDate`. */
  path: string;
  message: string;
}

export type ImportValidation =
  | { valid: true; document: InterchangeDocument }
  | { valid: false; errors: ImportValidationError[] };

export function validateImport(value: unknown): ImportValidation {
  if (validate(value)) {
    return { valid: true, document: value as unknown as InterchangeDocument };
  }
  const errors: ImportValidationError[] = (validate.errors ?? []).map((err) => ({
    path: err.instancePath || '/',
    message:
      err.keyword === 'additionalProperties'
        ? `unknown property "${String(err.params.additionalProperty)}"`
        : (err.message ?? 'invalid'),
  }));
  return { valid: false, errors };
}

/** One-string error report, formatted to paste back to the AI that produced the file. */
export function formatValidationErrors(errors: ImportValidationError[]): string {
  return errors.map((e) => `${e.path}: ${e.message}`).join('\n');
}
