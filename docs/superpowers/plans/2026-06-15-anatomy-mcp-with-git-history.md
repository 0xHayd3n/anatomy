# `anatomy mcp --with-git-history` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in `--with-git-history` flag to `anatomy mcp` that exposes three read-only git query tools — `git_blame`, `git_log_search`, `git_show` — via per-call `spawnSync` shellouts to the local `git` binary. Sibling to `--with-fff` and `--with-ast-grep`; architecturally simpler than either (one-shot calls, no long-running subprocess, no in-process lib).

**Architecture:** A fourth tool-handler module (`anatomy-cli/src/mcp/git-history-tools.ts`) sitting next to the existing `section-tools.ts`, `memory-tools.ts`, `ast-grep-tools.ts`. Loaded only when `--with-git-history` is set. Git binary resolution + repo probe inline in the same module (no shared loader needed; this is the sole consumer). Three handlers per tool, plus parser helpers exposed via `_internal` for unit testing without spawning git.

**Tech Stack:** Node 22+, TypeScript, vitest, `git` (assumed installed; resolved via `where`/`command -v` or `ANATOMY_GIT_BIN`).

**Reference:** [`docs/superpowers/specs/2026-06-15-anatomy-mcp-with-git-history-design.md`](../specs/2026-06-15-anatomy-mcp-with-git-history-design.md).

---

## File Structure

**New files:**

| Path | Responsibility |
|---|---|
| `anatomy-cli/src/mcp/git-history-tools.ts` | All three tools + binary resolution + repo probe + parsers. Exports `gitHistoryToolDefinitions`, `gitHistoryToolHandlers`, `resolveGitBin`, `probeRepo`, `_internal` (for tests). |
| `anatomy-cli/tests/git-history-tools.test.ts` | Unit tests for parsers, language-level helpers; real-git tests against tmp-repo fixtures. Coverage table in Task 7. |

**Modified files:**

| Path | Change |
|---|---|
| `anatomy-cli/src/commands/mcp.ts` | `McpCommandOptions` gets `withGitHistory?: boolean`. New `if (opts.withGitHistory)` block parallel to the existing `withAstGrep` block: resolve git binary, probe cwd is a repo, hard-fail if either fails, merge tool defs + handlers, collision check. Dispatch loop adds a telemetry wrapper for `git_*` tools. |
| `anatomy-cli/src/bin.ts` | Add `--with-git-history` to the argv parser. Thread through `case "mcp"`. Update HELP block. |
| `anatomy-cli/src/telemetry.ts` | Add `git_history_call` variant to the `TelemetryRecord` union. |
| `anatomy-cli/tests/mcp-integration.test.ts` | New tests: `--with-git-history` hard-fail when `ANATOMY_GIT_DISABLE=1`; tools/list merges (12 tools); `git_blame` round-trip via stdio; composition with `--with-ast-grep` (13 tools). |
| `anatomy-cli/README.md` | Document the flag in the MCP section. |
| `README.md` | Quick-start line + "Pairing with git history" section. |
| `anatomy-cli/package.json` | Version bump `1.2.0` → `1.3.0`; description update. |
| `anatomy-cli/package-lock.json` | Regenerated for the version bump. |
| `anatomy-cli/CHANGELOG.md` | New `## [1.3.0]` entry above the existing `## [1.2.0]`. |

**Not touched** (deliberately): `section-tools.ts`, `memory-tools.ts`, `brief-tool.ts`, `fff-bridge.ts`, `ast-grep-tools.ts`, `ast-grep-loader.ts`, every Pass 1 / Pass 2 / render / validate path.

---

## Verification before each commit

Every task that touches code ends with both:

```bash
npm --prefix anatomy-cli run test
npm --prefix anatomy-cli run build
```

`test` catches behavioural regressions; `build` catches TypeScript errors the test runner can mask.

---

## Task 1: Add `git_history_call` telemetry variant

**Files:**
- Modify: `anatomy-cli/src/telemetry.ts`
- Create: `anatomy-cli/tests/git-history-tools.test.ts`

- [ ] **Step 1: Create the test file with a telemetry-type smoke test**

Create `anatomy-cli/tests/git-history-tools.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { recordTelemetry } from "../src/telemetry.js";

describe("git_history_call telemetry shape", () => {
  it("accepts a git_history_call record", () => {
    expect(() =>
      recordTelemetry({
        kind: "git_history_call",
        ts: new Date().toISOString(),
        tool: "git_blame",
        duration_ms: 47,
        truncated: false,
        outcome: "ok",
      })
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Extend the TelemetryRecord union**

In `anatomy-cli/src/telemetry.ts`, append a new union member after the existing `ast_grep_call` member (which is currently the last one). The closing `;` should be moved off the previous member's closing `}` onto the new one's.

```ts
  | {
      kind: "git_history_call";
      ts: string;
      tool: "git_blame" | "git_log_search" | "git_show";
      duration_ms: number;
      truncated: boolean;
      outcome: "ok" | "file_not_found" | "invalid_ref" | "invalid_input" | "git_command_failed" | "git_timeout" | "not_a_git_repository" | "error";
    };
```

- [ ] **Step 3: Build and run the new test**

Run:
```bash
npm --prefix anatomy-cli run build
npm --prefix anatomy-cli run test -- git-history-tools
```

Expected: both succeed.

- [ ] **Step 4: Commit**

```bash
git add anatomy-cli/src/telemetry.ts anatomy-cli/tests/git-history-tools.test.ts
git commit -m "feat(telemetry): add git_history_call record variant"
```

---

## Task 2: Scaffold `git-history-tools.ts` with three tool definitions

**Files:**
- Create: `anatomy-cli/src/mcp/git-history-tools.ts`
- Modify: `anatomy-cli/tests/git-history-tools.test.ts`

- [ ] **Step 1: Add a failing test for the tool definition shape**

Append to `anatomy-cli/tests/git-history-tools.test.ts`:

```ts
import { gitHistoryToolDefinitions, gitHistoryToolHandlers } from "../src/mcp/git-history-tools.js";

