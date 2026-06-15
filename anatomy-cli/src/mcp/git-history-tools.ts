// src/mcp/git-history-tools.ts
// In-process MCP tool set: git_blame, git_log_search, git_show. Loaded when
// `anatomy mcp` is invoked with --with-git-history. See
// docs/superpowers/specs/2026-06-15-anatomy-mcp-with-git-history-design.md.

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 5000;

/** Resolve the path to the git binary. Checks ANATOMY_GIT_BIN first, then
 *  PATH via `where`/`command -v`. Returns null on failure. Respects
 *  ANATOMY_GIT_DISABLE=1 (forces null — test hook for the no-git case). */
export function resolveGitBin(): string | null {
  const disable = process.env.ANATOMY_GIT_DISABLE;
  if (disable && disable !== "0" && disable.toLowerCase() !== "false") return null;
  const envBin = process.env.ANATOMY_GIT_BIN;
  if (envBin && envBin.length > 0) return existsSync(envBin) ? envBin : null;
  try {
    const cmd = process.platform === "win32" ? "where git" : "command -v git";
    const r = spawnSync(cmd, {
      stdio: ["ignore", "pipe", "ignore"],
      shell: true,
      encoding: "utf8",
    });
    if (r.status !== 0) return null;
    const first = r.stdout.split(/\r?\n/)[0]?.trim();
    return first && existsSync(first) ? first : null;
  } catch {
    return null;
  }
}

/** Returns true iff the given cwd is inside a git work-tree.
 *  No `shell: true` — gitBin is an already-resolved absolute path to the .exe.
 *  Passing it through a shell would mis-split a path containing spaces
 *  (e.g. `C:\Program Files\Git\cmd\git.exe`). The memory note about
 *  shell:true applies to .cmd shim resolution, not to invoking a real .exe. */
export function probeRepo(gitBin: string, cwd: string): boolean {
  const r = spawnSync(gitBin, ["rev-parse", "--is-inside-work-tree"], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    timeout: DEFAULT_TIMEOUT_MS,
  });
  return r.status === 0 && r.stdout.trim() === "true";
}

interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  duration_ms: number;
}

/** Run git with the given args in the given cwd. No `shell: true`: gitBin
 *  is an already-resolved absolute path; passing it through a shell breaks
 *  paths with spaces. See probeRepo for the same reasoning. */
function runGit(gitBin: string, args: string[], cwd: string): GitResult {
  const timeoutMs = Number(process.env.ANATOMY_GIT_TIMEOUT_MS ?? "5000") || 5000;
  const t0 = Date.now();
  const r = spawnSync(gitBin, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024, // 16 MB; git log on big repos can be large
  });
  const duration_ms = Date.now() - t0;
  // spawnSync sets `error` when the child was killed by timeout. On POSIX
  // `signal` is "SIGTERM"; on Windows error.code === "ETIMEDOUT".
  const timedOut = r.error !== undefined
    ? (r.error as NodeJS.ErrnoException).code === "ETIMEDOUT" || r.signal === "SIGTERM"
    : false;
  return {
    code: r.status ?? 1,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    timedOut,
    duration_ms,
  };
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: unknown;
}

export interface ToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

