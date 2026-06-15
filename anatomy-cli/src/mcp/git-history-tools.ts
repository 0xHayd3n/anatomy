// src/mcp/git-history-tools.ts
// In-process MCP tool set: git_blame, git_log_search, git_show. Loaded when
// `anatomy mcp` is invoked with --with-git-history. See
// docs/superpowers/specs/2026-06-15-anatomy-mcp-with-git-history-design.md.

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 5000;

/** Force English git output so the substring-based stderr classification
 *  (file_not_found / invalid_ref) still works on non-English locales.
 *  LC_ALL trumps LANG and LC_MESSAGES; setting both is defensive. */
const C_LOCALE_ENV: NodeJS.ProcessEnv = { LC_ALL: "C", LANG: "C" };

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
    env: { ...process.env, ...C_LOCALE_ENV },
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
    env: { ...process.env, ...C_LOCALE_ENV },
  });
  const duration_ms = Date.now() - t0;
  // r.status === null is the Node-guaranteed signal that the child was killed
  // before it could exit normally. Covers both POSIX timeout (SIGTERM) and
  // Windows timeout (error.code === "ETIMEDOUT"). External signal-kill would
  // also classify as timeout here — acceptable; both mean "call didn't finish".
  const timedOut = r.status === null;
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
  git_log_search: async (args) => {
    const gitBin = resolveGitBin();
    if (!gitBin) return errorEnvelope("git_unavailable");
    return runLogSearch(args as unknown as LogSearchInput, gitBin, process.cwd());
  },
  git_show: async (args) => {
    const gitBin = resolveGitBin();
    if (!gitBin) return errorEnvelope("git_unavailable");
    return runShow(args as unknown as ShowInput, gitBin, process.cwd());
  },
};

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

const MAX_LINE_NUMBER = 10_000_000;

/** Parse "10-25" or "42". Returns null for malformed input, end < start,
 *  start < 1, or either bound exceeding MAX_LINE_NUMBER. */
