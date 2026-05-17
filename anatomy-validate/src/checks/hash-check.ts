// src/checks/hash-check.ts
// Verifies each identity.<pillar>.hash equals canonicalHash(id).
// No-op for v0.7+ documents (flat identity has no per-pillar hash fields).

import { canonicalHash } from "../canonical.js";
import type { ValidationError, Warning } from "../errors.js";

const PILLARS = ["stack", "form", "domain", "function"] as const;

export function hashCheck(doc: unknown): {
  errors: ValidationError[];
  warnings: Warning[];
} {
  const d = doc as { anatomy_version?: unknown; identity?: Record<string, { id?: string; hash?: string }> };
  const errors: ValidationError[] = [];
  const identity = d.identity;
  if (!identity) return { errors, warnings: [] };
  // v0.7+ flat identity uses plain string pillars with no per-pillar hash
  // fields — skip structurally rather than via a hardcoded version set
  // (which silently fails to skip flat versions not listed).
  if (typeof (identity as Record<string, unknown>).stack === "string") return { errors, warnings: [] };

  for (const pillar of PILLARS) {
    const p = identity[pillar];
    if (!p || typeof p.id !== "string" || typeof p.hash !== "string") continue;
    const expected = canonicalHash(p.id);
    if (expected === null) continue;
    if (p.hash !== expected) {
      errors.push({
        code: "hash-content-mismatch",
        message: `identity.${pillar}.hash does not equal canonicalHash(id)`,
        pointer: `/identity/${pillar}/hash`,
        expected,
        actual: p.hash,
      });
    }
  }

  return { errors, warnings: [] };
}
