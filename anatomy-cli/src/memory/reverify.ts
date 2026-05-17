// src/memory/reverify.ts
// Pure logic for anatomy_memory_reverify: resolves a memory entry's last
// endorsement to a git commit, then reports per-ref status (unchanged /
// changed / new_since_endorsement / deleted / not_in_repo) with diff or
// content payload for the changed cases.

import { spawnSync } from "node:child_process";
import type { MemoryEntry } from "./io.js";

const DIFF_LINE_CAP = 400;
const CONTENT_BYTE_CAP = 10_240;

export type RefStatus =
  | { path: string; status: "unchanged" }
  | { path: string; status: "changed"; diff: string }
  | { path: string; status: "changed"; content: string; truncated: true }
  | { path: string; status: "new_since_endorsement"; content: string; truncated?: boolean }
  | { path: string; status: "deleted" }
  | { path: string; status: "not_in_repo" };

export interface ReverifyResult {
  entry: MemoryEntry;
  endorsement: {
    last_endorsed_at: string;
    base_commit: string | null;
  };
  ref_status: RefStatus[];
}

function git(repoRoot: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const proc = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 5_000,
    shell: true,
  });
  return {
    status: proc.status ?? 1,
    stdout: typeof proc.stdout === "string" ? proc.stdout : "",
    stderr: typeof proc.stderr === "string" ? proc.stderr : "",
  };
}

// shell:true (Windows .cmd shim convention from memory t9ykw3em) means args
// are concatenated with spaces by cmd.exe / sh — Node does NOT quote them.
// Ref paths from memory entries can contain spaces and shell metachars, so
// wrap each path-derived arg in double quotes. Double quotes work in both
// cmd.exe and POSIX shells; escape internal " as "" for cmd.exe and as \" for
// POSIX (the latter is also tolerated by cmd.exe in this position).
function shellQuote(s: string): string {
  return `"${s.replace(/"/g, '\\"')}"`;
}

export function resolveEndorsementBase(repoRoot: string, isoTimestamp: string): string | null {
  const r = git(repoRoot, ["log", "-1", `--before=${isoTimestamp}`, "--format=%h"]);
  const sha = r.stdout.trim();
  return sha.length > 0 ? sha : null;
}

function existsAt(repoRoot: string, ref: string, path: string): boolean {
  return git(repoRoot, ["cat-file", "-e", shellQuote(`${ref}:${path}`)]).status === 0;
}

function lastEndorsedAt(entry: MemoryEntry): string {
  if (typeof entry.last_verified_at === "string" && entry.last_verified_at > entry.at) {
    return entry.last_verified_at;
  }
  return entry.at;
}

function stripDiffHeader(diff: string): string {
  // Drop leading "diff --git", "index", "new file mode", "deleted file mode",
  // "--- a/", "+++ b/" lines — keep from the first @@ hunk marker.
  const lines = diff.split("\n");
  const idx = lines.findIndex(l => l.startsWith("@@"));
  return idx === -1 ? diff : lines.slice(idx).join("\n");
}

function fetchContentAtHead(repoRoot: string, path: string): { content: string; truncated: boolean } {
  const out = git(repoRoot, ["show", shellQuote(`HEAD:${path}`)]).stdout;
  if (out.length > CONTENT_BYTE_CAP) {
    return {
      content: out.slice(0, CONTENT_BYTE_CAP) + `\n…[truncated at ${CONTENT_BYTE_CAP} bytes]\n`,
      truncated: true,
    };
  }
  return { content: out, truncated: false };
}

function computeRefStatus(repoRoot: string, baseCommit: string | null, path: string): RefStatus {
  const existsAtHead = existsAt(repoRoot, "HEAD", path);

  if (!existsAtHead) {
    if (baseCommit === null) return { path, status: "not_in_repo" };
    if (!existsAt(repoRoot, baseCommit, path)) return { path, status: "not_in_repo" };
    return { path, status: "deleted" };
  }

  if (baseCommit === null || !existsAt(repoRoot, baseCommit, path)) {
    const c = fetchContentAtHead(repoRoot, path);
    return c.truncated
      ? { path, status: "new_since_endorsement", content: c.content, truncated: true }
      : { path, status: "new_since_endorsement", content: c.content };
  }

  const rawDiff = git(repoRoot, ["diff", "--unified=3", `${baseCommit}..HEAD`, "--", shellQuote(path)]).stdout;
  if (rawDiff.trim().length === 0) return { path, status: "unchanged" };

  const stripped = stripDiffHeader(rawDiff);
  const lineCount = stripped.split("\n").length;
  if (lineCount > DIFF_LINE_CAP) {
    const c = fetchContentAtHead(repoRoot, path);
    return { path, status: "changed", content: c.content, truncated: true };
  }
  return { path, status: "changed", diff: stripped };
}

export function reverifyEntry(repoRoot: string, entry: MemoryEntry): ReverifyResult {
  const lastEndorsed = lastEndorsedAt(entry);
  const baseCommit = resolveEndorsementBase(repoRoot, lastEndorsed);
  const refs = entry.refs ?? [];
  const ref_status = refs.map(p => computeRefStatus(repoRoot, baseCommit, p));
  return {
    entry,
    endorsement: { last_endorsed_at: lastEndorsed, base_commit: baseCommit },
    ref_status,
  };
}

export { DIFF_LINE_CAP, CONTENT_BYTE_CAP };
