// src/checks/memory-dangling-ref-check.ts
// Warns (does not error) on entry refs that look like local paths but no
// longer exist on disk. Soft signal — file moves are common; right action
// is human review, not auto-fix.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ValidationError, Warning } from "../errors.js";

interface Entry {
  refs?: unknown;
}

export function memoryDanglingRefCheck(
  doc: unknown,
  repoRoot: string,
): { errors: ValidationError[]; warnings: Warning[] } {
  const warnings: Warning[] = [];
  const d = doc as { entries?: unknown };
  const entries = Array.isArray(d.entries) ? (d.entries as Entry[]) : [];

  for (let i = 0; i < entries.length; i++) {
    const refs = entries[i].refs;
    if (!Array.isArray(refs)) continue;
    for (let j = 0; j < refs.length; j++) {
      const ref = refs[j];
      if (typeof ref !== "string") continue;
      // Skip git: and entry: refs — only check local paths
      if (ref.startsWith("git:") || ref.startsWith("entry:")) continue;
      const abs = resolve(repoRoot, ref);
      if (!existsSync(abs)) {
        warnings.push({
          code: "memory-dangling-ref",
          message: `entry refs path that no longer exists: ${ref}`,
          pointer: `/entries/${i}/refs/${j}`,
        });
      }
    }
  }

  return { errors: [], warnings };
}
