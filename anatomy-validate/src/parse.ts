// src/parse.ts
// TOML parsing with TomlDate → ISO string normalization (so AJV's
// format: date-time validates the parsed JSON-equivalent model per
// the design Section 5).

import { parse as parseToml } from "smol-toml";
import type { ValidationError } from "./errors.js";

export type ParseResult =
  | { ok: true; doc: Record<string, unknown> }
  | { ok: false; error: ValidationError };

/**
 * Parse a TOML string into its JSON-equivalent object model.
 * smol-toml returns TomlDate (subclass of Date) for native datetimes;
 * we normalize via Date.prototype.toISOString() so AJV's format:date-time
 * validates the string representation. Returns a structured error on
 * parse failure rather than throwing.
 */
export function parseAnatomyToml(text: string): ParseResult {
  try {
    const raw = parseToml(text);
    return { ok: true, doc: normalizeDates(raw) as Record<string, unknown> };
  } catch (err) {
    // smol-toml throws TomlError with `line` and `column` properties (1-based).
    const e = err as { message?: string; line?: number; column?: number };
    return {
      ok: false,
      error: {
        code: "toml-parse-error",
        message: e.message ?? String(err),
        pointer: "",
        source:
          typeof e.line === "number" && typeof e.column === "number"
            ? { line: e.line, column: e.column }
            : undefined,
      },
    };
  }
}

function normalizeDates(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeDates);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = normalizeDates(v);
    return out;
  }
  return value;
}
