// src/checks/memory-fingerprint-check.ts
// Verifies .anatomy-memory.repo_fingerprint matches the paired .anatomy's
// [identity].fingerprint. Catches accidental cross-repo memory file copies.

import type { ValidationError, Warning } from "../errors.js";

export function memoryFingerprintCheck(
  doc: unknown,
  anatomyFingerprint: string,
): { errors: ValidationError[]; warnings: Warning[] } {
  const errors: ValidationError[] = [];
  const d = doc as { repo_fingerprint?: unknown };
  if (typeof d.repo_fingerprint !== "string") return { errors, warnings: [] };
  if (d.repo_fingerprint !== anatomyFingerprint) {
    errors.push({
      code: "memory-fingerprint-mismatch",
      message: `repo_fingerprint ${JSON.stringify(d.repo_fingerprint)} does not match paired .anatomy fingerprint ${JSON.stringify(anatomyFingerprint)}`,
      pointer: "/repo_fingerprint",
      expected: anatomyFingerprint,
      actual: d.repo_fingerprint,
    });
  }
  return { errors, warnings: [] };
}
