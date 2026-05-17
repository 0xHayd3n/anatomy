// src/checks/verify-check.ts
// Dispatcher for [[rules]].verify clauses. Walks the rules array; for each
// entry with a verify field, dispatches to the appropriate verifier:
//   kind="glob_exists"  -> verifyGlobExists
//   kind="glob_only"    -> verifyGlobOnly
//   kind="ast_pattern"  -> verifyAstPattern (lazy-loads @ast-grep/napi)
// Returns aggregated { errors: [], warnings: [...] } per the project's
// never-throw rule. When repoRoot is undefined, skips silently (matches
// existing source-cross-check behavior).
//
// ANATOMY_VERIFY_SKIP=1 bypasses verify-check entirely (escape hatch for
// slow CI runs or environments without ast-grep).

import type { ValidationError, Warning } from "../errors.js";
import type { VerifyConfig } from "./verify/types.js";
import { verifyGlobExists, verifyGlobOnly } from "./verify/glob-verifier.js";
import { verifyAstPattern } from "./verify/ast-grep-verifier.js";
import { verifySemgrepPattern } from "./verify/semgrep-pattern-verifier.js";
import { verifySemgrepRuleFile } from "./verify/semgrep-rule-file-verifier.js";

export interface VerifyCheckOptions {
  repoRoot?: string;
}

export async function verifyCheck(
  doc: unknown,
  opts: VerifyCheckOptions,
): Promise<{ errors: ValidationError[]; warnings: Warning[] }> {
  if (process.env.ANATOMY_VERIFY_SKIP === "1") return { errors: [], warnings: [] };
  if (!opts.repoRoot) return { errors: [], warnings: [] };
  const rules = (doc as { rules?: unknown }).rules;
  if (!Array.isArray(rules)) return { errors: [], warnings: [] };

  const errors: ValidationError[] = [];
  const warnings: Warning[] = [];
  for (let i = 0; i < rules.length; i++) {
    const entry = rules[i] as { verify?: VerifyConfig } | undefined;
    const verify = entry?.verify;
    if (!verify || typeof verify !== "object") continue;
    const pointer = `/rules/${i}/verify`;
    try {
      if (verify.kind === "glob_exists") {
        warnings.push(...await verifyGlobExists(opts.repoRoot, verify, pointer));
      } else if (verify.kind === "glob_only") {
        warnings.push(...await verifyGlobOnly(opts.repoRoot, verify, pointer));
      } else if (verify.kind === "ast_pattern") {
        warnings.push(...await verifyAstPattern(opts.repoRoot, verify, pointer));
      } else if (verify.kind === "semgrep") {
        if ("pattern" in verify) {
          warnings.push(...await verifySemgrepPattern(opts.repoRoot, verify, pointer));
        } else {
          const r = await verifySemgrepRuleFile(opts.repoRoot, verify, pointer);
          errors.push(...r.errors);
          warnings.push(...r.warnings);
        }
      }
    } catch (err) {
      // Defensive: a verifier exception (should never happen — verifiers
      // catch their own errors) becomes a verify-invalid-pattern warning
      // rather than crashing validation.
      warnings.push({
        code: "verify-invalid-pattern",
        message: `verify check threw: ${err instanceof Error ? err.message : String(err)}`,
        pointer,
      });
    }
  }
  return { errors, warnings };
}
