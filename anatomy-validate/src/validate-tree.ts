// src/validate-tree.ts
// Tree-mode orchestrator per spec/0.3/cascading.md §6.2.

import { readFileSync } from "node:fs";
import { relative, sep } from "node:path";
import { discoverAllAnatomies, type DiscoverOptions } from "./discovery.js";
import { validate, type ValidateResult } from "./index.js";
import type { Warning } from "./errors.js";

export interface ValidateTreeOptions extends DiscoverOptions {}

export interface TreeValidateResult {
  /** True iff every per-file result.ok is true. crossFileWarnings (warnings,
   *  not errors) NEVER affect this field. */
  ok: boolean;
  /** One entry per discovered anatomy, in deterministic (lexicographic) order
   *  of relPath. relPath uses POSIX "/" separators on every platform. */
  results: Array<{
    relPath: string;
    result: ValidateResult;
  }>;
  /** Tree-level findings. v0.3 emits only `duplicate-fingerprint-in-tree`. */
  crossFileWarnings: Warning[];
}

function toPosix(p: string): string {
  return sep === "/" ? p : p.split(sep).join("/");
}

export async function validateTree(repoRoot: string, options?: ValidateTreeOptions): Promise<TreeValidateResult> {
  const discovered = discoverAllAnatomies(repoRoot, options);

  const results: TreeValidateResult["results"] = [];
  for (const { dirPath, absPath } of discovered) {
    const relPath = toPosix(relative(repoRoot, absPath));
    const anatomyDir = toPosix(relative(repoRoot, dirPath)); // "" for root

    let result: ValidateResult;
    let text: string;
    try {
      text = readFileSync(absPath, "utf8");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result = {
        ok: false,
        errors: [{
          code: "anatomy-read-error",
          message: `failed to read .anatomy: ${msg}`,
          pointer: "",
          actual: relPath,
        }],
        warnings: [],
      };
      results.push({ relPath, result });
      continue;
    }
    result = await validate(text, { repoRoot, anatomyDir });
    results.push({ relPath, result });
  }

  // Cross-file pass: duplicate-fingerprint-in-tree.
  // Scope: only over results with ok && value defined.
  const crossFileWarnings: Warning[] = [];
  const seen = new Map<string, string>(); // fingerprint → first relPath
  for (const { relPath, result } of results) {
    if (!result.ok) continue;
    const fp = (result.value as { identity?: { fingerprint?: unknown } })?.identity?.fingerprint;
    if (typeof fp !== "string") continue;
    const prev = seen.get(fp);
    if (prev === undefined) {
      seen.set(fp, relPath);
    } else {
      crossFileWarnings.push({
        code: "duplicate-fingerprint-in-tree",
        message: `${relPath}: fingerprint duplicates earlier anatomy at ${prev}`,
        pointer: "",
      });
    }
  }

  const ok = results.every(r => r.result.ok);
  return { ok, results, crossFileWarnings };
}
