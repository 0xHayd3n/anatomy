// src/checks/schema-check.ts
// Routes the parsed doc to the matching version's compiled JSON Schema based
// on its declared anatomy_version, then maps AJV errors to ValidationError.
// An unknown or missing anatomy_version produces an unsupported-anatomy-version
// error so downstream checks can be skipped safely.

import { compiledSchemas, type AjvError } from "../schema.js";
import type { ValidationError, Warning } from "../errors.js";

export function schemaCheck(doc: unknown): {
  errors: ValidationError[];
  warnings: Warning[];
} {
  const declared = (doc as { anatomy_version?: unknown })?.anatomy_version;
  const fn = typeof declared === "string" ? compiledSchemas.get(declared) : undefined;

  if (!fn) {
    return {
      errors: [{
        code: "unsupported-anatomy-version",
        message: `unsupported anatomy_version: ${JSON.stringify(declared)}`,
        pointer: "/anatomy_version",
        actual: declared,
      }],
      warnings: [],
    };
  }

  const ok = fn(doc);
  if (ok) return { errors: [], warnings: [] };

  const errors: ValidationError[] = (fn.errors ?? []).map((e: AjvError) => ({
    code: "schema-violation" as const,
    message: e.message ?? "schema violation",
    pointer: e.instancePath, // already a JSON Pointer in AJV
    schemaKeyword: e.keyword,
  }));

  return { errors, warnings: [] };
}
