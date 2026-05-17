// src/index.ts
// Public API for @anatomytool/validate.
//
// validate(text, options?) runs a fixed pipeline:
//   parse → schema → hash → fingerprint → description-warn
// Plus an option-driven version-mismatch check after parse.
//
// All checks run regardless of prior failures (except: parse failure
// short-circuits since there's no doc to inspect). Errors and warnings
// surface in stable order (parse first, then schema, then validator-side
// checks, then warnings).

import { parseAnatomyToml } from "./parse.js";
import { schemaCheck } from "./checks/schema-check.js";
import { hashCheck } from "./checks/hash-check.js";
import { fingerprintCheck } from "./checks/fingerprint-check.js";
import { descriptionWarnCheck } from "./checks/description-warn.js";
import { structurePathCheck } from "./checks/structure-path-check.js";
import { sourcePathCheck } from "./checks/source-path-check.js";
import { nestedPathEscapeCheck } from "./checks/nested-path-escape.js";
import { sourceCrossCheck } from "./checks/source-cross-check.js";
import { interfaceFormCheck } from "./checks/interface-form-check.js";
import { entryPointAliasWarn } from "./checks/entry-point-alias-warn.js";
import { commandsNoTestWarn } from "./checks/commands-no-test-warn.js";
import { verifyCheck } from "./checks/verify-check.js";
import type { ValidationError, Warning } from "./errors.js";
import type { AnatomyDoc } from "./types.js";

export type { AnatomyDoc } from "./types.js";
export type { ValidationError, Warning, ErrorCode, WarningCode } from "./errors.js";
export { verifyCheck } from "./checks/verify-check.js";
export type { VerifyCheckOptions } from "./checks/verify-check.js";
export { findAnatomyForPath, discoverAllAnatomies } from "./discovery.js";
export { canonicalize, hash, canonicalHash, fingerprintFromPillars } from "./canonical.js";
export type { DiscoverOptions } from "./discovery.js";
export { validateTree } from "./validate-tree.js";
export type { TreeValidateResult, ValidateTreeOptions } from "./validate-tree.js";
export { validateMemory } from "./memory.js";
export type { MemoryValidateOptions, MemoryValidateResult } from "./memory.js";

/** Ecosystem version implemented by this consumer. v0.3 = cascading-aware. */
export const ECOSYSTEM_VERSION = "0.3";

export interface ValidateOptions {
  /** Optional: assert the file declares this anatomy_version. Mismatch
   *  produces a "version-mismatch" error pointing at /anatomy_version. */
  expectedVersion?: string;
  /** When provided, enables filesystem-aware checks: existence of paths in
   *  [structure].entries (v0.2) and the structured form of phrase_with_source.source.path
   *  (v0.2). When absent, those checks are skipped. */
  repoRoot?: string;
  /** v0.3: relative POSIX-style path from repoRoot to the directory containing
   *  this .anatomy file. Use "" for a root .anatomy. When set together with
   *  repoRoot:
   *    - structurePathCheck and sourcePathCheck resolve paths relative to
   *      repoRoot/anatomyDir
   *    - nestedPathEscapeCheck is enabled
   *  When omitted, behavior is exactly v0.2. */
  anatomyDir?: string;
}

export type ValidateResult =
  | { ok: true; value: AnatomyDoc; warnings: Warning[] }
  | { ok: false; errors: ValidationError[]; warnings: Warning[] };

export async function validate(text: string, options?: ValidateOptions): Promise<ValidateResult> {
  // 1. Parse
  const parsed = parseAnatomyToml(text);
  if (!parsed.ok) {
    return { ok: false, errors: [parsed.error], warnings: [] };
  }
  const doc = parsed.doc;

  const errors: ValidationError[] = [];
  const warnings: Warning[] = [];

  // 2. Version check (option-driven)
  if (options?.expectedVersion !== undefined) {
    const declared = (doc as { anatomy_version?: unknown }).anatomy_version;
    if (declared !== options.expectedVersion) {
      errors.push({
        code: "version-mismatch",
        message: `anatomy_version mismatch: expected ${JSON.stringify(options.expectedVersion)}, got ${JSON.stringify(declared)}`,
        pointer: "/anatomy_version",
        expected: options.expectedVersion,
        actual: declared,
      });
    }
  }

  // 3-6. Run checks; collect errors and warnings.
  for (const check of [schemaCheck, hashCheck, fingerprintCheck, descriptionWarnCheck, interfaceFormCheck, entryPointAliasWarn, commandsNoTestWarn]) {
    const r = check(doc);
    errors.push(...r.errors);
    warnings.push(...r.warnings);
  }

  // 7. repoRoot-aware checks (skipped when repoRoot is undefined).
  const r2 = structurePathCheck(doc, options?.repoRoot, options?.anatomyDir);
  errors.push(...r2.errors);
  warnings.push(...r2.warnings);
  const r3 = sourcePathCheck(doc, options?.repoRoot, options?.anatomyDir);
  errors.push(...r3.errors);
  warnings.push(...r3.warnings);
  const r4 = nestedPathEscapeCheck(doc, options?.anatomyDir);
  errors.push(...r4.errors);
  warnings.push(...r4.warnings);
  const r5 = sourceCrossCheck(doc, options?.repoRoot, options?.anatomyDir);
  errors.push(...r5.errors);
  warnings.push(...r5.warnings);

  const rVerify = await verifyCheck(doc, { repoRoot: options?.repoRoot });
  errors.push(...rVerify.errors);
  warnings.push(...rVerify.warnings);

  if (errors.length === 0) {
    return { ok: true, value: doc as unknown as AnatomyDoc, warnings };
  }
  return { ok: false, errors, warnings };
}