function parseLines(spec: string): { start: number; end: number } | null {
  if (!spec) return null;
  const m = spec.match(/^(\d+)(?:-(\d+))?$/);
  if (!m) return null;
  const start = Number(m[1]);
  const end = m[2] !== undefined ? Number(m[2]) : start;
  if (start < 1 || end < start || end > MAX_LINE_NUMBER) return null;
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

const MAX_LOG_COMMITS = Number(process.env.ANATOMY_GIT_MAX_LOG_COMMITS ?? "100") || 100;
const DEFAULT_LOG_LIMIT = 30;
const MAX_FILES_PER_COMMIT = 20;

interface LogCommit {
  commit: string;
  author: string;
  date: string;
  summary: string;
  files: string[];
}

/** Parse `git log -z --format=%H%n%an%n%aI%n%s --name-only` output.
 *  Records are separated by NUL; within each record, the first four lines
 *  are the format fields and the remainder are filenames. */
function parseLogOutput(input: string): LogCommit[] {
  if (!input) return [];
  const records = input.split("\0").filter((r) => r.trim().length > 0);
  const out: LogCommit[] = [];
  for (const rec of records) {
    const lines = rec.split("\n").filter((l) => l.length > 0);
    if (lines.length < 4) continue;
    const [commit, author, date, summary, ...files] = lines;
    out.push({
      commit,
      author,
      date,
      summary,
      files: files.slice(0, MAX_FILES_PER_COMMIT),
    });
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

const MAX_DIFF_BYTES = Number(process.env.ANATOMY_GIT_MAX_DIFF_BYTES ?? "4096") || 4096;

interface ShowFile {
  path: string;
  status: "M" | "A" | "D" | "R" | "C" | "T" | "U" | "X" | "B";
  additions: number;
  deletions: number;
}

interface ShowMetadata {
  commit: string;
  parents: string[];
  author: string;
  date: string;
  message: string;
}

/** Parse NUL-delimited %H\0%P\0%an\0%aI\0%B output from `git show --no-patch`.
 *  Returns null if fewer than 5 NUL fields are present.
 *
 *  Trim strategy: git always appends exactly one trailing newline to its
 *  output stream after the last format field. Trimming `[\r\n]+$` on the
 *  whole input would also strip legitimate trailing blank lines inside the
 *  commit message body. Instead, trim only one trailing newline from the
 *  *message* field — preserving deliberate trailing whitespace in messages
 *  that end with a blank line. */
function parseShowMetadata(input: string): ShowMetadata | null {
  const parts = input.split("\0");
  if (parts.length < 5) return null;
  const [commit, parentsStr, author, date, ...messageParts] = parts;
  const rawMessage = messageParts.join("\0");
  const message = rawMessage.replace(/\r?\n$/, "");
  const parents = parentsStr.trim().length > 0 ? parentsStr.trim().split(/\s+/) : [];
  return { commit, parents, author, date, message };
}

/** Parse combined --name-status + --numstat output. First block is one line
 *  per file with a status code; second block is one line per file with
 *  additions/deletions/path. Joined by path. */
function parseShowFiles(input: string): ShowFile[] {
  const statusByPath = new Map<string, ShowFile["status"]>();
  const statsByPath = new Map<string, { additions: number; deletions: number }>();
  for (const line of input.split("\n")) {
    if (!line) continue;
    const numstatMatch = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
    if (numstatMatch) {
      const [, addS, delS, path] = numstatMatch;
      statsByPath.set(path, {
        additions: addS === "-" ? 0 : Number(addS),
        deletions: delS === "-" ? 0 : Number(delS),
      });
      continue;
    }
    const renameMatch = line.match(/^([RC])(\d+)?\t(.+)\t(.+)$/);
    if (renameMatch) {
      statusByPath.set(renameMatch[4], renameMatch[1] as ShowFile["status"]);
      continue;
    }
    const statusMatch = line.match(/^([MADTUXB])\t(.+)$/);
    if (statusMatch) {
      statusByPath.set(statusMatch[2], statusMatch[1] as ShowFile["status"]);
    }
  }
  const out: ShowFile[] = [];
  for (const [path, status] of statusByPath) {
    const stats = statsByPath.get(path) ?? { additions: 0, deletions: 0 };
    out.push({ path, status, ...stats });
  }
  return out;
}

interface LogSearchInput {
  kind: "pickaxe" | "message" | "path";
  query?: string;
  limit?: number;
  since?: string;
  until?: string;
  author?: string;
}

interface LogSearchResult {
  commits: LogCommit[];
  truncated: boolean;
  truncation_reason?: "max_commits";
}

async function runLogSearch(input: LogSearchInput, gitBin: string, cwd: string): Promise<ToolResult> {
  if (input.kind !== "pickaxe" && input.kind !== "message" && input.kind !== "path") {
    return errorEnvelope("invalid_input", { field: "kind", detail: "expected pickaxe | message | path" });
  }
  // pickaxe + message require a non-empty query; path allows it to be omitted.
  if ((input.kind === "pickaxe" || input.kind === "message")
      && (typeof input.query !== "string" || input.query.length === 0)) {
    return errorEnvelope("invalid_input", { field: "query", detail: `required for kind=${input.kind}` });
  }
  const limit = Math.min(
    Math.max(1, Math.floor(input.limit ?? DEFAULT_LOG_LIMIT)),
    MAX_LOG_COMMITS,
  );
  // Fetch one extra to detect truncation.
  const fetchLimit = limit + 1;
  const args = [
    "log",
    "-z",
    "--format=%H%n%an%n%aI%n%s",
    "--name-only",
    `--max-count=${fetchLimit}`,
  ];
  if (input.kind === "pickaxe") args.push("-S", input.query!);
  else if (input.kind === "message") args.push("--grep", input.query!);
  if (input.since) args.push("--since", input.since);
  if (input.until) args.push("--until", input.until);
  if (input.author) args.push("--author", input.author);
  if (input.kind === "path") {
    args.push("--");
    if (input.query) args.push(input.query);
  }

  const r = runGit(gitBin, args, cwd);
  if (r.timedOut) return errorEnvelope("git_timeout", { duration_ms: r.duration_ms });
  if (r.code !== 0) {
    return errorEnvelope("git_command_failed", { detail: r.stderr.slice(0, 500) });
  }
  const all = parseLogOutput(r.stdout);
  const truncated = all.length > limit;
  const commits = all.slice(0, limit);
  const result: LogSearchResult = { commits, truncated };
  if (truncated) result.truncation_reason = "max_commits";
  return okEnvelope(result);
}

interface ShowInput {
  commit: string;
  with_diff?: boolean;
}

interface ShowResult extends ShowMetadata {
  files: ShowFile[];
  diff?: string;
  truncated?: boolean;
  truncation_reason?: "max_diff_bytes";
}

function truncateDiff(diff: string): { diff: string; truncated: boolean } {
  const buf = Buffer.from(diff, "utf8");
  if (buf.byteLength <= MAX_DIFF_BYTES) return { diff, truncated: false };
  // Slice on a safe byte boundary; trailing partial UTF-8 codepoints become U+FFFD.
  const sliced = buf.subarray(0, MAX_DIFF_BYTES).toString("utf8");
  return { diff: sliced + "\n…[truncated]", truncated: true };
}

async function runShow(input: ShowInput, gitBin: string, cwd: string): Promise<ToolResult> {
  if (typeof input.commit !== "string" || input.commit.length === 0) {
    return errorEnvelope("invalid_input", { field: "commit", detail: "required" });
  }
  // Pass 1: metadata.
  const metaArgs = [
    "show",
    "--no-patch",
    "--format=%H%x00%P%x00%an%x00%aI%x00%B",
    input.commit,
  ];
  const metaRes = runGit(gitBin, metaArgs, cwd);
  if (metaRes.timedOut) return errorEnvelope("git_timeout", { duration_ms: metaRes.duration_ms });
  if (metaRes.code !== 0) {
    const stderr = metaRes.stderr.toLowerCase();
    if (stderr.includes("unknown revision") || stderr.includes("bad revision") || stderr.includes("ambiguous argument")) {
      return errorEnvelope("invalid_ref", { ref: input.commit, detail: metaRes.stderr.slice(0, 500) });
    }
    return errorEnvelope("git_command_failed", { detail: metaRes.stderr.slice(0, 500) });
  }
  const meta = parseShowMetadata(metaRes.stdout);
  if (!meta) {
    return errorEnvelope("git_command_failed", { detail: "show metadata parse failed" });
  }

  // Pass 2: file list. `git show` accepts only one of --name-status / --numstat
  // at a time — passing both keeps only the first. Run them separately and
  // feed the concatenated output through parseShowFiles. --format= suppresses
  // the commit header.
  const nameStatusRes = runGit(gitBin, ["show", "--name-status", "--format=", input.commit], cwd);
  if (nameStatusRes.timedOut) return errorEnvelope("git_timeout", { duration_ms: nameStatusRes.duration_ms });
  if (nameStatusRes.code !== 0) {
    return errorEnvelope("git_command_failed", { detail: nameStatusRes.stderr.slice(0, 500) });
  }
  const numstatRes = runGit(gitBin, ["show", "--numstat", "--format=", input.commit], cwd);
  if (numstatRes.timedOut) return errorEnvelope("git_timeout", { duration_ms: numstatRes.duration_ms });
  if (numstatRes.code !== 0) {
    return errorEnvelope("git_command_failed", { detail: numstatRes.stderr.slice(0, 500) });
  }
  const files = parseShowFiles(nameStatusRes.stdout + "\n" + numstatRes.stdout);

  const result: ShowResult = { ...meta, files };

  // Pass 3: optional diff.
  if (input.with_diff) {
    const diffRes = runGit(gitBin, ["show", "--format=", "--patch", input.commit], cwd);
    if (diffRes.timedOut) return errorEnvelope("git_timeout", { duration_ms: diffRes.duration_ms });
    if (diffRes.code !== 0) {
      return errorEnvelope("git_command_failed", { detail: diffRes.stderr.slice(0, 500) });
    }
    const { diff, truncated } = truncateDiff(diffRes.stdout);
    result.diff = diff;
    if (truncated) {
      result.truncated = true;
      result.truncation_reason = "max_diff_bytes";
    }
  }
  return okEnvelope(result);
}

/** Exposed for testing only. Do NOT import from outside this package. */
export const _internal = { runGit, parseLines, parseBlamePorcelain, parseLogOutput, parseShowMetadata, parseShowFiles };
