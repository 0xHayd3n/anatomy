// src/checks/commands-no-test-warn.ts
// Validator-side warning: a v0.4+ doc declares [operation.commands] but the
// table has no key named "test". `test` is the de facto standard key for
// running the project's test suite; missing it is a soft signal that the
// commands table is incomplete. v0.1/v0.2/v0.3 docs are skipped — the
// recommendation only applies once operation.commands became a v0.4 norm.

import type { ValidationError, Warning } from "../errors.js";

const APPLICABLE_VERSIONS = new Set(["0.4", "0.5", "0.6", "0.7", "0.8"]);

export function commandsNoTestWarn(doc: unknown): {
  errors: ValidationError[];
  warnings: Warning[];
} {
  const d = doc as {
    anatomy_version?: unknown;
    operation?: { commands?: unknown };
  };

  if (typeof d?.anatomy_version !== "string") return { errors: [], warnings: [] };
  if (!APPLICABLE_VERSIONS.has(d.anatomy_version)) return { errors: [], warnings: [] };

  const commands = d?.operation?.commands;
  // Only fire when the table is actually present (a non-null object). An
  // empty/non-object commands value is left to the schema check.
  if (commands === null || typeof commands !== "object") return { errors: [], warnings: [] };

  const keys = Object.keys(commands as Record<string, unknown>);
  if (keys.length === 0) return { errors: [], warnings: [] };
  if (keys.includes("test")) return { errors: [], warnings: [] };

  return {
    errors: [],
    warnings: [
      {
        code: "commands-no-test",
        message: "[operation.commands] does not declare a 'test' key; consider adding one to document how to run the test suite",
        pointer: "/operation/commands",
      },
    ],
  };
}
