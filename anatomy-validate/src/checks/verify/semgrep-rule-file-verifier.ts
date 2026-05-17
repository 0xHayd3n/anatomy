// src/checks/verify/semgrep-rule-file-verifier.ts
// YAML-rule-file verifier for [[rules]].verify with kind="semgrep" and rule_file
// field. Resolves the rule file relative to repo root, refuses path-escape
// attempts (emits verify-rule-file-outside-repo as ERROR — the only verify code
// that is not a warning), then shells out to `semgrep --config <path>`.
//
// Returns { errors, warnings } separately so the path-escape ERROR can flow
// into the dispatcher's errors[] slot. All other verifiers return Warning[]
// directly because they only ever produce warnings.

import { spawnSync } from "node:child_process";
import { glob, access } from "node:fs/promises";
import { resolve, join, sep as platformSep } from "node:path";
import type { Warning, ValidationError } from "../../errors.js";
import type { SemgrepRuleFileConfig } from "./types.js";
import { getSemgrep } from "./detect-semgrep.js";

const MAX_LISTED_HITS = 5;
const TIMEOUT_MS = 60_000;
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;

const RULE_FILE_ERROR_SIGNALS = [
  "Invalid rule",
  "Failed to parse rule",
  "Syntax error in rule",
  "missing required field",
];

function toPosix(p: string): string {
  return platformSep === "/" ? p : p.split(platformSep).join("/");
}

async function collectMatches(repoRoot: string, pattern: string): Promise<string[]> {
  const out: string[] = [];
  for await (const entry of glob(pattern, { cwd: repoRoot })) {
    out.push(toPosix(entry));
  }
  return out;
}

interface SemgrepHit {
  path: string;
  start: { line: number };
  check_id?: string;
}

interface VerifyResult {
  errors: ValidationError[];
  warnings: Warning[];
}

const warning = (w: Warning): VerifyResult => ({ errors: [], warnings: [w] });
const warnings = (ws: Warning[]): VerifyResult => ({ errors: [], warnings: ws });
const error = (e: ValidationError): VerifyResult => ({ errors: [e], warnings: [] });
const empty = (): VerifyResult => ({ errors: [], warnings: [] });

export async function verifySemgrepRuleFile(
  repoRoot: string,
  cfg: SemgrepRuleFileConfig,
  pointer: string,
): Promise<VerifyResult> {
  const detection = getSemgrep();
  if (!detection.available) {
    return warning({
      code: "verify-semgrep-unavailable",
      message:
        `verify rule with kind="semgrep" requires the semgrep binary on PATH. ` +
        `Install with 'pip install semgrep' or 'brew install semgrep'. Rule skipped.`,
      pointer,
    });
  }

  // Path-escape check FIRST — refuse to even check existence outside repo.
  const resolvedRule = resolve(repoRoot, cfg.rule_file);
  const repoRootWithSep = repoRoot.endsWith(platformSep) ? repoRoot : repoRoot + platformSep;
  if (!resolvedRule.startsWith(repoRootWithSep) && resolvedRule !== repoRoot) {
    return error({
      code: "verify-rule-file-outside-repo",
      message:
        `verify rule_file "${cfg.rule_file}" resolves outside the repo root ` +
        `(${resolvedRule}). Refusing to invoke semgrep with a non-repo rule file.`,
      pointer,
    });
  }

  // Existence check.
  try {
    await access(resolvedRule);
  } catch {
    return warning({
      code: "verify-rule-file-missing",
      message:
        `verify rule_file "${cfg.rule_file}" does not exist or is not readable at ${resolvedRule}.`,
      pointer,
    });
  }

  const targetGlob = cfg.expect_in ?? cfg.forbid_in;
  if (!targetGlob) return empty();

  const files = await collectMatches(repoRoot, targetGlob);
  if (files.length === 0) {
    return warning({
      code: "verify-no-files-matched",
      message: `Glob "${targetGlob}" matched 0 files; semgrep verify skipped.`,
      pointer,
    });
  }

  const absFiles = files.map(f => join(repoRoot, f));
  let result: ReturnType<typeof spawnSync>;
  try {
    result = spawnSync(
      "semgrep",
      ["--json", "--config", resolvedRule, ...absFiles],
      {
        shell: true,
        encoding: "buffer",
        timeout: TIMEOUT_MS,
        maxBuffer: MAX_BUFFER_BYTES,
        cwd: repoRoot,
      },
    );
  } catch (err) {
    return warning({
      code: "verify-semgrep-unavailable",
      message: `semgrep spawn failed: ${err instanceof Error ? err.message : String(err)}`,
      pointer,
    });
  }

  if (result.error || result.signal === "SIGTERM") {
    return warning({
      code: "verify-semgrep-unavailable",
      message: `semgrep invocation failed: ${result.error?.message ?? "timeout after 60s"}`,
      pointer,
    });
  }

  const stderr = result.stderr.toString("utf8");
  if (result.status !== 0) {
    const ruleErrLine = stderr.split("\n").find(l =>
      RULE_FILE_ERROR_SIGNALS.some(s => l.includes(s)),
    );
    if (ruleErrLine) {
      return warning({
        code: "verify-invalid-rule-file",
        message: `semgrep rejected rule_file "${cfg.rule_file}": ${ruleErrLine.trim()}`,
        pointer,
      });
    }
    return warning({
      code: "verify-semgrep-unavailable",
      message: `semgrep exited with status ${result.status}. stderr: ${stderr.slice(0, 200)}`,
      pointer,
    });
  }

  let hits: SemgrepHit[];
  try {
    const parsed = JSON.parse(result.stdout.toString("utf8")) as { results?: SemgrepHit[] };
    hits = parsed.results ?? [];
  } catch {
    return warning({
      code: "verify-semgrep-unavailable",
      message: `semgrep stdout was not valid JSON. stderr: ${stderr.slice(0, 200)}`,
      pointer,
    });
  }

  if (cfg.expect_in !== undefined && hits.length === 0) {
    return warning({
      code: "verify-pattern-not-matched",
      message:
        `semgrep rule_file "${cfg.rule_file}" did not match any occurrence ` +
        `in "${targetGlob}".`,
      pointer,
    });
  }

  if (cfg.forbid_in !== undefined && hits.length > 0) {
    return warnings(hits.slice(0, MAX_LISTED_HITS).map(h => ({
      code: "verify-pattern-found-where-forbidden" as const,
      message:
        `semgrep rule_file "${cfg.rule_file}" matched at ${h.path}:${h.start.line} ` +
        `in forbidden glob "${cfg.forbid_in}".`,
      pointer,
    })));
  }

  return empty();
}
