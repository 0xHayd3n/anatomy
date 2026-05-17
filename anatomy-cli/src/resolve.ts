// src/resolve.ts
// Cwd-aware nearest-anatomy resolution + validation + staleness check.
// No merge logic — v0.3 cascading is nearest-anatomy resolution per
// spec/0.3/cascading.md §1.

import { dirname, relative, resolve as pathResolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import {
  findAnatomyForPath,
  validate,
  type AnatomyDoc,
  type Warning,
} from "@anatomy/validate";
import { readAnatomyFile } from "./io.js";
import { classifyStaleness } from "./staleness-significance.js";
import { verifyRulesAtCommit } from "./staleness-per-rule.js";

export interface ResolvedAnatomy {
  anatomy_path: string;
  anatomy_dir: string;
  repo_root: string;
  doc: AnatomyDoc;
  warnings: Warning[];
  staleness: import("./mcp/envelope.js").StalenessInfo | null;
}

export type ResolveError =
  | { error: "anatomy_not_found"; path: string }
  | {
      error: "validation_failed";
      code: string;
      pointer: string;
      message: string;
      warnings: Warning[];
    };

function toPosix(p: string): string {
  return sep === "/" ? p : p.split(sep).join("/");
}

function detectRepoRoot(startDir: string): string {
  const proc = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: startDir,
    encoding: "utf8",
    timeout: 2_000,
    shell: true,
  });
  if (proc.status === 0 && proc.stdout) {
    return pathResolve(proc.stdout.trim());
  }
  return pathResolve(startDir);
}

async function checkStaleness(
  doc: AnatomyDoc,
  repoRoot: string,
): Promise<import("./mcp/envelope.js").StalenessInfo | null> {
  const fileCommit = doc.generated?.commit;
  if (!fileCommit) return null;
  const proc = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 2_000,
    shell: true,
  });
  if (proc.status !== 0 || !proc.stdout) return null;
  const headCommit = proc.stdout.trim();
  if (fileCommit.startsWith(headCommit) || headCommit.startsWith(fileCommit)) {
    return null;
  }
  const significance = classifyStaleness(repoRoot, fileCommit, headCommit);
  const rules = significance === "cosmetic"
    ? []
    : await verifyRulesAtCommit(repoRoot, doc as unknown as { rules?: unknown[] }, headCommit);
  return { file_commit: fileCommit, head_commit: headCommit, significance, rules };
}

export async function resolveAnatomy(
  cwd: string,
  opts?: { repoRoot?: string },
): Promise<ResolvedAnatomy | ResolveError> {
  const startDir = pathResolve(cwd);
  const repoRoot = opts?.repoRoot
    ? pathResolve(opts.repoRoot)
    : detectRepoRoot(startDir);

  let anatomyPath: string | null;
  try {
    anatomyPath = findAnatomyForPath(repoRoot, startDir);
  } catch {
    return { error: "anatomy_not_found", path: startDir };
  }
  if (!anatomyPath) {
    return { error: "anatomy_not_found", path: startDir };
  }

  let text: string;
  try {
    text = readAnatomyFile(anatomyPath);
  } catch (err) {
    return {
      error: "validation_failed",
      code: "anatomy-read-error",
      pointer: "/",
      message: err instanceof Error ? err.message : String(err),
      warnings: [],
    };
  }
  const anatomyDir = dirname(anatomyPath);
  // anatomyDir is "" when the .anatomy sits at repo root — this is the
  // documented v0.3 API per spec/0.3/cascading.md §6.1.
  const validateResult = await validate(text, {
    repoRoot,
    anatomyDir: toPosix(relative(repoRoot, anatomyDir)),
  });

  if (!validateResult.ok) {
    const first = validateResult.errors[0];
    return {
      error: "validation_failed",
      code: first.code,
      pointer: first.pointer,
      message: first.message,
      warnings: validateResult.warnings,
    };
  }

  const staleness = await checkStaleness(validateResult.value, repoRoot);

  return {
    anatomy_path: anatomyPath,
    anatomy_dir: anatomyDir,
    repo_root: repoRoot,
    doc: validateResult.value,
    warnings: validateResult.warnings,
    staleness,
  };
}
