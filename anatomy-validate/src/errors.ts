// src/errors.ts
// Public error and warning types. ErrorCode and WarningCode are frozen
// for v0.1 (adding codes requires a minor bump of @anatomytool/validate).

export type ErrorCode =
  | "toml-parse-error"
  | "schema-violation"
  | "version-mismatch"
  | "hash-content-mismatch"
  | "fingerprint-mismatch"
  | "unsupported-anatomy-version"
  | "structure-path-not-found"
  | "interface-form-mismatch"
  | "source-path-not-found"
  | "nested-path-escape"
  | "anatomy-read-error"
  | "memory-read-error"
  | "missing-anatomy-memory-version"
  | "unsupported-memory-version"
  | "memory-fingerprint-mismatch"
  | "memory-supersedes-not-found"
  | "memory-supersedes-cycle"
  | "memory-verified-by-malformed"
  // v0.13 verify error code:
  | "verify-rule-file-outside-repo";

export type WarningCode =
  | "description-too-long"
  | "entry-point-description-deprecated"
  | "source-path-soft-not-found"
  | "duplicate-fingerprint-in-tree"
  | "memory-dangling-ref"
  | "commands-no-test"
  | "memory-verified-by-too-many"
  | "memory-last-verified-before-at"
  | "unused-dependency-claim"
  | "literal-not-in-source"
  | "source-cross-check-truncated"
  // v0.12 verify codes:
  | "verify-glob-empty"
  | "verify-glob-unexpected-files"
  | "verify-glob-outside-container"
  | "verify-pattern-not-matched"
  | "verify-pattern-found-where-forbidden"
  | "verify-ast-grep-unavailable"
  | "verify-invalid-pattern"
  | "verify-source-scan-truncated"  // reserved: not emitted in current verifiers (per-file 256KB cap is silent)
  // v0.13 verify warning codes:
  | "verify-semgrep-unavailable"
  | "verify-invalid-rule-file"
  | "verify-rule-file-missing"
  | "verify-no-files-matched";

export interface ValidationError {
  /** Programmatic categorization. Frozen string-literal union. */
  code: ErrorCode;
  /** Human-readable explanation. Not parsed by consumers. */
  message: string;
  /** RFC 6901 JSON Pointer into the parsed document. "" for root-level. */
  pointer: string;
  /** TOML source location. v0.1 populates this only for "toml-parse-error". */
  source?: { line: number; column: number };
  /** Sub-classification for "schema-violation": AJV's keyword (free-form
   *  string). Common values: "required", "pattern", "propertyNames",
   *  "maxLength", "minLength", "type", "format", "enum", "const",
   *  "additionalProperties", "minProperties", "maxProperties", "maxItems",
   *  "minItems". Consumers branching on this should default-handle unknown
   *  values. Absent on non-schema errors. */
  schemaKeyword?: string;
  /** Expected value when applicable (computed hash, fingerprint concat, ...). */
  expected?: unknown;
  /** Actual value at `pointer` when applicable. */
  actual?: unknown;
}

export interface Warning {
  code: WarningCode;
  message: string;
  pointer: string;
  /** Source-cross-check additive: the literal/name that triggered the warning.
   *  Other warning codes leave this undefined. */
  actual?: unknown;
  /** Source-cross-check additive: classification for "literal-not-in-source"
   *  warnings. Undefined for all other codes. */
  literalKind?: "host-port" | "scoped-package" | "source-path";
}
