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
  git_blame: async (_args) => placeholder("git_blame"),
  git_log_search: async (_args) => placeholder("git_log_search"),
  git_show: async (_args) => placeholder("git_show"),
};

async function placeholder(name: string): Promise<ToolResult> {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: "not_implemented", tool: name }) }],
    isError: true,
  };
}

/** Exposed for testing only. Do NOT import from outside this package. */
export const _internal = { runGit };
