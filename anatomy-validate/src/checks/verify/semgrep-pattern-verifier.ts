// src/checks/verify/semgrep-pattern-verifier.ts
// Inline-pattern verifier for [[rules]].verify with kind="semgrep" and pattern
// + lang fields. Mirrors ast-grep-verifier shape but shells out to the optional
// `semgrep` binary on PATH. Soft-fail policy: missing binary, timeout, invalid
// JSON, or unrecognized non-zero exit all surface as verify-semgrep-unavailable
// warnings — never throws.

import { spawnSync } from "node:child_process";
import { glob } from "node:fs/promises";
import { join, sep as platformSep } from "node:path";
import type { Warning } from "../../errors.js";
import type { SemgrepPatternConfig } from "./types.js";
import { getSemgrep } from "./detect-semgrep.js";

const MAX_LISTED_HITS = 5;
const TIMEOUT_MS = 60_000;
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;

const PATTERN_ERROR_SIGNALS = [
  "Invalid pattern",
  "Syntax error",
  "Pattern error",
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

export async function verifySemgrepPattern(
  repoRoot: string,
  cfg: SemgrepPatternConfig,
  pointer: string,
): Promise<Warning[]> {
  const detection = getSemgrep();
  if (!detection.available) {
    return [{
      code: "verify-semgrep-unavailable",
      message:
        `verify rule with kind="semgrep" requires the semgrep binary on PATH. ` +
        `Install with 'pip install semgrep' or 'brew install semgrep'. Rule skipped.`,
      pointer,
    }];
  }

  const targetGlob = cfg.expect_in ?? cfg.forbid_in;
  if (!targetGlob) return []; // Schema enforces oneOf — defensive guard.

  const files = await collectMatches(repoRoot, targetGlob);
  if (files.length === 0) {
    return [{
      code: "verify-no-files-matched",
      message: `Glob "${targetGlob}" matched 0 files; semgrep verify skipped.`,
      pointer,
    }];
  }

  const absFiles = files.map(f => join(repoRoot, f));
  let result: ReturnType<typeof spawnSync>;
  try {
    result = spawnSync(
      "semgrep",
      ["--json", "--lang", cfg.lang, "--pattern", cfg.pattern, ...absFiles],
      {
        shell: true,
        encoding: "buffer",
        timeout: TIMEOUT_MS,
        maxBuffer: MAX_BUFFER_BYTES,
        cwd: repoRoot,
      },
    );
  } catch (err) {
    return [{
      code: "verify-semgrep-unavailable",
      message: `semgrep spawn failed: ${err instanceof Error ? err.message : String(err)}`,
      pointer,
    }];
  }

  if (result.error || result.signal === "SIGTERM") {
    return [{
      code: "verify-semgrep-unavailable",
      message: `semgrep invocation failed: ${result.error?.message ?? "timeout after 60s"}`,
      pointer,
    }];
  }

  const stderr = result.stderr.toString("utf8");
  if (result.status !== 0) {
    const parseErrLine = stderr.split("\n").find(l =>
      PATTERN_ERROR_SIGNALS.some(s => l.includes(s)),
    );
    if (parseErrLine) {
      return [{
        code: "verify-invalid-pattern",
        message: `semgrep rejected pattern: ${parseErrLine.trim()}`,
        pointer,
      }];
    }
    return [{
      code: "verify-semgrep-unavailable",
      message: `semgrep exited with status ${result.status}. stderr: ${stderr.slice(0, 200)}`,
      pointer,
    }];
  }

  let hits: SemgrepHit[];
  try {
    const parsed = JSON.parse(result.stdout.toString("utf8")) as { results?: SemgrepHit[] };
    hits = parsed.results ?? [];
  } catch {
    return [{
      code: "verify-semgrep-unavailable",
      message: `semgrep stdout was not valid JSON. stderr: ${stderr.slice(0, 200)}`,
      pointer,
    }];
  }

  if (cfg.expect_in !== undefined && hits.length === 0) {
    return [{
      code: "verify-pattern-not-matched",
      message:
        `semgrep pattern "${cfg.pattern}" did not match any occurrence ` +
        `in "${targetGlob}" (lang=${cfg.lang}).`,
      pointer,
    }];
  }

  if (cfg.forbid_in !== undefined && hits.length > 0) {
    return hits.slice(0, MAX_LISTED_HITS).map(h => ({
      code: "verify-pattern-found-where-forbidden" as const,
      message:
        `semgrep pattern "${cfg.pattern}" matched at ${h.path}:${h.start.line} ` +
        `in forbidden glob "${cfg.forbid_in}".`,
      pointer,
    }));
  }

  return [];
}
