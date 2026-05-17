// src/checks/interface-form-check.ts
// Enforces the form ↔ interface variant matrix from spec §7.2.
// Matching is by substring on the canonical form id, evaluated top-to-bottom;
// first match wins:
//   contains "cli"     → subcommands
//   contains "api"     → endpoints
//   contains "service" → endpoints
//   contains "library" → exports
//   anything else      → [interface] must be absent
// A form id like "cli-library" matches "cli" first; the only valid variant
// is "subcommands".
//
// Version-aware identity read:
//   v0.7+: identity.form is a plain string (flat identity)
//   v0.1-v0.6: identity.form is { id, hash } (nested-pillar identity)

import type { ValidationError, Warning } from "../errors.js";

const RULES: Array<{ substr: string; variant: "subcommands" | "endpoints" | "exports" }> = [
  { substr: "cli", variant: "subcommands" },
  { substr: "api", variant: "endpoints" },
  { substr: "service", variant: "endpoints" },
  { substr: "library", variant: "exports" },
];

const VARIANT_KEYS: ReadonlyArray<"exports" | "endpoints" | "subcommands"> = ["exports", "endpoints", "subcommands"];

export function interfaceFormCheck(doc: unknown): {
  errors: ValidationError[];
  warnings: Warning[];
} {
  const d = doc as {
    anatomy_version?: string;
    identity?: { form?: string | { id?: string } };
    interface?: Record<string, unknown>;
  };
  const iface = d?.interface;
  if (!iface) return { errors: [], warnings: [] };

  // v0.7 has flat string pillars; earlier versions wrap each pillar in an
  // object with an id. Read both shapes.
  const formField = d?.identity?.form;
  const formId = typeof formField === "string"
    ? formField
    : (formField && typeof formField.id === "string" ? formField.id : undefined);
  if (typeof formId !== "string") return { errors: [], warnings: [] }; // schema-check catches missing form

  const presentVariant = VARIANT_KEYS.find(k => iface[k] !== undefined);
  if (!presentVariant) return { errors: [], warnings: [] }; // schema's oneOf catches this

  const matched = RULES.find(r => formId.includes(r.substr));
  const allowed = matched?.variant;

  if (!allowed) {
    return {
      errors: [{
        code: "interface-form-mismatch",
        message: `form id ${JSON.stringify(formId)} does not match any [interface] variant; [interface] must be absent`,
        pointer: "/interface",
        actual: formId,
      }],
      warnings: [],
    };
  }

  if (presentVariant !== allowed) {
    return {
      errors: [{
        code: "interface-form-mismatch",
        message: `form id ${JSON.stringify(formId)} matches '${matched!.substr}' (allowed variant: ${allowed}); got: ${presentVariant}`,
        pointer: `/interface/${presentVariant}`,
        expected: allowed,
        actual: presentVariant,
      }],
      warnings: [],
    };
  }

  return { errors: [], warnings: [] };
}
