// src/checks/structure-path-check.ts
// Verifies every [[structure.entries]].path exists on disk relative to the
// caller-supplied repoRoot. When repoRoot is undefined (library callers,
// conformance fixtures), the check is a no-op — paths are not checked.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ValidationError, Warning } from "../errors.js";

export function structurePathCheck(
  doc: unknown,
  repoRoot?: string,
  anatomyDir?: string,
): {
  errors: ValidationError[];
  warnings: Warning[];
} {
  if (!repoRoot) return { errors: [], warnings: [] };

  const entries = (doc as { structure?: { entries?: Array<{ path?: string }> } })?.structure?.entries;
  if (!Array.isArray(entries)) return { errors: [], warnings: [] };

  const base = anatomyDir ? resolve(repoRoot, anatomyDir) : repoRoot;
  const errors: ValidationError[] = [];
  for (let i = 0; i < entries.length; i++) {
    const p = entries[i]?.path;
    if (typeof p !== "string") continue; // schema-check catches malformed
    const abs = resolve(base, p);
    if (!existsSync(abs)) {
      errors.push({
        code: "structure-path-not-found",
        message: `structure entry path not found: ${p}`,
        pointer: `/structure/entries/${i}/path`,
        actual: p,
      });
    }
  }
  return { errors, warnings: [] };
}
