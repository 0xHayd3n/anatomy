import { describe, it, expect } from "vitest";
import { explainCode, listAllCodes } from "../src/error-docs.js";

// Mirror of the ErrorCode + WarningCode unions from
// @anatomytool/validate/src/errors.ts. Cross-checked here so a code added
// to errors.ts without a matching error-docs entry fails CI loudly,
// instead of silently breaking `anatomy explain`.
const KNOWN_ERROR_CODES = [
  "toml-parse-error",
  "schema-violation",
  "version-mismatch",
  "hash-content-mismatch",
  "fingerprint-mismatch",
  "unsupported-anatomy-version",
  "structure-path-not-found",
  "interface-form-mismatch",
  "source-path-not-found",
  "nested-path-escape",
  "anatomy-read-error",
  "memory-read-error",
  "missing-anatomy-memory-version",
  "unsupported-memory-version",
  "memory-fingerprint-mismatch",
  "memory-supersedes-not-found",
  "memory-supersedes-cycle",
  "memory-verified-by-malformed",
  // v0.13:
  "verify-rule-file-outside-repo",
] as const;

const KNOWN_WARNING_CODES = [
  "description-too-long",
  "entry-point-description-deprecated",
  "source-path-soft-not-found",
  "duplicate-fingerprint-in-tree",
  "memory-dangling-ref",
  "commands-no-test",
  "memory-verified-by-too-many",
  "memory-last-verified-before-at",
  "unused-dependency-claim",
  "literal-not-in-source",
  "source-cross-check-truncated",
  "verify-glob-empty",
  "verify-glob-unexpected-files",
  "verify-glob-outside-container",
  "verify-pattern-not-matched",
  "verify-pattern-found-where-forbidden",
  "verify-ast-grep-unavailable",
  "verify-invalid-pattern",
  "verify-source-scan-truncated",
  // v0.13:
  "verify-semgrep-unavailable",
  "verify-invalid-rule-file",
  "verify-rule-file-missing",
  "verify-no-files-matched",
] as const;

describe("error-docs", () => {
  it("has an entry for every error code in @anatomytool/validate", () => {
    const all = listAllCodes();
    for (const code of KNOWN_ERROR_CODES) {
      expect(all, `error code "${code}" is not documented in error-docs.ts`).toContain(code);
      expect(explainCode(code)?.severity).toBe("error");
    }
  });

  it("has an entry for every warning code in @anatomytool/validate", () => {
    const all = listAllCodes();
    for (const code of KNOWN_WARNING_CODES) {
      expect(all, `warning code "${code}" is not documented in error-docs.ts`).toContain(code);
      expect(explainCode(code)?.severity).toBe("warning");
    }
  });

  it("explainCode returns null for unknown code", () => {
    expect(explainCode("not-a-code")).toBeNull();
  });

  it("every doc has summary and body and severity", () => {
    for (const code of listAllCodes()) {
      const doc = explainCode(code);
      expect(doc).not.toBeNull();
      expect(doc!.summary.length).toBeGreaterThan(0);
      expect(doc!.body.length).toBeGreaterThan(0);
      expect(["error", "warning"]).toContain(doc!.severity);
    }
  });

  it("does not document any code unknown to @anatomytool/validate", () => {
    const known: string[] = [...KNOWN_ERROR_CODES, ...KNOWN_WARNING_CODES];
    for (const code of listAllCodes()) {
      expect(known, `error-docs.ts has an entry for "${code}" but it isn't in @anatomytool/validate's ErrorCode/WarningCode unions`).toContain(code);
    }
  });
});
