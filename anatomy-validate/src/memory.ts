// src/memory.ts
// Public API for validating .anatomy-memory files.
// Separate entry point from validate() because memory has its own schema track.

import { parseAnatomyToml } from "./parse.js";
import { compiledMemorySchemas } from "./schema-memory.js";
import { memoryFingerprintCheck } from "./checks/memory-fingerprint-check.js";
import { memorySupersessionCheck } from "./checks/memory-supersession-check.js";
import { memoryDanglingRefCheck } from "./checks/memory-dangling-ref-check.js";
import { memoryVerificationCheck } from "./checks/memory-verification-check.js";
import type { ValidationError, Warning } from "./errors.js";

export interface MemoryValidateOptions {
  /** Optional fingerprint of the paired .anatomy file. When provided, runs
   *  memory-fingerprint-mismatch check. */
  anatomyFingerprint?: string;
  /** Optional repo root for filesystem-aware checks (memory-dangling-ref). */
  repoRoot?: string;
}

export type MemoryValidateResult =
  | { ok: true; value: unknown; warnings: Warning[] }
  | { ok: false; errors: ValidationError[]; warnings: Warning[] };

export function validateMemory(text: string, options?: MemoryValidateOptions): MemoryValidateResult {
  // 1. Parse (with TomlDate → ISO string normalization)
  const parsed = parseAnatomyToml(text);
  if (!parsed.ok) {
    return { ok: false, errors: [parsed.error], warnings: [] };
  }
  const doc = parsed.doc;

  const errors: ValidationError[] = [];
  const warnings: Warning[] = [];

  // 2. Schema check — route by anatomy_memory_version
  const version = (doc as { anatomy_memory_version?: unknown })?.anatomy_memory_version;
  if (typeof version !== "string") {
    errors.push({
      code: "missing-anatomy-memory-version",
      message: "anatomy_memory_version is missing or not a string",
      pointer: "/anatomy_memory_version",
    });
    return { ok: false, errors, warnings };
  }
  const compiled = compiledMemorySchemas.get(version);
  if (!compiled) {
    errors.push({
      code: "unsupported-memory-version",
      message: `unsupported memory schema version: ${version}`,
      pointer: "/anatomy_memory_version",
    });
    return { ok: false, errors, warnings };
  }
  const valid = compiled(doc);
  if (!valid && compiled.errors) {
    for (const e of compiled.errors) {
      errors.push({
        code: "schema-violation",
        message: e.message ?? "schema violation",
        pointer: e.instancePath || "/",
      });
    }
  }

  // 3. Fingerprint check (option-driven)
  if (options?.anatomyFingerprint && errors.length === 0) {
    const r = memoryFingerprintCheck(doc, options.anatomyFingerprint);
    errors.push(...r.errors);
    warnings.push(...r.warnings);
  }

  // 4. Cross-entry checks — only meaningful when schema-valid so far
  if (errors.length === 0) {
    const r = memorySupersessionCheck(doc);
    errors.push(...r.errors);
    warnings.push(...r.warnings);
  }

  // 4b. v0.2 verification-field checks (last_verified_at, verified_by). These
  // run regardless of declared version because v0.1 files can carry the new
  // fields too (the v0.1 schema's $defs.entry now accepts additionalProperties),
  // and v0.1 consumers reading v0.2 files should still flag malformed verified_by.
  if (errors.length === 0) {
    const r = memoryVerificationCheck(doc);
    errors.push(...r.errors);
    warnings.push(...r.warnings);
  }

  // 5. Filesystem-aware checks — only when repoRoot provided
  if (options?.repoRoot && errors.length === 0) {
    const r = memoryDanglingRefCheck(doc, options.repoRoot);
    errors.push(...r.errors);
    warnings.push(...r.warnings);
  }

  if (errors.length === 0) {
    return { ok: true, value: doc, warnings };
  }
  return { ok: false, errors, warnings };
}
