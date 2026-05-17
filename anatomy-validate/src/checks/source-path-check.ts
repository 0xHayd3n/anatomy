// src/checks/source-path-check.ts
// For [[substance.capabilities|limitations]].source:
//   - Structured form ({ path, symbol }): hard error if path doesn't exist
//     under repoRoot.
//   - String form ("path#fragment"): soft warning if the leading path doesn't
//     exist (the v0.1 string format was deliberately permissive).
// When repoRoot is undefined: skipped entirely.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ValidationError, Warning } from "../errors.js";

export function sourcePathCheck(
  doc: unknown,
  repoRoot?: string,
  anatomyDir?: string,
): {
  errors: ValidationError[];
  warnings: Warning[];
} {
  if (!repoRoot) return { errors: [], warnings: [] };

  const base = anatomyDir ? resolve(repoRoot, anatomyDir) : repoRoot;
  const errors: ValidationError[] = [];
  const warnings: Warning[] = [];
  const subst = (doc as { substance?: Record<string, Array<{ source?: unknown }> | undefined> })?.substance;
  if (!subst) return { errors, warnings };

  for (const arrName of ["capabilities", "limitations"] as const) {
    const arr = subst[arrName];
    if (!Array.isArray(arr)) continue;

    for (let i = 0; i < arr.length; i++) {
      const src = arr[i]?.source;
      if (src === undefined) continue;

      let path: string | undefined;
      let isStructured = false;

      if (typeof src === "string") {
        const hashIdx = src.indexOf("#");
        path = hashIdx === -1 ? src : src.slice(0, hashIdx);
        if (path === "") continue;
      } else if (src && typeof src === "object" && typeof (src as { path?: unknown }).path === "string") {
        path = (src as { path: string }).path;
        isStructured = true;
      }

      if (path === undefined) continue;
      if (existsSync(resolve(base, path))) continue;

      if (isStructured) {
        errors.push({
          code: "source-path-not-found",
          message: `substance.${arrName}[${i}].source.path not found: ${path}`,
          pointer: `/substance/${arrName}/${i}/source/path`,
          actual: path,
        });
      } else {
        warnings.push({
          code: "source-path-soft-not-found",
          message: `substance.${arrName}[${i}].source path not found: ${path} (string form is best-effort)`,
          pointer: `/substance/${arrName}/${i}/source`,
        });
      }
    }
  }

  return { errors, warnings };
}