describe("git-history-tools scaffold", () => {
  it("exports three tool definitions: git_blame, git_log_search, git_show", () => {
    expect(gitHistoryToolDefinitions).toHaveLength(3);
    const names = gitHistoryToolDefinitions.map((d) => d.name).sort();
    expect(names).toEqual(["git_blame", "git_log_search", "git_show"]);
    for (const def of gitHistoryToolDefinitions) {
      expect(typeof def.description).toBe("string");
      expect(def.inputSchema).toBeDefined();
    }
  });

  it("git_blame requires file_path", () => {
    const def = gitHistoryToolDefinitions.find((d) => d.name === "git_blame")!;
    const schema = def.inputSchema as { required?: string[]; properties: Record<string, unknown> };
    expect(schema.required).toEqual(["file_path"]);
    expect(Object.keys(schema.properties).sort()).toEqual(["file_path", "follow", "lines"]);
  });

  it("git_log_search requires kind", () => {
    const def = gitHistoryToolDefinitions.find((d) => d.name === "git_log_search")!;
    const schema = def.inputSchema as { required?: string[]; properties: Record<string, unknown> };
    expect(schema.required).toEqual(["kind"]);
    expect(Object.keys(schema.properties).sort()).toEqual(
      ["author", "kind", "limit", "query", "since", "until"],
    );
  });

  it("git_show requires commit", () => {
    const def = gitHistoryToolDefinitions.find((d) => d.name === "git_show")!;
    const schema = def.inputSchema as { required?: string[]; properties: Record<string, unknown> };
    expect(schema.required).toEqual(["commit"]);
    expect(Object.keys(schema.properties).sort()).toEqual(["commit", "with_diff"]);
  });

  it("exports handlers under matching names", () => {
    expect(gitHistoryToolHandlers).toHaveProperty("git_blame");
    expect(gitHistoryToolHandlers).toHaveProperty("git_log_search");
    expect(gitHistoryToolHandlers).toHaveProperty("git_show");
    expect(typeof gitHistoryToolHandlers.git_blame).toBe("function");
    expect(typeof gitHistoryToolHandlers.git_log_search).toBe("function");
    expect(typeof gitHistoryToolHandlers.git_show).toBe("function");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
npm --prefix anatomy-cli run test -- git-history-tools
```

Expected: FAIL with `Cannot find module '../src/mcp/git-history-tools.js'`.

- [ ] **Step 3: Create the scaffold module**

Create `anatomy-cli/src/mcp/git-history-tools.ts`:

```ts
// src/mcp/git-history-tools.ts
// In-process MCP tool set: git_blame, git_log_search, git_show. Loaded when
// `anatomy mcp` is invoked with --with-git-history. See
// docs/superpowers/specs/2026-06-15-anatomy-mcp-with-git-history-design.md.

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
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
npm --prefix anatomy-cli run test -- git-history-tools
npm --prefix anatomy-cli run build
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add anatomy-cli/src/mcp/git-history-tools.ts anatomy-cli/tests/git-history-tools.test.ts
git commit -m "feat(mcp): scaffold git_blame/git_log_search/git_show tool definitions"
```

---

## Task 3: Git binary resolution + repo probe + `runGit` helper

**Files:**
- Modify: `anatomy-cli/src/mcp/git-history-tools.ts`
- Modify: `anatomy-cli/tests/git-history-tools.test.ts`

- [ ] **Step 1: Add failing tests for the helpers**

Append to `anatomy-cli/tests/git-history-tools.test.ts`:

```ts
import { _internal, resolveGitBin, probeRepo } from "../src/mcp/git-history-tools.js";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

describe("resolveGitBin", () => {
  it("returns a path when git is on PATH", () => {
    const bin = resolveGitBin();
    // We're running on CI / dev machines with git installed.
    expect(bin).toBeTruthy();
    expect(existsSync(bin!)).toBe(true);
  });

  it("honors ANATOMY_GIT_BIN if it points at an existing file", () => {
    const bin = resolveGitBin();
    expect(bin).toBeTruthy();
    const oldEnv = process.env.ANATOMY_GIT_BIN;
    try {
      process.env.ANATOMY_GIT_BIN = bin!;
      expect(resolveGitBin()).toBe(bin);
    } finally {
      if (oldEnv === undefined) delete process.env.ANATOMY_GIT_BIN;
      else process.env.ANATOMY_GIT_BIN = oldEnv;
    }
  });

  it("returns null if ANATOMY_GIT_BIN points at a missing file", () => {
    const oldEnv = process.env.ANATOMY_GIT_BIN;
    try {
      process.env.ANATOMY_GIT_BIN = "C:/definitely/not/git.exe";
      expect(resolveGitBin()).toBeNull();
    } finally {
      if (oldEnv === undefined) delete process.env.ANATOMY_GIT_BIN;
      else process.env.ANATOMY_GIT_BIN = oldEnv;
    }
  });

  it("returns null when ANATOMY_GIT_DISABLE is truthy", () => {
    const oldEnv = process.env.ANATOMY_GIT_DISABLE;
    try {
      process.env.ANATOMY_GIT_DISABLE = "1";
      expect(resolveGitBin()).toBeNull();
    } finally {
      if (oldEnv === undefined) delete process.env.ANATOMY_GIT_DISABLE;
      else process.env.ANATOMY_GIT_DISABLE = oldEnv;
    }
  });
});

describe("probeRepo", () => {
  it("returns true inside a git work-tree", () => {
    const bin = resolveGitBin()!;
    const dir = mkdtempSync(join(tmpdir(), "githist-probe-"));
    execSync("git init", { cwd: dir, stdio: "ignore", shell: true });
    expect(probeRepo(bin, dir)).toBe(true);
  });

  it("returns false outside a git work-tree", () => {
    const bin = resolveGitBin()!;
    const dir = mkdtempSync(join(tmpdir(), "githist-noprobe-"));
    expect(probeRepo(bin, dir)).toBe(false);
  });
});

describe("runGit", () => {
  it("returns stdout + exit 0 for a successful command", () => {
    const bin = resolveGitBin()!;
    const dir = mkdtempSync(join(tmpdir(), "githist-run-"));
    execSync("git init", { cwd: dir, stdio: "ignore", shell: true });
    const r = _internal.runGit(bin, ["rev-parse", "--is-inside-work-tree"], dir);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe("true");
    expect(r.timedOut).toBe(false);
  });

  it("captures stderr + non-zero exit for a failing command", () => {
    const bin = resolveGitBin()!;
    const dir = mkdtempSync(join(tmpdir(), "githist-fail-"));
    const r = _internal.runGit(bin, ["rev-parse", "--is-inside-work-tree"], dir);
    expect(r.code).not.toBe(0);
    expect(r.stderr.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
npm --prefix anatomy-cli run test -- git-history-tools
```

Expected: FAIL with `resolveGitBin is not a function` (and similar for `probeRepo`, `_internal`).

- [ ] **Step 3: Implement the helpers**

Add to the **top** of `anatomy-cli/src/mcp/git-history-tools.ts` (after the file header comment, before the `ToolDefinition` interface):

```ts
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

/** Returns true iff the given cwd is inside a git work-tree. */
export function probeRepo(gitBin: string, cwd: string): boolean {
  const r = spawnSync(gitBin, ["rev-parse", "--is-inside-work-tree"], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
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

/** Run git with the given args in the given cwd. shell: true on every call
 *  per Windows .cmd-shim memory (t9ykw3em). */
function runGit(gitBin: string, args: string[], cwd: string): GitResult {
  const timeoutMs = Number(process.env.ANATOMY_GIT_TIMEOUT_MS ?? "5000") || 5000;
  const t0 = Date.now();
  const r = spawnSync(gitBin, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024, // 16 MB; git log on big repos can be large
  });
  const duration_ms = Date.now() - t0;
  // spawnSync sets `error` when the child was killed by timeout. `signal` is
  // set to "SIGTERM" in that case on POSIX. On Windows we get error.code === "ETIMEDOUT".
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
```

And at the **bottom** of the file (after the handlers), add:

```ts
/** Exposed for testing only. Do NOT import from outside this package. */
export const _internal = { runGit };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
npm --prefix anatomy-cli run test -- git-history-tools
npm --prefix anatomy-cli run build
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add anatomy-cli/src/mcp/git-history-tools.ts anatomy-cli/tests/git-history-tools.test.ts
git commit -m "feat(mcp): git binary resolution + repo probe + runGit helper"
```

---

## Task 4: `git_blame` — parser + handler + e2e tests

**Files:**
- Modify: `anatomy-cli/src/mcp/git-history-tools.ts`
- Modify: `anatomy-cli/tests/git-history-tools.test.ts`

- [ ] **Step 1: Add failing unit tests for the porcelain parser + lines parser**

Append to `anatomy-cli/tests/git-history-tools.test.ts`:

```ts
describe("parseLines", () => {
  it("accepts a single line number", () => {
    expect(_internal.parseLines("42")).toEqual({ start: 42, end: 42 });
  });

  it("accepts a range", () => {
    expect(_internal.parseLines("10-25")).toEqual({ start: 10, end: 25 });
  });

  it("rejects malformed input", () => {
    expect(_internal.parseLines("abc")).toBeNull();
    expect(_internal.parseLines("10-")).toBeNull();
    expect(_internal.parseLines("-10")).toBeNull();
    expect(_internal.parseLines("10-5")).toBeNull(); // end < start
    expect(_internal.parseLines("0")).toBeNull();    // start must be >= 1
    expect(_internal.parseLines("")).toBeNull();
  });
});

describe("parseBlamePorcelain", () => {
  it("parses a single-commit single-line blame", () => {
    const input = [
      "abc1234 1 1 1",
      "author Alice",
      "author-mail <alice@example.com>",
      "author-time 1640000000",
      "author-tz +0000",
      "committer Bob",
      "committer-mail <bob@example.com>",
      "committer-time 1640000000",
      "committer-tz +0000",
      "summary initial commit",
      "filename a.ts",
      "\tconst x = 1;",
    ].join("\n");
    const out = _internal.parseBlamePorcelain(input);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      line: 1,
      commit: "abc1234",
      author: "Alice",
      author_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      summary: "initial commit",
      content: "const x = 1;",
    });
  });

  it("parses multiple lines from the same commit (subsequent lines omit headers)", () => {
    const input = [
      "abc1234 1 1 2",
      "author Alice",
      "author-mail <alice@example.com>",
      "author-time 1640000000",
      "author-tz +0000",
      "committer Alice",
      "committer-mail <alice@example.com>",
      "committer-time 1640000000",
      "committer-tz +0000",
      "summary first",
      "filename a.ts",
      "\tline one",
      "abc1234 2 2",
      "\tline two",
    ].join("\n");
    const out = _internal.parseBlamePorcelain(input);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ line: 1, content: "line one", author: "Alice" });
    expect(out[1]).toMatchObject({ line: 2, content: "line two", author: "Alice", summary: "first" });
  });

  it("handles lines whose content starts with a backslash-t (no double-escaping)", () => {
    const input = [
      "abc1234 1 1 1",
      "author Alice",
      "author-mail <alice@example.com>",
      "author-time 1640000000",
      "author-tz +0000",
      "committer Alice",
      "committer-mail <alice@example.com>",
      "committer-time 1640000000",
      "committer-tz +0000",
      "summary x",
      "filename a.ts",
      "\t\\tab",
    ].join("\n");
    const out = _internal.parseBlamePorcelain(input);
    expect(out[0].content).toBe("\\tab");
  });
});
```

- [ ] **Step 2: Verify the unit tests fail**

Run:
```bash
npm --prefix anatomy-cli run test -- git-history-tools
```

Expected: FAIL with `_internal.parseLines is not a function` / `_internal.parseBlamePorcelain is not a function`.

- [ ] **Step 3: Implement the parsers**

Insert into `anatomy-cli/src/mcp/git-history-tools.ts` **after** the `runGit` function (still above the existing exports). Add:

```ts
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
      // If we have pending meta from the prior block, materialize it.
      if (curCommit && pendingMeta.author !== undefined) {
        commitMeta.set(curCommit, {
          author: pendingMeta.author ?? "",
          author_date: pendingMeta.author_time
            ? new Date(Number(pendingMeta.author_time) * 1000).toISOString()
            : "",
          summary: pendingMeta.summary ?? "",
        });
        pendingMeta = {};
      }
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
  // Materialize trailing meta (in case the input had headers without content — defensive).
  if (curCommit && pendingMeta.author !== undefined && !commitMeta.has(curCommit)) {
    commitMeta.set(curCommit, {
      author: pendingMeta.author ?? "",
      author_date: pendingMeta.author_time
        ? new Date(Number(pendingMeta.author_time) * 1000).toISOString()
        : "",
      summary: pendingMeta.summary ?? "",
    });
  }
  return out;
}
```

Update the `_internal` export at the bottom of the file:

```ts
/** Exposed for testing only. Do NOT import from outside this package. */
export const _internal = { runGit, parseLines, parseBlamePorcelain };
```

- [ ] **Step 4: Verify the parser tests pass**

Run:
```bash
npm --prefix anatomy-cli run test -- git-history-tools
npm --prefix anatomy-cli run build
```

Expected: all green.

- [ ] **Step 5: Add a failing e2e test against a real git fixture**

Append to `anatomy-cli/tests/git-history-tools.test.ts`:

```ts
import { gitHistoryToolHandlers as gitHandlers } from "../src/mcp/git-history-tools.js";

function setupBlameRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "githist-blame-"));
  execSync("git init", { cwd: dir, stdio: "ignore", shell: true });
  execSync('git config user.email "test@example.com"', { cwd: dir, stdio: "ignore", shell: true });
  execSync('git config user.name "Test User"', { cwd: dir, stdio: "ignore", shell: true });
  writeFileSync(join(dir, "a.ts"), "const x = 1;\nconst y = 2;\nconst z = 3;\n");
  execSync("git add a.ts", { cwd: dir, stdio: "ignore", shell: true });
  execSync('git commit -m "initial commit"', { cwd: dir, stdio: "ignore", shell: true });
  return dir;
}

describe("git_blame — end-to-end", () => {
  it("returns one record per line of the file by default", async () => {
    const dir = setupBlameRepo();
    const oldCwd = process.cwd();
    try {
      process.chdir(dir);
      const r = await gitHandlers.git_blame({ file_path: "a.ts" });
      const data = JSON.parse(r.content[0].text);
      expect(r.isError).toBeFalsy();
      expect(data.matches).toHaveLength(3);
      expect(data.matches[0]).toMatchObject({
        line: 1,
        author: "Test User",
        summary: "initial commit",
        content: "const x = 1;",
      });
      expect(data.matches[0].commit).toMatch(/^[0-9a-f]{40}$/);
      expect(data.file).toBe("a.ts");
      expect(data.truncated).toBe(false);
    } finally {
      process.chdir(oldCwd);
    }
  });

  it("scopes to a line range when `lines` is provided", async () => {
    const dir = setupBlameRepo();
    const oldCwd = process.cwd();
    try {
      process.chdir(dir);
      const r = await gitHandlers.git_blame({ file_path: "a.ts", lines: "2-3" });
      const data = JSON.parse(r.content[0].text);
      expect(data.matches).toHaveLength(2);
      expect(data.matches[0].line).toBe(2);
      expect(data.matches[1].line).toBe(3);
    } finally {
      process.chdir(oldCwd);
    }
  });

  it("returns file_not_found for a missing file", async () => {
    const dir = setupBlameRepo();
    const oldCwd = process.cwd();
    try {
      process.chdir(dir);
      const r = await gitHandlers.git_blame({ file_path: "nope.ts" });
      const data = JSON.parse(r.content[0].text);
      expect(r.isError).toBe(true);
      expect(data.error).toBe("file_not_found");
    } finally {
      process.chdir(oldCwd);
    }
  });

  it("returns invalid_input for malformed lines", async () => {
    const dir = setupBlameRepo();
    const oldCwd = process.cwd();
    try {
      process.chdir(dir);
      const r = await gitHandlers.git_blame({ file_path: "a.ts", lines: "abc" });
      const data = JSON.parse(r.content[0].text);
      expect(r.isError).toBe(true);
      expect(data.error).toBe("invalid_input");
      expect(data.field).toBe("lines");
    } finally {
      process.chdir(oldCwd);
    }
  });
});
```

- [ ] **Step 6: Verify the e2e tests fail (handlers still return not_implemented)**

Run:
```bash
npm --prefix anatomy-cli run test -- git-history-tools
```

Expected: FAIL — e2e tests get `error: not_implemented`.

- [ ] **Step 7: Implement the `git_blame` handler**

Add (still in `anatomy-cli/src/mcp/git-history-tools.ts`, after `parseBlamePorcelain`):

```ts
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
    if (stderr.includes("no such path") || stderr.includes("does not exist")) {
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
```

Replace the placeholder `git_blame` handler in `gitHistoryToolHandlers`:

```ts
export const gitHistoryToolHandlers: Record<string, ToolHandler> = {
  git_blame: async (args) => {
    const gitBin = resolveGitBin();
    if (!gitBin) return errorEnvelope("git_unavailable");
    return runBlame(args as unknown as BlameInput, gitBin, process.cwd());
  },
  git_log_search: async (_args) => placeholder("git_log_search"),
  git_show: async (_args) => placeholder("git_show"),
};
```

- [ ] **Step 8: Verify all tests pass**

Run:
```bash
npm --prefix anatomy-cli run test -- git-history-tools
npm --prefix anatomy-cli run build
```

Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add anatomy-cli/src/mcp/git-history-tools.ts anatomy-cli/tests/git-history-tools.test.ts
git commit -m "feat(mcp): git_blame handler with porcelain parser + line scoping"
```

---

## Task 5: `git_log_search` — parser + handler + e2e tests

**Files:**
- Modify: `anatomy-cli/src/mcp/git-history-tools.ts`
- Modify: `anatomy-cli/tests/git-history-tools.test.ts`

- [ ] **Step 1: Add failing unit tests for the log parser**

Append to `anatomy-cli/tests/git-history-tools.test.ts`:

```ts
describe("parseLogOutput", () => {
  it("parses a single commit with one file", () => {
    // git log -z --format=%H%n%an%n%aI%n%s --name-only output:
    //   <sha>\n<author>\n<date>\n<summary>\n<file>\n\0
    const input = "abc1234567890abcdef1234567890abcdef123456\nAlice\n2026-01-01T12:00:00Z\nfirst\nfile1.ts\n\0";
    const out = _internal.parseLogOutput(input);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      commit: "abc1234567890abcdef1234567890abcdef123456",
      author: "Alice",
      date: "2026-01-01T12:00:00Z",
      summary: "first",
      files: ["file1.ts"],
    });
  });

  it("parses multiple commits with multiple files each", () => {
    const input =
      "aaa1\nAlice\n2026-01-02T12:00:00Z\nsecond\nfile1.ts\nfile2.ts\n\0" +
      "bbb2\nBob\n2026-01-01T12:00:00Z\nfirst\nfile1.ts\n\0";
    const out = _internal.parseLogOutput(input);
    expect(out).toHaveLength(2);
    expect(out[0].files).toEqual(["file1.ts", "file2.ts"]);
    expect(out[1].author).toBe("Bob");
  });

  it("caps the per-commit file list", () => {
    const files = Array.from({ length: 30 }, (_, i) => `f${i}.ts`).join("\n");
    const input = `aaa1\nAlice\n2026-01-01T12:00:00Z\nfirst\n${files}\n\0`;
    const out = _internal.parseLogOutput(input);
    expect(out[0].files.length).toBeLessThanOrEqual(20);
  });

  it("handles empty input (no matches)", () => {
    expect(_internal.parseLogOutput("")).toEqual([]);
  });
});
```

- [ ] **Step 2: Verify the unit tests fail**

Run:
```bash
npm --prefix anatomy-cli run test -- git-history-tools
```

Expected: FAIL with `_internal.parseLogOutput is not a function`.

- [ ] **Step 3: Implement the log parser**

Insert into `anatomy-cli/src/mcp/git-history-tools.ts` after the blame implementation:

```ts
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
```

Update the `_internal` export:

```ts
export const _internal = { runGit, parseLines, parseBlamePorcelain, parseLogOutput };
```

- [ ] **Step 4: Verify parser tests pass**

Run:
```bash
npm --prefix anatomy-cli run test -- git-history-tools
```

Expected: green.

- [ ] **Step 5: Add a failing e2e test for `git_log_search`**

Append to `anatomy-cli/tests/git-history-tools.test.ts`:

```ts
function setupLogRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "githist-log-"));
  execSync("git init", { cwd: dir, stdio: "ignore", shell: true });
  execSync('git config user.email "test@example.com"', { cwd: dir, stdio: "ignore", shell: true });
  execSync('git config user.name "Test User"', { cwd: dir, stdio: "ignore", shell: true });
  writeFileSync(join(dir, "a.ts"), "const x = 1;\n");
  execSync("git add a.ts", { cwd: dir, stdio: "ignore", shell: true });
  execSync('git commit -m "add a.ts"', { cwd: dir, stdio: "ignore", shell: true });
  writeFileSync(join(dir, "a.ts"), "const x = 1;\nconst y = 2;\n");
  execSync("git add a.ts", { cwd: dir, stdio: "ignore", shell: true });
  execSync('git commit -m "feat: add y to a.ts"', { cwd: dir, stdio: "ignore", shell: true });
  writeFileSync(join(dir, "b.ts"), "const z = 3;\n");
  execSync("git add b.ts", { cwd: dir, stdio: "ignore", shell: true });
  execSync('git commit -m "fix: introduce b.ts"', { cwd: dir, stdio: "ignore", shell: true });
  return dir;
}

describe("git_log_search — end-to-end", () => {
  it("kind=message: finds commits whose message matches the query", async () => {
    const dir = setupLogRepo();
    const oldCwd = process.cwd();
    try {
      process.chdir(dir);
      const r = await gitHandlers.git_log_search({ kind: "message", query: "feat:" });
      const data = JSON.parse(r.content[0].text);
      expect(r.isError).toBeFalsy();
      expect(data.commits).toHaveLength(1);
      expect(data.commits[0].summary).toContain("add y to a.ts");
      expect(data.commits[0].commit).toMatch(/^[0-9a-f]{40}$/);
    } finally {
      process.chdir(oldCwd);
    }
  });

  it("kind=path: finds commits touching a path", async () => {
    const dir = setupLogRepo();
    const oldCwd = process.cwd();
    try {
      process.chdir(dir);
      const r = await gitHandlers.git_log_search({ kind: "path", query: "a.ts" });
      const data = JSON.parse(r.content[0].text);
      expect(data.commits.length).toBeGreaterThanOrEqual(2);
      // Newest first.
      expect(data.commits[0].summary).toContain("add y to a.ts");
    } finally {
      process.chdir(oldCwd);
    }
  });

  it("kind=pickaxe: finds commits where the string appears or disappears", async () => {
    const dir = setupLogRepo();
    const oldCwd = process.cwd();
    try {
      process.chdir(dir);
      const r = await gitHandlers.git_log_search({ kind: "pickaxe", query: "const y" });
      const data = JSON.parse(r.content[0].text);
      expect(data.commits).toHaveLength(1);
      expect(data.commits[0].summary).toContain("add y to a.ts");
    } finally {
      process.chdir(oldCwd);
    }
  });

  it("respects the limit and sets truncated when capped", async () => {
    const dir = setupLogRepo();
    const oldCwd = process.cwd();
    try {
      process.chdir(dir);
      const r = await gitHandlers.git_log_search({ kind: "message", query: ".", limit: 1 });
      const data = JSON.parse(r.content[0].text);
      expect(data.commits).toHaveLength(1);
      expect(data.truncated).toBe(true);
      expect(data.truncation_reason).toBe("max_commits");
    } finally {
      process.chdir(oldCwd);
    }
  });

  it("rejects missing query for pickaxe", async () => {
    const dir = setupLogRepo();
    const oldCwd = process.cwd();
    try {
      process.chdir(dir);
      const r = await gitHandlers.git_log_search({ kind: "pickaxe" });
      const data = JSON.parse(r.content[0].text);
      expect(r.isError).toBe(true);
      expect(data.error).toBe("invalid_input");
      expect(data.field).toBe("query");
    } finally {
      process.chdir(oldCwd);
    }
  });
});
```

- [ ] **Step 6: Verify the e2e tests fail**

Run:
```bash
npm --prefix anatomy-cli run test -- git-history-tools
```

Expected: FAIL — handler still returns `not_implemented`.

- [ ] **Step 7: Implement the `git_log_search` handler**

Add to `anatomy-cli/src/mcp/git-history-tools.ts` (after the log parser):

```ts
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
```

Replace the placeholder `git_log_search` handler:

```ts
  git_log_search: async (args) => {
    const gitBin = resolveGitBin();
    if (!gitBin) return errorEnvelope("git_unavailable");
    return runLogSearch(args as unknown as LogSearchInput, gitBin, process.cwd());
  },
```

- [ ] **Step 8: Verify all tests pass**

Run:
```bash
npm --prefix anatomy-cli run test -- git-history-tools
npm --prefix anatomy-cli run build
```

Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add anatomy-cli/src/mcp/git-history-tools.ts anatomy-cli/tests/git-history-tools.test.ts
git commit -m "feat(mcp): git_log_search handler with pickaxe/message/path discriminator"
```

---

## Task 6: `git_show` — parser + handler + e2e tests

**Files:**
- Modify: `anatomy-cli/src/mcp/git-history-tools.ts`
- Modify: `anatomy-cli/tests/git-history-tools.test.ts`

- [ ] **Step 1: Add failing unit tests for the show parsers**

Append to `anatomy-cli/tests/git-history-tools.test.ts`:

```ts
describe("parseShowMetadata", () => {
  it("parses NUL-delimited metadata into structured fields", () => {
    const input = [
      "abc1234567890abcdef1234567890abcdef123456",
      "parent111111111111111111111111111111111111",
      "Alice",
      "2026-01-01T12:00:00Z",
      "feat: add x\n\nlonger body line 1\nlonger body line 2",
    ].join("\0");
    const out = _internal.parseShowMetadata(input);
    expect(out).toMatchObject({
      commit: "abc1234567890abcdef1234567890abcdef123456",
      parents: ["parent111111111111111111111111111111111111"],
      author: "Alice",
      date: "2026-01-01T12:00:00Z",
      message: "feat: add x\n\nlonger body line 1\nlonger body line 2",
    });
  });

  it("parses multiple parents (merge commit)", () => {
    const input = [
      "abc1234567890abcdef1234567890abcdef123456",
      "parent111111111111111111111111111111111111 parent222222222222222222222222222222222222",
      "Alice",
      "2026-01-01T12:00:00Z",
      "Merge branch x",
    ].join("\0");
    const out = _internal.parseShowMetadata(input);
    expect(out.parents).toHaveLength(2);
  });

  it("returns null on malformed input", () => {
    expect(_internal.parseShowMetadata("only-one-field")).toBeNull();
  });
});

describe("parseShowFiles", () => {
  it("combines --name-status and --numstat output", () => {
    // git show --name-status --numstat --format= output:
    //   M\tfile1.ts
    //   A\tfile2.ts
    //   10\t5\tfile1.ts
    //   3\t0\tfile2.ts
    const input = "M\tfile1.ts\nA\tfile2.ts\n10\t5\tfile1.ts\n3\t0\tfile2.ts\n";
    const out = _internal.parseShowFiles(input);
    expect(out).toEqual([
      { path: "file1.ts", status: "M", additions: 10, deletions: 5 },
      { path: "file2.ts", status: "A", additions: 3, deletions: 0 },
    ]);
  });

  it("handles renames (R<percent>\\told\\tnew)", () => {
    const input = "R100\told.ts\tnew.ts\n0\t0\tnew.ts\n";
    const out = _internal.parseShowFiles(input);
    expect(out).toEqual([
      { path: "new.ts", status: "R", additions: 0, deletions: 0 },
    ]);
  });

  it("handles binary files (numstat = -\\t-)", () => {
    const input = "M\tfoo.bin\n-\t-\tfoo.bin\n";
    const out = _internal.parseShowFiles(input);
    expect(out).toEqual([
      { path: "foo.bin", status: "M", additions: 0, deletions: 0 },
    ]);
  });
});
```

- [ ] **Step 2: Verify the unit tests fail**

Run:
```bash
npm --prefix anatomy-cli run test -- git-history-tools
```

Expected: FAIL with `_internal.parseShowMetadata is not a function` / `_internal.parseShowFiles is not a function`.

- [ ] **Step 3: Implement the show parsers**

Add to `anatomy-cli/src/mcp/git-history-tools.ts` (after `runLogSearch`):

```ts
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
 *  Returns null if fewer than 5 NUL fields are present. */
function parseShowMetadata(input: string): ShowMetadata | null {
  // Trim any trailing whitespace/newline that git appends.
  const trimmed = input.replace(/[\r\n]+$/, "");
  const parts = trimmed.split("\0");
  if (parts.length < 5) return null;
  const [commit, parentsStr, author, date, ...messageParts] = parts;
  // Defensive: if more than 5 NULs appear inside the message (extremely unlikely),
  // rejoin everything after the 4th field.
  const message = messageParts.join("\0");
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
    // name-status lines: "<status>\t<path>" or rename/copy "R100\told\tnew".
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
```

Update the `_internal` export:

```ts
export const _internal = { runGit, parseLines, parseBlamePorcelain, parseLogOutput, parseShowMetadata, parseShowFiles };
```

- [ ] **Step 4: Verify the parser tests pass**

Run:
```bash
npm --prefix anatomy-cli run test -- git-history-tools
```

Expected: green.

- [ ] **Step 5: Add a failing e2e test for `git_show`**

Append to `anatomy-cli/tests/git-history-tools.test.ts`:

```ts
describe("git_show — end-to-end", () => {
  it("returns metadata + file list for HEAD", async () => {
    const dir = setupLogRepo();
    const oldCwd = process.cwd();
    try {
      process.chdir(dir);
      const r = await gitHandlers.git_show({ commit: "HEAD" });
      const data = JSON.parse(r.content[0].text);
      expect(r.isError).toBeFalsy();
      expect(data.commit).toMatch(/^[0-9a-f]{40}$/);
      expect(data.author).toBe("Test User");
      expect(data.message).toContain("introduce b.ts");
      expect(data.files).toHaveLength(1);
      expect(data.files[0]).toMatchObject({
        path: "b.ts",
        status: "A",
        additions: 1,
      });
      expect(data.diff).toBeUndefined();
    } finally {
      process.chdir(oldCwd);
    }
  });

  it("includes a truncated patch when with_diff is true", async () => {
    const dir = setupLogRepo();
    const oldCwd = process.cwd();
    try {
      process.chdir(dir);
      const r = await gitHandlers.git_show({ commit: "HEAD", with_diff: true });
      const data = JSON.parse(r.content[0].text);
      expect(r.isError).toBeFalsy();
      expect(typeof data.diff).toBe("string");
      expect(data.diff).toContain("const z = 3");
    } finally {
      process.chdir(oldCwd);
    }
  });

  it("returns invalid_ref for a bogus commit", async () => {
    const dir = setupLogRepo();
    const oldCwd = process.cwd();
    try {
      process.chdir(dir);
      const r = await gitHandlers.git_show({ commit: "nonexistent-sha-xxxxxxxxxxxx" });
      const data = JSON.parse(r.content[0].text);
      expect(r.isError).toBe(true);
      expect(data.error).toBe("invalid_ref");
    } finally {
      process.chdir(oldCwd);
    }
  });

  it("returns invalid_input when commit is empty", async () => {
    const dir = setupLogRepo();
    const oldCwd = process.cwd();
    try {
      process.chdir(dir);
      const r = await gitHandlers.git_show({ commit: "" });
      const data = JSON.parse(r.content[0].text);
      expect(r.isError).toBe(true);
      expect(data.error).toBe("invalid_input");
      expect(data.field).toBe("commit");
    } finally {
      process.chdir(oldCwd);
    }
  });
});
```

- [ ] **Step 6: Verify the e2e tests fail**

Run:
```bash
npm --prefix anatomy-cli run test -- git-history-tools
```

Expected: FAIL — handler still returns `not_implemented`.

- [ ] **Step 7: Implement the `git_show` handler**

Add to `anatomy-cli/src/mcp/git-history-tools.ts` (after the show parsers):

```ts
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
  // Byte-count truncation: serialize to UTF-8, slice, decode best-effort.
  const buf = Buffer.from(diff, "utf8");
  if (buf.byteLength <= MAX_DIFF_BYTES) return { diff, truncated: false };
  // Slice on a safe byte boundary; trailing partial UTF-8 codepoints are
  // replaced by U+FFFD via TextDecoder's fatal=false default.
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

  // Pass 2: file list (--name-status + --numstat). Use --format= to suppress the commit header repeat.
  const filesRes = runGit(gitBin, ["show", "--name-status", "--numstat", "--format=", input.commit], cwd);
  if (filesRes.timedOut) return errorEnvelope("git_timeout", { duration_ms: filesRes.duration_ms });
  if (filesRes.code !== 0) {
    return errorEnvelope("git_command_failed", { detail: filesRes.stderr.slice(0, 500) });
  }
  const files = parseShowFiles(filesRes.stdout);

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
```

Replace the placeholder `git_show` handler:

```ts
  git_show: async (args) => {
    const gitBin = resolveGitBin();
    if (!gitBin) return errorEnvelope("git_unavailable");
    return runShow(args as unknown as ShowInput, gitBin, process.cwd());
  },
```

- [ ] **Step 8: Verify all tests pass**

Run:
```bash
npm --prefix anatomy-cli run test -- git-history-tools
npm --prefix anatomy-cli run build
```

Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add anatomy-cli/src/mcp/git-history-tools.ts anatomy-cli/tests/git-history-tools.test.ts
git commit -m "feat(mcp): git_show handler with metadata + file list + optional diff"
```

---

## Task 7: Error path tests — `git_unavailable`, `git_timeout`

**Files:**
- Modify: `anatomy-cli/tests/git-history-tools.test.ts`

- [ ] **Step 1: Add failing tests for the remaining error paths**

Append to `anatomy-cli/tests/git-history-tools.test.ts`:

```ts
describe("git-history-tools — error paths", () => {
  it("returns git_unavailable when ANATOMY_GIT_DISABLE=1", async () => {
    const oldEnv = process.env.ANATOMY_GIT_DISABLE;
    try {
      process.env.ANATOMY_GIT_DISABLE = "1";
      const r = await gitHandlers.git_blame({ file_path: "a.ts" });
      const data = JSON.parse(r.content[0].text);
      expect(r.isError).toBe(true);
      expect(data.error).toBe("git_unavailable");
    } finally {
      if (oldEnv === undefined) delete process.env.ANATOMY_GIT_DISABLE;
      else process.env.ANATOMY_GIT_DISABLE = oldEnv;
    }
  });

  it("returns invalid_input for git_log_search with unknown kind", async () => {
    const r = await gitHandlers.git_log_search({ kind: "bogus" });
    const data = JSON.parse(r.content[0].text);
    expect(r.isError).toBe(true);
    expect(data.error).toBe("invalid_input");
    expect(data.field).toBe("kind");
  });

  it("file_path missing → invalid_input for git_blame", async () => {
    const r = await gitHandlers.git_blame({});
    const data = JSON.parse(r.content[0].text);
    expect(r.isError).toBe(true);
    expect(data.error).toBe("invalid_input");
    expect(data.field).toBe("file_path");
  });
});
```

- [ ] **Step 2: Run the tests**

Run:
```bash
npm --prefix anatomy-cli run test -- git-history-tools
```

Expected: every test passes (the handlers from Tasks 4-6 already implement these paths).

- [ ] **Step 3: Build**

Run:
```bash
npm --prefix anatomy-cli run build
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add anatomy-cli/tests/git-history-tools.test.ts
git commit -m "test(mcp): cover git-history error paths"
```

---

## Task 8: Wire `--with-git-history` into `mcpCommand`

**Files:**
- Modify: `anatomy-cli/src/commands/mcp.ts`
- Modify: `anatomy-cli/src/bin.ts`
- Modify: `anatomy-cli/tests/mcp-integration.test.ts`

- [ ] **Step 1: Add a failing integration test for the hard-fail path**

Append to `anatomy-cli/tests/mcp-integration.test.ts`:

```ts
describe("anatomy mcp --with-git-history", () => {
  it("hard-fails with actionable error when git is unavailable", () => {
    const repoDir = mkdtempSync(join(tmpdir(), "anat-mcp-git-"));
    execSync("git init", { cwd: repoDir, stdio: "ignore", shell: true });
    writeFileSync(join(repoDir, ".anatomy"), ANATOMY);

    let stderr = "";
    let exitCode = 0;
    try {
      execSync(`node "${BIN}" mcp --with-git-history`, {
        cwd: repoDir,
        env: {
          ...process.env,
          ANATOMY_GIT_DISABLE: "1",
          ANATOMY_TELEMETRY_DISABLE: "1",
        },
        stdio: ["pipe", "pipe", "pipe"],
        shell: true,
      });
    } catch (e) {
      const err = e as { status?: number; stderr?: Buffer };
      exitCode = err.status ?? 0;
      stderr = err.stderr?.toString() ?? "";
    }
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/git not found/i);
  });

  it("hard-fails with actionable error when cwd is not a git repo", () => {
    const repoDir = mkdtempSync(join(tmpdir(), "anat-mcp-nogit-"));
    // No `git init` here — deliberately not a repo.
    writeFileSync(join(repoDir, ".anatomy"), ANATOMY);

    let stderr = "";
    let exitCode = 0;
    try {
      execSync(`node "${BIN}" mcp --with-git-history`, {
        cwd: repoDir,
        env: {
          ...process.env,
          ANATOMY_TELEMETRY_DISABLE: "1",
        },
        stdio: ["pipe", "pipe", "pipe"],
        shell: true,
      });
    } catch (e) {
      const err = e as { status?: number; stderr?: Buffer };
      exitCode = err.status ?? 0;
      stderr = err.stderr?.toString() ?? "";
    }
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/not in a git repository/i);
  });
});
```

- [ ] **Step 2: Verify the tests fail**

Run:
```bash
npm --prefix anatomy-cli run build
npm --prefix anatomy-cli run test -- mcp-integration
```

Expected: FAIL because `--with-git-history` is an unknown flag (parser exits 1 with `unknown flag` rather than `git not found`).

- [ ] **Step 3: Wire the flag in `bin.ts`**

In `anatomy-cli/src/bin.ts`, add a new parseArgs case next to the existing `--with-ast-grep` line:

```ts
    if (a === "--with-git-history") { flags.withGitHistory = true; i++; continue; }
```

Update the `case "mcp":` dispatch:

```ts
    case "mcp":
      return mcpCommand({
        withFff: !!flags.withFff,
        withAstGrep: !!flags.withAstGrep,
        withGitHistory: !!flags.withGitHistory,
      });
```

Update the HELP block — find the `mcp [--with-fff] [--with-ast-grep]` line and replace it with:

```
  mcp [--with-fff] [--with-ast-grep] [--with-git-history]
                                            Start an MCP stdio server exposing anatomy's tools.
                                            --with-fff: also proxy fff's tools (ffgrep, fffind) via
                                            a child fff-mcp subprocess. Hard-fails if no fff
                                            binary is on PATH. ANATOMY_FFF_BIN overrides the binary
                                            path (point at fff-mcp; binary takes no args by default);
                                            ANATOMY_FFF_ARGS sets argv for the rare binary that needs
                                            a subcommand (default: none);
                                            ANATOMY_FFF_TIMEOUT_MS overrides the per-call timeout
                                            (default 5000).
                                            --with-ast-grep: also expose ast_grep_search for
                                            structural code search via @ast-grep/napi (in-process).
                                            Hard-fails if the optional dep failed to install.
                                            ANATOMY_AST_GREP_MAX_FILES (default 5000) caps the
                                            file walk per call.
                                            --with-git-history: also expose git_blame, git_log_search,
                                            git_show — read-only git queries via spawnSync to the
                                            local git binary. Hard-fails if git is not on PATH or
                                            cwd is not in a git work-tree. ANATOMY_GIT_BIN overrides
                                            the binary; ANATOMY_GIT_MAX_BLAME_LINES (500) /
                                            _MAX_LOG_COMMITS (100) / _MAX_DIFF_BYTES (4096) /
                                            _TIMEOUT_MS (5000) cap per-call output.
```

- [ ] **Step 4: Wire the flag in `mcp.ts`**

In `anatomy-cli/src/commands/mcp.ts`, update the `McpCommandOptions` interface:

```ts
export interface McpCommandOptions {
  withFff?: boolean;
  withAstGrep?: boolean;
  withGitHistory?: boolean;
}
```

After the existing `if (opts.withAstGrep)` block, add the parallel `if (opts.withGitHistory)` block:

```ts
  if (opts.withGitHistory) {
    const { resolveGitBin, probeRepo } = await import("../mcp/git-history-tools.js");
    const gitBin = resolveGitBin();
    if (!gitBin) {
      process.stderr.write(
        "error: git not found on PATH; install git or omit --with-git-history\n",
      );
      return 1;
    }
    if (!probeRepo(gitBin, process.cwd())) {
      process.stderr.write(
        "error: not in a git repository; cd into a git repo or omit --with-git-history\n",
      );
      return 1;
    }
    if (!recordTelemetry) {
      ({ recordTelemetry } = await import("../telemetry.js"));
    }
    const { gitHistoryToolDefinitions, gitHistoryToolHandlers } = await import("../mcp/git-history-tools.js");
    // Collision check against the names already in the dispatch map.
    for (const def of gitHistoryToolDefinitions) {
      if (def.name in anatomyHandlers) {
        process.stderr.write(`error: git-history tool name collision: ${def.name}\n`);
        return 1;
      }
      if (fffDefs.some((d) => d.name === def.name)) {
        process.stderr.write(`error: git-history tool name collision with fff bridge: ${def.name}\n`);
        return 1;
      }
    }
    anatomyDefs.push(...gitHistoryToolDefinitions);
    Object.assign(anatomyHandlers, gitHistoryToolHandlers);
  }
```

Then extend the existing telemetry wrapper to also handle `git_*` tools. Find the block in `mcp.ts` that begins with `if (opts.withAstGrep && name === "ast_grep_search" && recordTelemetry)` and immediately after it add a parallel branch for git tools. The complete `if (handler)` block should look like:

```ts
    if (handler) {
      // ast-grep handlers get a telemetry wrapper; built-in section/memory
      // handlers already self-instrument inside section-tools.ts.
      if (opts.withAstGrep && name === "ast_grep_search" && recordTelemetry) {
        const t0 = Date.now();
        const result = await handler(args ?? {}) as { content: Array<{ text: string }>; isError?: boolean };
        const text = result.content[0]?.text ?? "{}";
        let parsed: { matches?: unknown[]; truncated?: boolean; language?: string; error?: string; files_scanned?: unknown };
        try { parsed = JSON.parse(text); } catch { parsed = {}; }
        const outcome: "ok" | "missing_pattern" | "missing_lang_or_file_path" | "pattern_parse_failed" | "error" =
          !result.isError ? "ok"
          : parsed.error === "missing_pattern" ? "missing_pattern"
          : parsed.error === "missing_lang_or_file_path" ? "missing_lang_or_file_path"
          : parsed.error === "pattern_parse_failed" ? "pattern_parse_failed"
          : "error";
        const filesScanned = typeof parsed.files_scanned === "number" ? parsed.files_scanned : 0;
        recordTelemetry({
          kind: "ast_grep_call",
          ts: new Date().toISOString(),
          tool: "ast_grep_search",
          lang: typeof parsed.language === "string" ? parsed.language : "",
          files_scanned: filesScanned,
          matches: Array.isArray(parsed.matches) ? parsed.matches.length : 0,
          truncated: !!parsed.truncated,
          duration_ms: Date.now() - t0,
          outcome,
        });
        return result;
      }
      if (opts.withGitHistory && (name === "git_blame" || name === "git_log_search" || name === "git_show") && recordTelemetry) {
        const t0 = Date.now();
        const result = await handler(args ?? {}) as { content: Array<{ text: string }>; isError?: boolean };
        const text = result.content[0]?.text ?? "{}";
        let parsed: { truncated?: boolean; error?: string };
        try { parsed = JSON.parse(text); } catch { parsed = {}; }
        const outcome: "ok" | "file_not_found" | "invalid_ref" | "invalid_input" | "git_command_failed" | "git_timeout" | "not_a_git_repository" | "error" =
          !result.isError ? "ok"
          : parsed.error === "file_not_found" ? "file_not_found"
          : parsed.error === "invalid_ref" ? "invalid_ref"
          : parsed.error === "invalid_input" ? "invalid_input"
          : parsed.error === "git_command_failed" ? "git_command_failed"
          : parsed.error === "git_timeout" ? "git_timeout"
          : parsed.error === "not_a_git_repository" ? "not_a_git_repository"
          : "error";
        recordTelemetry({
          kind: "git_history_call",
          ts: new Date().toISOString(),
          tool: name as "git_blame" | "git_log_search" | "git_show",
          duration_ms: Date.now() - t0,
          truncated: !!parsed.truncated,
          outcome,
        });
        return result;
      }
      const result = await handler(args ?? {});
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        isError: typeof result === "object" && result !== null && "error" in result,
      };
    }
```

Like the ast-grep wrapper, the git_* handlers already return MCP-shaped `{ content, isError }` envelopes — return them directly without re-stringifying.

- [ ] **Step 5: Run the integration tests**

Run:
```bash
npm --prefix anatomy-cli run build
npm --prefix anatomy-cli run test -- mcp-integration
```

Expected: every existing test passes plus the two new ones (`hard-fails when git is unavailable` and `hard-fails when cwd is not a git repo`).

- [ ] **Step 6: Run the full anatomy-cli suite**

Run:
```bash
npm --prefix anatomy-cli run test
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add anatomy-cli/src/commands/mcp.ts anatomy-cli/src/bin.ts anatomy-cli/tests/mcp-integration.test.ts
git commit -m "feat(mcp): --with-git-history flag exposes git_blame/log/show"
```

---

## Task 9: End-to-end stdio round-trip + composition test

**Files:**
- Modify: `anatomy-cli/tests/mcp-integration.test.ts`

- [ ] **Step 1: Add the failing round-trip + composition tests**

Append to the `describe("anatomy mcp --with-git-history", ...)` block in `anatomy-cli/tests/mcp-integration.test.ts`:

```ts
  it("merges three git tools into the tools list when enabled", { timeout: 30_000 }, async () => {
    const repoDir = mkdtempSync(join(tmpdir(), "anat-mcp-git-on-"));
    execSync("git init", { cwd: repoDir, stdio: "ignore", shell: true });
    writeFileSync(join(repoDir, ".anatomy"), ANATOMY);

    const [respWith] = await spawnGitHistory(repoDir, [
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
    ]);
    const tools = (respWith as { result: { tools: Array<{ name: string }> } }).result.tools.map(
      (t) => t.name,
    );
    expect(tools).toContain("git_blame");
    expect(tools).toContain("git_log_search");
    expect(tools).toContain("git_show");
    expect(tools).toHaveLength(12); // 9 anatomy + 3 git
  });

  it("git_blame round-trips through MCP and returns matches", { timeout: 30_000 }, async () => {
    const repoDir = mkdtempSync(join(tmpdir(), "anat-mcp-git-blame-rt-"));
    execSync("git init", { cwd: repoDir, stdio: "ignore", shell: true });
    execSync('git config user.email "test@example.com"', { cwd: repoDir, stdio: "ignore", shell: true });
    execSync('git config user.name "Test User"', { cwd: repoDir, stdio: "ignore", shell: true });
    writeFileSync(join(repoDir, ".anatomy"), ANATOMY);
    writeFileSync(join(repoDir, "a.ts"), "const x = 1;\nconst y = 2;\n");
    execSync("git add a.ts", { cwd: repoDir, stdio: "ignore", shell: true });
    execSync('git commit -m "add a.ts"', { cwd: repoDir, stdio: "ignore", shell: true });

    const [resp] = await spawnGitHistory(repoDir, [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "git_blame", arguments: { file_path: "a.ts" } },
      },
    ]);
    const text = (resp as { result: { content: Array<{ text: string }> } }).result.content[0].text;
    const data = JSON.parse(text);
    expect(data.matches).toHaveLength(2);
    expect(data.matches[0].author).toBe("Test User");
    expect(data.matches[0].commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it("composes with --with-ast-grep (13 tools total)", { timeout: 30_000 }, async () => {
    const repoDir = mkdtempSync(join(tmpdir(), "anat-mcp-git-ast-"));
    execSync("git init", { cwd: repoDir, stdio: "ignore", shell: true });
    writeFileSync(join(repoDir, ".anatomy"), ANATOMY);

    const [resp] = await spawnCombo(repoDir, [
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
    ]);
    const tools = (resp as { result: { tools: Array<{ name: string }> } }).result.tools.map((t) => t.name);
    expect(tools).toContain("ast_grep_search");
    expect(tools).toContain("git_blame");
    expect(tools).toContain("git_log_search");
    expect(tools).toContain("git_show");
    expect(tools).toHaveLength(13); // 9 anatomy + 1 ast-grep + 3 git
  });
});

async function spawnGitHistory(repoDir: string, requests: JsonRpcRequest[]): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", [BIN, "mcp", "--with-git-history"], {
      cwd: repoDir,
      stdio: ["pipe", "pipe", "pipe"],
      shell: true,
      env: { ...process.env, ANATOMY_TELEMETRY_DISABLE: "1" },
    });
    let buffer = "";
    const responses: unknown[] = [];
    proc.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) { try { responses.push(JSON.parse(line)); } catch {} }
        if (responses.length === requests.length) proc.stdin.end();
      }
    });
    proc.on("close", () => resolve(responses));
    proc.on("error", reject);
    setTimeout(() => { proc.kill(); reject(new Error("timeout")); }, 10_000);
    for (const req of requests) proc.stdin.write(JSON.stringify(req) + "\n");
  });
}

async function spawnCombo(repoDir: string, requests: JsonRpcRequest[]): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", [BIN, "mcp", "--with-ast-grep", "--with-git-history"], {
      cwd: repoDir,
      stdio: ["pipe", "pipe", "pipe"],
      shell: true,
      env: { ...process.env, ANATOMY_TELEMETRY_DISABLE: "1" },
    });
    let buffer = "";
    const responses: unknown[] = [];
    proc.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) { try { responses.push(JSON.parse(line)); } catch {} }
        if (responses.length === requests.length) proc.stdin.end();
      }
    });
    proc.on("close", () => resolve(responses));
    proc.on("error", reject);
    setTimeout(() => { proc.kill(); reject(new Error("timeout")); }, 10_000);
    for (const req of requests) proc.stdin.write(JSON.stringify(req) + "\n");
  });
}
```

- [ ] **Step 2: Run the integration tests**

Run:
```bash
npm --prefix anatomy-cli run build
npm --prefix anatomy-cli run test -- mcp-integration
```

Expected: every test passes including the three new ones.

- [ ] **Step 3: Commit**

```bash
git add anatomy-cli/tests/mcp-integration.test.ts
git commit -m "test(mcp): stdio round-trip + composition tests for --with-git-history"
```

---

## Task 10: Document `--with-git-history` in `anatomy-cli/README.md`

**Files:**
- Modify: `anatomy-cli/README.md`

- [ ] **Step 1: Locate the `--with-ast-grep` section**

Run:
```bash
grep -n "anatomy mcp --with-ast-grep" anatomy-cli/README.md | head -3
```

Identify the closing line of that section (look for the blank line followed by the next top-level bullet or `### Telemetry`).

- [ ] **Step 2: Append a sibling `--with-git-history` subsection immediately after the `--with-ast-grep` block**

Place the following at the natural insertion point (right after the closing line of the `--with-ast-grep` section, before `### Telemetry`):

```markdown
- **`anatomy mcp --with-git-history`** — opt-in flag that exposes three
  read-only git query tools — `git_blame`, `git_log_search`, `git_show` —
  inside anatomy's MCP namespace. Pure shellout to the local `git` binary
  via `spawnSync`; no subprocess lifecycle, no in-process lib.

  - **Tool surface.**
    - `git_blame` — who last touched each line. Pass `lines: "10-25"` to scope.
    - `git_log_search` — find commits by content change (pickaxe), commit
      message (regex), or path filter. `kind` discriminator picks the axis.
    - `git_show` — metadata + file list for one commit; optional truncated
      patch via `with_diff: true`.
  - **Hard fail on missing git or non-repo cwd.** `--with-git-history`
    exits 1 with an actionable error if git isn't on PATH or the cwd
    isn't inside a git work-tree.
  - **Strictly read-only.** No commit, checkout, reset, push — the tool
    surface makes it structurally impossible.
  - **Bounded output.** Every tool has a hard cap; truncation sets
    `truncated: true` + `truncation_reason`.

  | Env | Purpose | Default |
  |---|---|---|
  | `ANATOMY_GIT_BIN` | Override the path to the git binary. | (resolve via `PATH`) |
  | `ANATOMY_GIT_MAX_BLAME_LINES` | Cap on `git_blame` output. | `500` |
  | `ANATOMY_GIT_MAX_LOG_COMMITS` | Cap on `git_log_search` results. | `100` |
  | `ANATOMY_GIT_MAX_DIFF_BYTES` | Cap on `git_show` patch body. | `4096` |
  | `ANATOMY_GIT_TIMEOUT_MS` | Per-call timeout for git. | `5000` |

  Composes with `--with-fff` and `--with-ast-grep`. Without the flag, no
  git probe runs and behaviour is byte-identical to v1.2.0.
```

- [ ] **Step 3: Commit**

```bash
git add anatomy-cli/README.md
git commit -m "docs(cli): document anatomy mcp --with-git-history"
```

---

## Task 11: Document `--with-git-history` in the root `README.md`

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add the line to the Quick start block**

In `README.md`, find the block:

```bash
anatomy mcp --with-ast-grep   # additionally expose ast_grep_search (structural code search)
```

and add a sibling line directly after:

```bash
anatomy mcp --with-git-history   # additionally expose git_blame / git_log_search / git_show
```

- [ ] **Step 2: Append the new section**

After the closing line of the existing "Pairing with ast-grep for structural code search" section (right before the `**Pass 2 model is configurable.**` paragraph), insert this new section:

```markdown
### Pairing with git history for the time axis

`anatomy mcp --with-git-history` adds three read-only git query tools —
`git_blame`, `git_log_search`, `git_show` — to anatomy's MCP namespace.
Pure shellout to the local `git` binary via `spawnSync`; no subprocess
lifecycle, no in-process library, no install footprint beyond git itself.

```bash
anatomy mcp --with-git-history
# composes with --with-fff and --with-ast-grep:
anatomy mcp --with-fff --with-ast-grep --with-git-history
```

| Env | Purpose | Default |
|---|---|---|
| `ANATOMY_GIT_BIN` | Override the path to the git binary. | resolve via `PATH` |
| `ANATOMY_GIT_MAX_BLAME_LINES` | Cap on `git_blame` output. | `500` |
| `ANATOMY_GIT_MAX_LOG_COMMITS` | Cap on `git_log_search` results. | `100` |
| `ANATOMY_GIT_MAX_DIFF_BYTES` | Cap on `git_show` patch body. | `4096` |
| `ANATOMY_GIT_TIMEOUT_MS` | Per-call timeout. | `5000` |

The fourth axis: anatomy tells the agent *what should I know?*, fff
tells it *where is X textually?*, ast-grep tells it *where is X
structurally?*, and git-history tells it *when did X change and why?*.
Combined, the agent can answer cross-cutting queries — *"who introduced
this pattern, in which commit, and what did the surrounding code look
like then?"* — from one MCP endpoint.

**Strictly read-only.** No commit, checkout, reset, push, pull, fetch,
branch -d, or any other mutating git operation. The tool surface accepts
narrowly-typed inputs (file path, commit ref, query string) — there is
no opaque `command` parameter and never will be.

**Failure semantics.** Hard-fails at startup if git isn't on PATH or the
cwd isn't inside a git work-tree. No degraded mode — unlike fff with
mid-session crash recovery, git is invoked fresh per call. Per-call
timeouts (`ANATOMY_GIT_TIMEOUT_MS`, default 5000) cap long-running ops.
Telemetry events (`git_history_call`) land in
`~/.anatomy/telemetry.jsonl` alongside the existing streams.

```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document anatomy mcp --with-git-history in root README"
```

---

## Task 12: Bump CLI version + CHANGELOG

**Files:**
- Modify: `anatomy-cli/package.json`
- Modify: `anatomy-cli/package-lock.json`
- Modify: `anatomy-cli/CHANGELOG.md`

- [ ] **Step 1: Bump the version in `package.json`**

Edit `anatomy-cli/package.json`:

```json
"version": "1.3.0",
```

(was `1.2.0`). Also update the `description` field — find the current description and replace `9 tools across section + memory access; --with-fff opt-in flag proxies fff-mcp's tools, --with-ast-grep opt-in flag exposes structural code search via @ast-grep/napi in-process` with `9 tools across section + memory access; --with-fff opt-in flag proxies fff-mcp's tools, --with-ast-grep opt-in flag exposes structural code search via @ast-grep/napi in-process, --with-git-history opt-in flag exposes read-only git_blame/git_log_search/git_show via spawnSync`.

- [ ] **Step 2: Regenerate the lockfile**

Run:
```bash
npm --prefix anatomy-cli install --package-lock-only --no-audit --no-fund
```

Expected: lockfile updated to `1.3.0`.

- [ ] **Step 3: Add the 1.3.0 entry to the CHANGELOG**

Edit `anatomy-cli/CHANGELOG.md`. Insert the following block ABOVE the existing `## [1.2.0]` entry:

```markdown
## [1.3.0] — 2026-06-15

### Added

- **`anatomy mcp --with-git-history`: in-process git query extension.**
  Third optional MCP extension on `anatomy mcp`, sibling to `--with-fff`
  and `--with-ast-grep` but architecturally simpler than both: pure
  per-call `spawnSync` shellouts to the local `git` binary, no
  long-running subprocess, no in-process library binding. The agent can
  now answer the time-axis verb (*"when did X change and why?"*) that
  the prior extensions structurally cannot.
  - **Tool surface.** Three read-only tools:
    - `git_blame { file_path, lines?, follow? }` — per-line
      `{ commit, author, author_date, summary, content }`, capped at 500
      lines (configurable).
    - `git_log_search { kind: "pickaxe" | "message" | "path", query?, limit?, since?, until?, author? }`
      — commits matching the chosen axis, with metadata + file list,
      default limit 30, hard ceiling 100.
    - `git_show { commit, with_diff? }` — full commit metadata + file
      list with status/numstat; optional truncated patch.
  - **Strictly read-only.** No mutating operations (commit, checkout,
    reset, push, pull, fetch, branch -d). Tool inputs are narrowly typed
    — there is no `command` parameter.
  - **Composes with prior extensions.**
    `anatomy mcp --with-fff --with-ast-grep --with-git-history` exposes
    the full union (16 tools: 9 anatomy + 3 fff + 1 ast-grep + 3 git).
  - **Hard fail at startup** if `git` is not on PATH or cwd is not
    inside a git work-tree. No degraded mode (unlike `--with-fff`).
  - **Bounded output everywhere.** Every tool has a hard cap with
    `truncated: true` + `truncation_reason` semantics.
  - **Telemetry.** New `git_history_call` variant on the existing
    `~/.anatomy/telemetry.jsonl` stream. No lifecycle events.
  - **Configuration.** `ANATOMY_GIT_BIN`, `ANATOMY_GIT_MAX_BLAME_LINES`
    (500), `ANATOMY_GIT_MAX_LOG_COMMITS` (100),
    `ANATOMY_GIT_MAX_DIFF_BYTES` (4096), `ANATOMY_GIT_TIMEOUT_MS` (5000).
    `ANATOMY_GIT_DISABLE` forces the loader to act as if git is missing
    (test hook).

### Notes

- No new runtime dependencies. The tool shells out to whatever `git` is
  already installed (resolved via PATH or `ANATOMY_GIT_BIN`). Install
  footprint unchanged from v1.2.0.
- Without `--with-git-history`, `anatomy mcp` behaviour is byte-identical
  to v1.2.0 — no git probe runs, no new modules import.

## [1.2.0] — 2026-06-15
```

- [ ] **Step 4: Build and test**

Run:
```bash
npm --prefix anatomy-cli run build
npm --prefix anatomy-cli run test
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add anatomy-cli/package.json anatomy-cli/package-lock.json anatomy-cli/CHANGELOG.md
git commit -m "chore(release): @anatomytool/cli 1.3.0"
```

---

## Task 13: Final regression + sanity check

**Files:** None changed (verification only).

- [ ] **Step 1: Run the full anatomy-cli test suite**

Run:
```bash
npm --prefix anatomy-cli run test
npm --prefix anatomy-cli run build
```

Expected: every test green, build clean.

- [ ] **Step 2: Run the repo-root validate gate**

Run:
```bash
npm run validate
```

Expected: PASS.

- [ ] **Step 3: Sanity check — `anatomy mcp` with no flag still has 9 tools**

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node anatomy-cli/dist/bin.js mcp 2>/dev/null | head -1 | node -e "let c=''; process.stdin.on('data',d=>c+=d).on('end',()=>{const j=JSON.parse(c); console.log('tool_count=', j.result.tools.length)})"
```

Expected: `tool_count= 9`.

- [ ] **Step 4: Sanity check — `anatomy mcp --with-git-history` exposes 12 tools**

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node anatomy-cli/dist/bin.js mcp --with-git-history 2>/dev/null | head -1 | node -e "let c=''; process.stdin.on('data',d=>c+=d).on('end',()=>{const j=JSON.parse(c); console.log('tool_count=', j.result.tools.length); console.log('names=', j.result.tools.map(t=>t.name).join(','))})"
```

Expected: `tool_count= 12`, `names=` includes `git_blame`, `git_log_search`, `git_show`.

- [ ] **Step 5: Sanity check — `--with-git-history` hard-fails when git is disabled**

```bash
ANATOMY_GIT_DISABLE=1 node anatomy-cli/dist/bin.js mcp --with-git-history
echo "exit=$?"
```

Expected: stderr contains `git not found on PATH`, exit code 1.

- [ ] **Step 6: Sanity check — composition with `--with-ast-grep` produces 13 tools**

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node anatomy-cli/dist/bin.js mcp --with-ast-grep --with-git-history 2>/dev/null | head -1 | node -e "let c=''; process.stdin.on('data',d=>c+=d).on('end',()=>{const j=JSON.parse(c); console.log('tool_count=', j.result.tools.length)})"
```

Expected: `tool_count= 13`.

- [ ] **Step 7: No commit required — verification only.**

---

## Self-review checklist (planner: confirm before handing off)

- [x] **Spec coverage:**
  - Goal 1 (three read-only tools) → Tasks 2, 4, 5, 6
  - Goal 2 (zero new dependencies) → shellout to existing git (Tasks 3-6)
  - Goal 3 (composes with prior flags) → Task 8 collision check + Task 9 composition test
  - Goal 4 (byte-identical no-flag path) → Task 13 step 3 (tool_count = 9)
  - Goal 5 (hard-fail on missing git OR non-repo) → Task 8 wiring + integration tests (both cases)
  - Goal 6 (strictly read-only) → tool schemas have no command parameter; only typed inputs
  - Decision 1 (shellout, not libgit2) → Task 3 `runGit` via spawnSync
  - Decision 2 (three tools) → Tasks 4, 5, 6
  - Decision 3 (read-only by structure) → tool schemas
  - Decision 4 (SHA-canonical output) → blame/log/show all return full SHAs from git
  - Decision 5 (hard-fail at startup) → Task 8 `if (!gitBin) … if (!probeRepo)`
  - Decision 6 (bounded output) → MAX_BLAME_LINES, MAX_LOG_COMMITS, MAX_DIFF_BYTES; truncated flag
  - Decision 7 (single-cwd anchor) → Tasks 4-6 all use `process.cwd()` once; no per-call cwd input
  - Tool surface specs (git_blame / git_log_search / git_show) → schemas in Task 2; behavior in 4-6
  - Error handling table → Tasks 4 (file_not_found/invalid_input), 5 (invalid_input), 6 (invalid_ref/invalid_input), 7 (git_unavailable), 8 (not_a_git_repository)
  - Configuration env vars → consumed in Tasks 3-6 (resolveGitBin, MAX_*, TIMEOUT_MS)
  - Telemetry → Task 1 variant + Task 8 wrapper
  - Testing → Tasks 1-9
  - Composition with prior extensions → Task 9 composition test (13 tools)
  - Non-goals (mutation, remote, worktree, branch mgmt, full diff, status) → not implemented (correct per spec)
- [x] **Placeholder scan:** No "TBD"/"TODO"/"add error handling" — every step shows the actual code.
- [x] **Type consistency:** `BlameRecord`/`BlameInput`/`BlameResult`/`LogCommit`/`LogSearchInput`/`LogSearchResult`/`ShowFile`/`ShowMetadata`/`ShowInput`/`ShowResult`/`ToolDefinition`/`ToolResult`/`ToolHandler`/`_internal`/`runGit`/`parseLines`/`parseBlamePorcelain`/`parseLogOutput`/`parseShowMetadata`/`parseShowFiles`/`resolveGitBin`/`probeRepo`/`runBlame`/`runLogSearch`/`runShow` — names stable across Tasks 2-7. Telemetry record matches Task 1 type exactly. The `McpCommandOptions` shape in Task 8 matches the existing mcp.ts shape.
- [x] **Default caps match the spec table verbatim** (500 / 100 / 4096 / 5000 / 20 files per commit).

---

## Execution notes

- **Sequential, not parallel.** Tasks 2-7 all mutate the same two files (`git-history-tools.ts` + its test) with cumulative state. Subagent dispatch would force redundant re-reads. Recommend `superpowers:executing-plans` (inline with checkpoints) — same call we made for the fff and ast-grep plans.
- **Commit hygiene.** Each task lands one focused commit. We're going directly to `main` per the repo's branch policy.
- **No worktree.** Per CLAUDE.md, do not create a worktree unless explicitly asked. Work proceeds on `main`.
- **CI is authoritative.** Local full-suite flakiness on `mcp-brief-tool.test.ts` is a known issue (memory `project_public_snapshot_divergence` cont.7; the timeout was bumped to 30s on 2026-06-15). If a flaky test failure surfaces during this plan, re-run that one file in isolation to confirm it's infrastructure, not content.
- **Windows specifics.** Every `spawnSync`/`execSync` to git must pass `shell: true` (memory `t9ykw3em`). This applies inside `runGit`, `probeRepo`, `resolveGitBin`, and the integration-test git fixture setup. All test commands in Tasks 4-9 already include it.
- **After all 13 tasks merge on dev:** the rollout sequence is the same as for `--with-fff` and `--with-ast-grep` — port to the curated `origin/main` snapshot via fresh branch + FF-push, watch real CI, then `npm publish 1.3.0`.
