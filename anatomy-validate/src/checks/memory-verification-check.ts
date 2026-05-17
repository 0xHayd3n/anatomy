// src/checks/memory-verification-check.ts
// v0.2 memory: validate the optional last_verified_at + verified_by fields.
//   - memory-verified-by-malformed (error): a verified_by item doesn't match
//     the attribution regex.
//   - memory-verified-by-too-many (warning): verified_by has > 5 entries
//     (the schema's maxItems is 5; this fires when an over-long array slips
//     past schema validation, e.g. via a v0.2 file written by a non-conformant
//     producer that still satisfies additionalProperties:true).
//   - memory-last-verified-before-at (warning): last_verified_at < at, which
//     almost always means a typo or clock skew rather than a meaningful state.

import type { ValidationError, Warning } from "../errors.js";

interface Entry {
  at?: unknown;
  last_verified_at?: unknown;
  verified_by?: unknown;
}

const ATTRIBUTION_RE = /^(claude-session(:[a-z0-9-]+)?|human:[a-z0-9._-]+|@[a-z0-9._-]+)$/;
const MAX_VERIFIED_BY = 5;

export function memoryVerificationCheck(
  doc: unknown,
): { errors: ValidationError[]; warnings: Warning[] } {
  const errors: ValidationError[] = [];
  const warnings: Warning[] = [];
  const d = doc as { entries?: unknown };
  const entries = Array.isArray(d.entries) ? (d.entries as Entry[]) : [];
  if (entries.length === 0) return { errors, warnings };

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];

    // verified_by malformed item
    if (Array.isArray(e.verified_by)) {
      for (let j = 0; j < e.verified_by.length; j++) {
        const v = e.verified_by[j];
        if (typeof v !== "string" || !ATTRIBUTION_RE.test(v)) {
          errors.push({
            code: "memory-verified-by-malformed",
            message: `verified_by[${j}] is not a valid attribution string (expected human:<handle> | claude-session[:<model>] | @<handle>)`,
            pointer: `/entries/${i}/verified_by/${j}`,
            actual: typeof v === "string" ? v : `(${typeof v})`,
          });
        }
      }
      // verified_by too many (warning — schema's maxItems should catch this,
      // but a forward-compat additionalProperties:true read of a malformed
      // file could surface it here too)
      if (e.verified_by.length > MAX_VERIFIED_BY) {
        warnings.push({
          code: "memory-verified-by-too-many",
          message: `verified_by has ${e.verified_by.length} entries; the schema cap is ${MAX_VERIFIED_BY}. CLI writers truncate to the most recent ${MAX_VERIFIED_BY} via LRU on next verify.`,
          pointer: `/entries/${i}/verified_by`,
        });
      }
    }

    // last_verified_at < at
    if (typeof e.last_verified_at === "string" && typeof e.at === "string") {
      // ISO-8601 lexical compare matches chronological order for normalized
      // strings, which both fields are required by schema:format:date-time.
      if (e.last_verified_at < e.at) {
        warnings.push({
          code: "memory-last-verified-before-at",
          message: `last_verified_at (${e.last_verified_at}) is before the entry's creation timestamp (${e.at}); usually a typo or clock skew`,
          pointer: `/entries/${i}/last_verified_at`,
        });
      }
    }
  }

  return { errors, warnings };
}
