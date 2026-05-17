// src/staleness-significance.ts
// Stage A staleness classification for the MCP envelope. Given the anatomy
// file's generated.commit and current HEAD, classify the divergence as
// either "cosmetic" (every changed file matched the documented allowlist)
// or "unknown" (default — at least one code change, or git failed, or the
// changed-file count exceeded the perf cap).
//
// Allowlist categories (spec/2026-05-14-staleness-significance-design.md §5):
//   §5.1 documentation files by extension      (*.md, *.txt, *.rst, LICENSE)
//   §5.2 documentation directories             (docs/**, doc/**)
//   §5.3 lockfiles                             (package-lock.json, Cargo.lock, ...)
//   §5.4 config dotfiles                       (.gitignore, .prettierrc, ...)
//   §5.5 CI workflows                          (.github/workflows/*, .circleci/*, ...)
//   §5.6 anatomy + renderer outputs            (.anatomy, .cursorrules, .clinerules, ...)
//
// Matching is case-sensitive (matching git's POSIX path convention) and
// works against POSIX-style paths regardless of host platform.

export type StalenessSignificance = "cosmetic" | "unknown";

const DOC_EXTENSIONS = /\.(md|txt|rst)$/;

const LICENSE_BASENAMES = new Set([
  "LICENSE", "LICENSE.txt", "LICENCE", "COPYING", "NOTICE", "AUTHORS",
]);

const LOCKFILE_BASENAMES = new Set([
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
  "Cargo.lock", "go.sum",
  "Gemfile.lock", "poetry.lock", "Pipfile.lock", "composer.lock",
]);

const CONFIG_DOTFILE_BASENAMES = new Set([
  ".gitignore", ".gitattributes", ".editorconfig",
  ".prettierrc", ".prettierrc.json", ".prettierrc.yaml", ".prettierrc.yml",
  ".prettierrc.js", ".prettierignore",
  ".eslintrc", ".eslintrc.json", ".eslintrc.yaml", ".eslintrc.yml",
  ".eslintrc.js", ".eslintrc.cjs", ".eslintignore",
  ".nvmrc", ".node-version", ".python-version", ".ruby-version", ".tool-versions",
]);

// AGENTS.md is intentionally NOT listed here — it's matched by the *.md
// rule in DOC_EXTENSIONS at the top of matchesAllowlist().
const ANATOMY_INTERNAL_BASENAMES = new Set([
  ".anatomy", ".anatomy-memory",
  ".cursorrules", ".clinerules", ".roorules", ".continuerules", ".windsurfrules",
]);

const CI_FIXED_FILES = new Set([
  ".circleci/config.yml", ".gitlab-ci.yml", ".travis.yml",
]);

function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

export function matchesAllowlist(path: string): boolean {
  if (DOC_EXTENSIONS.test(path)) return true;
  if (LICENSE_BASENAMES.has(basename(path))) return true;
  if (path.startsWith("docs/") || path.startsWith("doc/")) return true;
  if (LOCKFILE_BASENAMES.has(basename(path))) return true;
  if (CONFIG_DOTFILE_BASENAMES.has(basename(path))) return true;
  if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(path)) return true;
  if (CI_FIXED_FILES.has(path)) return true;
  if (ANATOMY_INTERNAL_BASENAMES.has(basename(path))) return true;
  if (path.startsWith(".cursor/")) return true;
  return false;
}

import { spawnSync } from "node:child_process";

const CHANGED_FILE_CAP = 100;

// Defense-in-depth: refuse to interpolate non-SHA strings into the git
// arg-list when shell:true is active (per t9ykw3em). The .anatomy schema
// already constrains generated.commit to ^[0-9a-f]{7,12}$, and git
// rev-parse --short HEAD is hex-only, but classifyStaleness is callable
// from anywhere and the guard keeps it safe even if upstream validation
// regresses or someone bypasses it.
const SHA_RE = /^[0-9a-f]{4,40}$/;

/**
 * Classify a staleness divergence by diffing fileCommit..headCommit and
 * checking whether all changed paths are on the documented allowlist.
 *
 *   - All paths allowlisted → "cosmetic" (agent may treat as fresh)
 *   - Any code change, > CHANGED_FILE_CAP paths, or git failure → "unknown"
 *
 * Empty diff (semantically identical trees with different SHAs, e.g. after
 * a rebase or empty commit) → "cosmetic" — the trees are identical, so
 * trivially nothing was invalidated.
 */
export function classifyStaleness(
  repoRoot: string,
  fileCommit: string,
  headCommit: string,
): StalenessSignificance {
  if (!SHA_RE.test(fileCommit) || !SHA_RE.test(headCommit)) return "unknown";
  const proc = spawnSync("git", ["diff", "--name-only", `${fileCommit}..${headCommit}`], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 2_000,
    shell: true,
  });
  if (proc.status !== 0) return "unknown";
  const stdout = typeof proc.stdout === "string" ? proc.stdout : "";
  if (stdout.trim().length === 0) return "cosmetic";

  const paths = stdout.split("\n").filter(line => line.length > 0);
  if (paths.length > CHANGED_FILE_CAP) return "unknown";

  for (const path of paths) {
    if (!matchesAllowlist(path)) return "unknown";
  }
  return "cosmetic";
}
