// src/commands/validate.ts
// `anatomy validate [<path>]` — wraps @anatomy/validate's single-file mode.
// Resolves repoRoot from the validated file's dirname (intentional v0.1
// behavior; tree-mode workflows use validateTree directly).

import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { validate, validateMemory } from "@anatomy/validate";
import type { ValidationError, Warning } from "@anatomy/validate";
import { readAnatomyFile, readAnatomyMemoryFile } from "../io.js";
import { debug } from "../log.js";

const STRICT_ELEVATABLE_CODES = new Set([
  "unused-dependency-claim",
  "literal-not-in-source",
  "source-cross-check-truncated",
  // v0.12 verify codes (excluded from elevation:
  //   verify-ast-grep-unavailable (env issue, not source drift)
  //   verify-invalid-pattern      (author bug, not source drift)
  //   verify-source-scan-truncated (informational, not a fail signal)):
  "verify-glob-empty",
  "verify-glob-unexpected-files",
  "verify-glob-outside-container",
  "verify-pattern-not-matched",
  "verify-pattern-found-where-forbidden",
  // v0.13 semgrep verify codes (excluded from elevation for same reasons:
  //   verify-semgrep-unavailable  (env issue — semgrep not on PATH)
  //   verify-invalid-rule-file    (author bug — semgrep rejected the YAML)
  //   verify-rule-file-missing    (author bug — path is wrong)
  //   verify-rule-file-outside-repo is already an ERROR in both modes):
  "verify-no-files-matched",
]);

export interface ValidateOptions {
  quiet?: boolean;
  /** Exit 1 when no .anatomy is found. Default: warn to stderr + exit 0. */
  require?: boolean;
  /** Emit structured JSON to stdout; human messages go to stderr. */
  json?: boolean;
  /** Exit 1 if .anatomy was generated at a different commit than current git HEAD. */
  requireFresh?: boolean;
  /** Suppress strict-by-default elevation: cross-check warnings stay as
   *  warnings instead of being elevated to errors. The CLI accepts `--strict`
   *  for backward compatibility (now a silent no-op). */
  noStrict?: boolean;
}

