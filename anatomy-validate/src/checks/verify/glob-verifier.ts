// src/checks/verify/glob-verifier.ts
// Pure glob-based verifiers (no native deps). Uses Node 22+'s built-in
// `glob` from node:fs/promises. All globs are repo-root-relative; results
// are joined with the repo root for human-readable warning messages.
// Windows path separators are normalized to forward slash at the boundary.

import { glob } from "node:fs/promises";
import { sep as platformSep } from "node:path";
import type { Warning } from "../../errors.js";
import type { GlobExistsConfig, GlobOnlyConfig } from "./types.js";

const MAX_LISTED_FILES = 5;

/** Normalize platform path to POSIX (forward slash) for stable display + glob matching. */
function toPosix(p: string): string {
  return platformSep === "/" ? p : p.split(platformSep).join("/");
}

/** Collect all matches for a glob under repoRoot, returning POSIX-style relative paths. */
async function collectMatches(repoRoot: string, pattern: string): Promise<string[]> {
  const out: string[] = [];
  for await (const entry of glob(pattern, { cwd: repoRoot })) {
    out.push(toPosix(entry));
  }
  return out;
}

export async function verifyGlobExists(
  repoRoot: string,
  cfg: GlobExistsConfig,
  pointer: string,
): Promise<Warning[]> {
  const matches = await collectMatches(repoRoot, cfg.path);
  if (cfg.should_not === true) {
    if (matches.length > 0) {
      const shown = matches.slice(0, MAX_LISTED_FILES);
      return [{
        code: "verify-glob-unexpected-files",
        message: `glob "${cfg.path}" should not match any files, but matched ${matches.length}: ${shown.join(", ")}${matches.length > MAX_LISTED_FILES ? ", ..." : ""}`,
        pointer,
      }];
    }
    return [];
  }
  if (matches.length === 0) {
    return [{
      code: "verify-glob-empty",
      message: `glob "${cfg.path}" matched no files (expected ≥1).`,
      pointer,
    }];
  }
  return [];
}

export async function verifyGlobOnly(
  repoRoot: string,
  cfg: GlobOnlyConfig,
  pointer: string,
): Promise<Warning[]> {
  const matchFiles = await collectMatches(repoRoot, cfg.match);
  if (matchFiles.length === 0) return [];
  const containerFiles = new Set(await collectMatches(repoRoot, cfg.container));
  const violations = matchFiles.filter(f => !containerFiles.has(f));
  if (violations.length === 0) return [];
  const shown = violations.slice(0, MAX_LISTED_FILES);
  return [{
    code: "verify-glob-outside-container",
    message: `glob "${cfg.match}" matched ${violations.length} file(s) outside container "${cfg.container}": ${shown.join(", ")}${violations.length > MAX_LISTED_FILES ? ", ..." : ""}`,
    pointer,
  }];
}
