/**
 * Types for the generated standalone validator (scripts/gen-validator.mjs).
 * The .js file next to this is generated and gitignored; this declaration is committed.
 */
export interface GeneratedValidationError {
  instancePath: string;
  schemaPath: string;
  keyword: string;
  params: Record<string, unknown>;
  message?: string;
}

interface GeneratedValidator {
  (data: unknown): boolean;
  errors?: GeneratedValidationError[] | null;
}

declare const validate: GeneratedValidator;
export default validate;