export async function validateCommand(rawPath: string | undefined, opts: ValidateOptions): Promise<number> {
  const target = rawPath ?? "./.anatomy";

  const notFound = (msg: string): number => {
    if (opts.json) {
      process.stdout.write(JSON.stringify({ ok: false, found: false, errors: [], warnings: [] }) + "\n");
    }
    if (opts.require) {
      process.stderr.write(`anatomy: ${msg}\n`);
      return 1;
    }
    process.stderr.write(`anatomy: warning: ${msg} (use --require to treat this as an error)\n`);
    return 0;
  };

  if (!existsSync(target)) {
    return notFound(`file not found: ${target}`);
  }
  const stat = statSync(target);
  let path: string;
  if (stat.isDirectory()) {
    path = join(target, ".anatomy");
    if (!existsSync(path)) {
      return notFound(`no .anatomy in directory: ${target}`);
    }
  } else {
    path = target;
  }
  let text: string;
  try {
    text = readAnatomyFile(path);
  } catch (err) {
    console.error(`anatomy: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  const repoRoot = dirname(resolve(path));
  debug(`validate: path=${path} bytes=${text.length} repoRoot=${repoRoot}`);
  let result = await validate(text, { repoRoot });

  // Strict-by-default: elevate source-cross-check warnings to errors before
  // downstream formatting decisions. `--no-strict` opts out (warnings stay
  // as warnings, exit code unchanged). Reassigns `result` so the rest of
  // the function sees the elevated form unchanged.
  if (!opts.noStrict) {
    const movedToErrors: ValidationError[] = [];
    const remainingWarnings: Warning[] = [];
    for (const w of result.warnings) {
      if (STRICT_ELEVATABLE_CODES.has(w.code)) {
        movedToErrors.push({
          code: w.code as unknown as ValidationError["code"],
          message: w.message,
          pointer: w.pointer,
          actual: w.actual,
        });
      } else {
        remainingWarnings.push(w);
      }
    }
    if (movedToErrors.length > 0) {
      const existingErrors = result.ok ? [] : result.errors;
      result = {
        ok: false,
        errors: [...existingErrors, ...movedToErrors],
        warnings: remainingWarnings,
      };
    }
  }

  debug(`validate: ok=${result.ok} errors=${result.ok ? 0 : result.errors.length} warnings=${result.warnings.length}`);

  // --require-fresh: compare generated.commit against current HEAD
  if (opts.requireFresh && result.ok) {
    const doc = result.value as unknown as Record<string, unknown>;
    const generated = doc.generated as Record<string, unknown> | undefined;
    const storedCommit = typeof generated?.commit === "string" ? generated.commit : undefined;
    if (!storedCommit) {
      process.stderr.write(`anatomy: --require-fresh: ${path} has no generated.commit — regenerate with \`anatomy generate\`\n`);
      return 1;
    }
    const git = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
      cwd: repoRoot,
      shell: true,
    });
    if (git.status !== 0 || !git.stdout) {
      process.stderr.write(`anatomy: --require-fresh: could not read git HEAD (not a git repo?)\n`);
      return 1;
    }
    const head = git.stdout.trim();
    // Prefix match in either direction: `git rev-parse --short HEAD` length
    // depends on `core.abbrev` (default 7, but configurable). A file generated
    // with abbrev=7 and validated with abbrev=12 (or vice versa) would
    // otherwise look stale despite being the same commit. Same logic as
    // resolve.ts:checkStaleness uses for the staleness banner.
    const sameCommit = storedCommit.startsWith(head) || head.startsWith(storedCommit);
    if (!sameCommit) {
      process.stderr.write(
        `anatomy: stale: .anatomy was generated at commit ${storedCommit}, HEAD is ${head}\n` +
        `  Run \`anatomy generate --ai\` to regenerate\n`
      );
      return 1;
    }
  }

  // Memory validation — separate validator call merged into the existing output flow
  const memoryPath = join(repoRoot, ".anatomy-memory");
  let memoryErrors: ValidationError[] = [];
  let memoryWarnings: Warning[] = [];
  let memoryValidated = false;
  if (existsSync(memoryPath)) {
    memoryValidated = true;
    let anatomyFingerprint: string | undefined;
    if (result.ok) {
      const doc = result.value as unknown as Record<string, unknown>;
      const id = doc.identity as Record<string, unknown> | undefined;
      const fp = id?.fingerprint;
      if (typeof fp === "string") anatomyFingerprint = fp;
    }
    let memText = "";
    try {
      memText = readAnatomyMemoryFile(memoryPath);
    } catch (err) {
      memoryErrors = [{
        code: "memory-read-error",
        message: err instanceof Error ? err.message : String(err),
        pointer: "/",
      }];
    }
    if (memText) {
      const memResult = validateMemory(memText, { anatomyFingerprint, repoRoot });
      if (!memResult.ok) memoryErrors = memResult.errors;
      memoryWarnings = memResult.warnings;
    }
  }

  if (opts.json) {
    const allErrors = [...(result.ok ? [] : result.errors), ...memoryErrors];
    const allWarnings = [...result.warnings, ...memoryWarnings];
    const allOk = result.ok && memoryErrors.length === 0;
    process.stdout.write(JSON.stringify({
      ok: allOk,
      found: true,
      path,
      memory: memoryValidated ? { found: true } : { found: false },
      errors: allErrors,
      warnings: allWarnings,
    }) + "\n");
    return allOk ? 0 : 1;
  }

  const allOk = result.ok && memoryErrors.length === 0;
  const allWarnings = [...result.warnings, ...memoryWarnings];
  if (allOk && allWarnings.length === 0) {
    if (!opts.quiet) {
      console.log(`✓ ${path}`);
      if (memoryValidated) console.log(`✓ ${memoryPath}`);
    }
    return 0;
  }
  const seenCodes = new Set<string>();
  const note = (code: string) => seenCodes.add(code);

  if (allOk) {
    console.log(`⚠ ${path}`);
    for (const w of result.warnings) {
      console.log(`  WARN ${w.code} at ${w.pointer || "/"}: ${w.message}`);
      note(w.code);
    }
    if (memoryValidated) {
      console.log(`⚠ ${memoryPath}`);
      for (const w of memoryWarnings) {
        console.log(`  WARN ${w.code} at ${w.pointer || "/"}: ${w.message}`);
        note(w.code);
      }
    }
    if (seenCodes.size > 0) console.log(`  (run \`anatomy explain <code>\` for details)`);
    return 0;
  }
  if (!result.ok) {
    console.log(`✗ ${path}`);
    for (const e of result.errors) {
      console.log(`  ERR ${e.code} at ${e.pointer || "/"}: ${e.message}`);
      note(e.code);
    }
    for (const w of result.warnings) {
      console.log(`  WARN ${w.code} at ${w.pointer || "/"}: ${w.message}`);
      note(w.code);
    }
  }
  if (memoryValidated && memoryErrors.length > 0) {
    console.log(`✗ ${memoryPath}`);
    for (const e of memoryErrors) {
      console.log(`  ERR ${e.code} at ${e.pointer || "/"}: ${e.message}`);
      note(e.code);
    }
    for (const w of memoryWarnings) {
      console.log(`  WARN ${w.code} at ${w.pointer || "/"}: ${w.message}`);
      note(w.code);
    }
  }
  if (seenCodes.size > 0) console.log(`  (run \`anatomy explain <code>\` for details)`);
  return 1;
}
