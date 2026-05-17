// src/checks/description-warn.ts
// Validator-side warning: description > 500 characters. Schema does NOT
// enforce this (a maxLength constraint would be an error, not a warning;
// JSON Schema can't model warnings).

import type { ValidationError, Warning } from "../errors.js";

const MAX_DESCRIPTION_LENGTH = 500;

export function descriptionWarnCheck(doc: unknown): {
  errors: ValidationError[];
  warnings: Warning[];
} {
  const desc = (doc as { description?: unknown })?.description;
  if (typeof desc !== "string") return { errors: [], warnings: [] };
  if (desc.length <= MAX_DESCRIPTION_LENGTH) return { errors: [], warnings: [] };

  return {
    errors: [],
    warnings: [
      {
        code: "description-too-long",
        message: `description exceeds ${MAX_DESCRIPTION_LENGTH} characters (actual: ${desc.length})`,
        pointer: "/description",
      },
    ],
  };
}