export const gitHistoryToolDefinitions: ToolDefinition[] = [
  {
    name: "git_blame",
    description:
      "Show who last touched each line of a file. Returns one record per line in the requested range. " +
      "Pass `lines: \"10-25\"` to scope; default returns the whole file (up to ANATOMY_GIT_MAX_BLAME_LINES, default 500). " +
      "Set `follow: true` to track moves/renames across the file's history.",
    inputSchema: {
      type: "object",
      required: ["file_path"],
      properties: {
        file_path: {
          type: "string",
          description: "Repo-relative path to the file to blame.",
        },
        lines: {
          type: "string",
          description: "Line range like \"10-25\" or single line \"42\". Optional.",
        },
        follow: {
          type: "boolean",
          description: "Follow file moves/renames across history. Default false.",
        },
      },
    },
  },
  {
    name: "git_log_search",
    description:
      "Find commits by content change (pickaxe), commit message (regex), or path filter. " +
      "Returns commit metadata + filenames touched, capped at ANATOMY_GIT_MAX_LOG_COMMITS (default 100).",
    inputSchema: {
      type: "object",
      required: ["kind"],
      properties: {
        kind: {
          type: "string",
          enum: ["pickaxe", "message", "path"],
          description:
            "Search axis: pickaxe = `git log -S <query>` (commits where the string appears or disappears); " +
            "message = `git log --grep=<query>` (commit message regex); " +
            "path = `git log -- <query>` (commits touching the path/glob).",
        },
        query: {
          type: "string",
          description: "Search string. Required for pickaxe and message; optional for path (then returns all commits in the time window).",
        },
        limit: {
          type: "number",
          description: "Max commits returned. Default 30. Hard ceiling = ANATOMY_GIT_MAX_LOG_COMMITS.",
        },
        since: {
          type: "string",
          description: "ISO date or git-relative (e.g. \"2 weeks ago\").",
        },
        until: {
          type: "string",
          description: "ISO date or git-relative.",
        },
        author: {
          type: "string",
          description: "Filter by author substring (matched against name or email).",
        },
      },
    },
  },
  {
    name: "git_show",
    description:
      "Metadata for one commit. By default returns commit, parents, author, date, full message, and file list with status + numstat. " +
      "Set with_diff: true to include the patch body (truncated at ANATOMY_GIT_MAX_DIFF_BYTES, default 4096).",
    inputSchema: {
      type: "object",
      required: ["commit"],
      properties: {
        commit: {
          type: "string",
          description: "Commit SHA or alias (HEAD, HEAD~3, branch name). Output canonicalizes to full 40-char SHA.",
        },
        with_diff: {
          type: "boolean",
          description: "Include the patch body. Default false.",
        },
      },
    },
  },
];

export const gitHistoryToolHandlers: Record<string, ToolHandler> = {
  git_blame: async (args) => {
    const gitBin = resolveGitBin();
    if (!gitBin) return errorEnvelope("git_unavailable");
    return runBlame(args as unknown as BlameInput, gitBin, process.cwd());
  },
  git_log_search: async (_args) => placeholder("git_log_search"),
  git_show: async (_args) => placeholder("git_show"),
};

async function placeholder(name: string): Promise<ToolResult> {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: "not_implemented", tool: name }) }],
    isError: true,
  };
}

const MAX_BLAME_LINES = Number(process.env.ANATOMY_GIT_MAX_BLAME_LINES ?? "500") || 500;
const MAX_CONTENT_LEN = 500;

interface BlameRecord {
  line: number;
  commit: string;
  author: string;
  author_date: string;
  summary: string;
  content: string;
}

/** Parse "10-25" or "42". Returns null for malformed input or end < start or start < 1. */
function parseLines(spec: string): { start: number; end: number } | null {
  if (!spec) return null;
  const m = spec.match(/^(\d+)(?:-(\d+))?$/);
  if (!m) return null;
  const start = Number(m[1]);
  const end = m[2] !== undefined ? Number(m[2]) : start;
  if (start < 1 || end < start) return null;
  return { start, end };
}

function truncateContent(s: string): string {
  return s.length > MAX_CONTENT_LEN ? s.slice(0, MAX_CONTENT_LEN) + "…" : s;
}

/** Parse `git blame --porcelain` output into structured records.
 *
 *  Porcelain format (https://git-scm.com/docs/git-blame#_the_porcelain_format):
 *  - Group header: "<sha> <orig-line> <final-line> [<num-lines-in-group>]"
 *  - For the first occurrence of a commit: author/author-mail/author-time/...,
 *    committer/..., summary, optional previous, filename
 *  - Then "\t<content>" for the line content
 *  - Subsequent lines of the same commit group: just the short header
 *    (no commit-meta block) followed by "\t<content>" */
