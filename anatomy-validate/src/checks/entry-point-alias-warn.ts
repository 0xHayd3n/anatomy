// src/checks/entry-point-alias-warn.ts
// Soft warning when a v0.2 file uses the legacy entry_points.description key
// instead of the renamed `purpose`. The v0.2 schema accepts either spelling
// (with a `not` clause forbidding both); this check nudges maintainers to
// migrate. v0.1 files using `description` are left alone.

import type { ValidationError, Warning } from "../errors.js";

export function entryPointAliasWarn(doc: unknown): {
  errors: ValidationError[];
  warnings: Warning[];
} {
  const d = doc as {
    anatomy_version?: unknown;
    operation?: { entry_points?: Array<Record<string, unknown>> };
  };

  if (d?.anatomy_version !== "0.2") return { errors: [], warnings: [] };

  const eps = d?.operation?.entry_points;
  if (!Array.isArray(eps)) return { errors: [], warnings: [] };

  const warnings: Warning[] = [];
  for (let i = 0; i < eps.length; i++) {
    if (eps[i] && Object.prototype.hasOwnProperty.call(eps[i], "description")) {
      warnings.push({
        code: "entry-point-description-deprecated",
        message: `entry_points[${i}].description is deprecated in v0.2; rename to 'purpose'`,
        pointer: `/operation/entry_points/${i}/description`,
      });
    }
  }
  return { errors: [], warnings };
}
