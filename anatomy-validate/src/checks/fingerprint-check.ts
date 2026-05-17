// src/checks/fingerprint-check.ts
// Verifies identity.fingerprint. Version-aware:
//   v0.7+: flat identity strings → fingerprintFromPillars(stack, form, domain, function)
//   v0.1–v0.6: nested pillar objects → concat of canonicalHash(id) per pillar

import { canonicalHash, fingerprintFromPillars } from "../canonical.js";
import type { ValidationError, Warning } from "../errors.js";

export function fingerprintCheck(doc: unknown): {
  errors: ValidationError[];
  warnings: Warning[];
} {
  const errors: ValidationError[] = [];
  const d = doc as Record<string, unknown>;
  const identity = d.identity as Record<string, unknown> | undefined;
  if (!identity || typeof identity.fingerprint !== "string") return { errors, warnings: [] };

  // Flat vs nested identity is a structural distinction, not a version one:
  // v0.7+ uses plain string pillars; v0.1–v0.6 uses nested { id, hash }
  // objects. Keying this on a hardcoded version set silently no-ops the
  // check on any flat version not listed (it did so for v0.9–v0.15).
  if (typeof identity.stack === "string") {
    // Flat string pillars
    const { stack, form, domain } = identity;
    const fn = identity.function;
    if (
      typeof stack !== "string" || typeof form !== "string" ||
      typeof domain !== "string" || typeof fn !== "string"
    ) return { errors, warnings: [] };
    const expected = fingerprintFromPillars(stack, form, domain, fn);
    if (identity.fingerprint !== expected) {
      errors.push({
        code: "fingerprint-mismatch",
        message: "identity.fingerprint does not match fingerprintFromPillars(stack, form, domain, function)",
        pointer: "/identity/fingerprint",
        expected,
        actual: identity.fingerprint,
      });
    }
  } else {
    // Legacy nested pillar objects (v0.1–v0.6)
    const legacyIdentity = identity as {
      fingerprint?: string;
      stack?: { id?: string };
      form?: { id?: string };
      domain?: { id?: string };
      function?: { id?: string };
    };
    const ids = [
      legacyIdentity.stack?.id,
      legacyIdentity.form?.id,
      legacyIdentity.domain?.id,
      legacyIdentity.function?.id,
    ];
    const hashes = ids.map(canonicalHash);
    if (hashes.some(h => h === null)) return { errors, warnings: [] };
    const expected = hashes.join("");
    if (identity.fingerprint !== expected) {
      errors.push({
        code: "fingerprint-mismatch",
        message: "identity.fingerprint does not equal concat of pillar hashes",
        pointer: "/identity/fingerprint",
        expected,
        actual: identity.fingerprint,
      });
    }
  }

  return { errors, warnings: [] };
}