function parseBlamePorcelain(input: string): BlameRecord[] {
  const out: BlameRecord[] = [];
  const lines = input.split("\n");
  const commitMeta = new Map<string, { author: string; author_date: string; summary: string }>();
  let curCommit = "";
  let curFinalLine = 0;
  let pendingMeta: { author?: string; author_time?: string; summary?: string } = {};

  for (const line of lines) {
    if (line.startsWith("\t")) {
      // Content line — close out the current record.
      // Materialize any pending meta first (the meta lines precede the content).
      if (curCommit && pendingMeta.author !== undefined && !commitMeta.has(curCommit)) {
        commitMeta.set(curCommit, {
          author: pendingMeta.author ?? "",
          author_date: pendingMeta.author_time
            ? new Date(Number(pendingMeta.author_time) * 1000).toISOString()
            : "",
          summary: pendingMeta.summary ?? "",
        });
        pendingMeta = {};
      }
      const meta = commitMeta.get(curCommit);
      if (curCommit && meta) {
        out.push({
          line: curFinalLine,
          commit: curCommit,
          author: meta.author,
          author_date: meta.author_date,
          summary: meta.summary,
          content: truncateContent(line.slice(1)),
        });
      }
      continue;
    }
    // Group header: "<sha> <orig> <final> [<num>]"
    const headerMatch = line.match(/^([0-9a-f]{4,40})\s+\d+\s+(\d+)(?:\s+\d+)?$/);
    if (headerMatch) {
      curCommit = headerMatch[1];
      curFinalLine = Number(headerMatch[2]);
      continue;
    }
    // Meta lines.
    if (line.startsWith("author ")) pendingMeta.author = line.slice("author ".length);
    else if (line.startsWith("author-time ")) pendingMeta.author_time = line.slice("author-time ".length);
    else if (line.startsWith("summary ")) pendingMeta.summary = line.slice("summary ".length);
    // committer-* and other lines: ignored — we only surface author info.
  }
  return out;
}

interface BlameInput {
  file_path: string;
  lines?: string;
  follow?: boolean;
}

interface BlameResult {
  matches: BlameRecord[];
  file: string;
  truncated: boolean;
  truncation_reason?: "max_lines";
}

function errorEnvelope(error: string, extra: Record<string, unknown> = {}): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ error, ...extra }) }],
    isError: true,
  };
}

function okEnvelope(data: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
    isError: false,
  };
}

async function runBlame(input: BlameInput, gitBin: string, cwd: string): Promise<ToolResult> {
  if (typeof input.file_path !== "string" || input.file_path.length === 0) {
    return errorEnvelope("invalid_input", { field: "file_path", detail: "required" });
  }
  let lineRange: { start: number; end: number } | null = null;
  if (input.lines !== undefined) {
    lineRange = parseLines(input.lines);
    if (!lineRange) {
      return errorEnvelope("invalid_input", {
        field: "lines",
        detail: "expected \"10-25\" or \"42\" with positive integers and end >= start",
      });
    }
  }
  const args = ["blame", "--porcelain"];
  if (input.follow) args.push("--follow");
  if (lineRange) args.push("-L", `${lineRange.start},${lineRange.end}`);
  args.push("--", input.file_path);

  const r = runGit(gitBin, args, cwd);
  if (r.timedOut) return errorEnvelope("git_timeout", { duration_ms: r.duration_ms });
  if (r.code !== 0) {
    const stderr = r.stderr.toLowerCase();
    if (stderr.includes("no such path") || stderr.includes("does not exist") || stderr.includes("cannot stat")) {
      return errorEnvelope("file_not_found", { path: input.file_path });
    }
    return errorEnvelope("git_command_failed", { detail: r.stderr.slice(0, 500) });
  }
  let records = parseBlamePorcelain(r.stdout);
  let truncated = false;
  if (records.length > MAX_BLAME_LINES) {
    records = records.slice(0, MAX_BLAME_LINES);
    truncated = true;
  }
  const result: BlameResult = {
    matches: records,
    file: input.file_path,
    truncated,
  };
  if (truncated) result.truncation_reason = "max_lines";
  return okEnvelope(result);
}

/** Exposed for testing only. Do NOT import from outside this package. */
export const _internal = { runGit, parseLines, parseBlamePorcelain };
