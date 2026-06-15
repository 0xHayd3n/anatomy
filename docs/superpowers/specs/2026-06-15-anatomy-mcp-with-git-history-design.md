# `anatomy mcp --with-git-history` — Read-Only Git History Extension Design

**Status:** Design approved; implementation plan pending.
**Date:** 2026-06-15
**Touches:** `anatomy-cli/src/commands/mcp.ts` (modify), `anatomy-cli/src/mcp/` (new `git-history-tools.ts`), `anatomy-cli/src/bin.ts`, `anatomy-cli/src/telemetry.ts`, `anatomy-cli/tests/`.
**Siblings:**
- [2026-06-15-anatomy-mcp-with-fff-design.md](2026-06-15-anatomy-mcp-with-fff-design.md) — first MCP extension (external CLI bridge, long-running subprocess).
- [2026-06-15-anatomy-mcp-with-ast-grep-design.md](2026-06-15-anatomy-mcp-with-ast-grep-design.md) — second MCP extension (in-process napi lib).

## Context

The agent working in a repo has three distinct verbs it needs:

| Verb | Tool already in `anatomy mcp` |
|---|---|
| *"What should I know about this repo?"* | anatomy itself (curated rules/decisions/memory) |
| *"Where is X **textually**?"* | `--with-fff` (resident-index file search) |
| *"Where is X **structurally**?"* | `--with-ast-grep` (AST-shape patterns) |
| *"**When** did X change and **why**?"* | **— missing —** |

`--with-git-history` fills the time axis. It exposes a small set of read-only git queries — blame, log search, and commit metadata — as MCP tools, so the agent can answer "who last touched this", "what commits introduced this regression", "what's been changing in this area lately" without each agent's own ad-hoc shellouts and stdout parsing.

`--with-git-history` is the **third** optional MCP extension on `anatomy mcp`. It sits next to `--with-fff` and `--with-ast-grep` and composes with both. Architecturally it is **neither a bridge nor an in-process lib** — git operations are one-shot `spawnSync` calls per request. There is no long-running subprocess to manage, no napi-style binding to lazy-load. The implementation pattern is closer to how anatomy already invokes git in `validateCommand` (for `--require-fresh`) than to either of the prior extensions.

## Goals

1. Add three new MCP tools — `git_blame`, `git_log_search`, `git_show` — that expose read-only git history queries with bounded output sizes.
2. Zero new dependencies: shell out to the existing `git` binary, the same one validate/rehash already use.
3. Compose cleanly with `--with-fff` and `--with-ast-grep`: any combination of flags works; tool catalogs merge without collision.
4. Anatomy's existing behaviour is **byte-identical** when `--with-git-history` is absent: no new imports load, no git probe runs, no test outcomes change.
5. Hard-fail visibly when `git` is not on PATH **or** cwd is not inside a git work-tree; never silently lose the tool.
6. Strictly read-only: tool surface makes it structurally impossible for the agent to mutate the repo through this extension.

## Non-goals (explicitly out of scope for v1)

- **Mutating operations.** No commit, checkout, reset, push, pull, fetch, clean, rebase, tag-create, branch-create, branch-delete, or anything else that changes repo state.
- **Remote queries.** No `git fetch`, `git ls-remote`, no GitHub/GitLab API calls. Local repo only.
- **Worktree / submodule introspection.** Out of scope for first cut.
- **Branch management beyond listing.** A future `git_branches` listing tool is plausible; mutating branch operations are not.
- **Full diff rendering.** `git_show` returns metadata + a truncated patch (default 4KB). For full diffs, the agent should fff/ast-grep specific files at the right SHA.
- **Long-running git operations.** Operations that take >`ANATOMY_GIT_TIMEOUT_MS` (default 5s) return `git_timeout`. No streaming, no progress.
- **Working-tree status queries.** `git status`, `git diff` (working tree vs index/HEAD), `git stash` — none of these are history queries and they're easier handled by the agent's own shellouts.

## Decisions

### 1. Shellout, not libgit2 / `simple-git` / `isomorphic-git`

The implementation invokes the `git` binary directly via `spawnSync`, parses its output, and returns structured JSON. This is the same pattern anatomy already uses elsewhere (`validateCommand` runs `git rev-parse HEAD` for `--require-fresh`; the rehash codepath uses git for fingerprint inputs).

**Rejected:** `simple-git` / `isomorphic-git` / `nodegit`. None of these are already on the dep graph, all add real install weight, and the agent doesn't need a transactional API — just query results.

**Implication:** all `spawnSync` calls **must** pass `shell: true` on Windows (memory `t9ykw3em`) for git's `.cmd` shim resolution. This already applies to the fff binary lookup; we extend the same pattern.

### 2. Three tools to start, not five or seven

Resist tool creep. The three chosen verbs cover the dominant agent intents:

- **`git_blame`** — "who last touched these lines and when?" Distinct from log because the join (line → commit) is what's actually useful.
- **`git_log_search`** — "find commits by content change (pickaxe), commit message, or path filter." One tool with a discriminator (`kind`) rather than three separate tools — agent picks the search axis explicitly.
- **`git_show`** — "tell me about this specific commit." Optional `with_diff` returns a truncated patch.

A fourth `git_diff(from, to, path?)` was considered and **deferred**. `git_show(commit, with_diff: true)` covers the most common case (what did this commit change?). Cross-ref diffs are rarer and easier added later if usage data justifies.

### 3. Strictly read-only by structural design

Tools accept narrowly-typed input parameters (filename, ref, query) — never an opaque "args" array or "command" string. There is no `git_exec(command)` tool, never will be. This rules out accidental destructive operations even if the agent generates malformed input.

### 4. SHA-canonical output, alias-tolerant input

Tools accept HEAD-relative aliases (`HEAD~3`, `main`, branch names) on input but always return full 40-char SHAs in output. HEAD-relative aliases drift over time; SHAs don't. Agents that need a stable reference get one.

### 5. Hard-fail at startup on missing git or non-repo cwd

Two startup probes when `--with-git-history` is set:

1. Resolve git binary (`where git` / `command -v git` / `ANATOMY_GIT_BIN`). On failure → exit 1 with `error: git not found on PATH`.
2. Confirm cwd is a git work-tree (`git rev-parse --is-inside-work-tree`). On failure → exit 1 with `error: not in a git repository`.

No degraded mode. Unlike `--with-fff` which has lifecycle states (healthy/restarting/degraded) because the subprocess can crash mid-session, git is invoked fresh per call — either the binary works or it doesn't. The startup check is sufficient.

### 6. Bounded output everywhere

Every tool has a hard cap. Without bounds the tool is unusable on real repos (`git log` on Linux returns 1M+ commits; `git blame` on minified files returns megabytes).

| Tool | Default cap | Env override |
|---|---|---|
| `git_blame` | 500 lines | `ANATOMY_GIT_MAX_BLAME_LINES` |
| `git_log_search` | 100 commits | `ANATOMY_GIT_MAX_LOG_COMMITS` |
| `git_show` (`with_diff: true`) | 4096 bytes of patch | `ANATOMY_GIT_MAX_DIFF_BYTES` |

When output hits the cap: `truncated: true` + `truncation_reason: "max_lines" | "max_commits" | "max_diff_bytes"`. Agents that need more can re-query with a narrower scope (e.g., `lines: "100-200"` on blame).

### 7. Single-cwd anchor

The repo root is resolved once at startup (via `git rev-parse --show-toplevel`). All git calls run with that as cwd. Per-call cwd parameters are **not** accepted — they'd complicate path validation and create a surface for path-traversal mistakes. Sub-tree scoping is done via the `path` parameter on tools that accept one.

## Architecture

### Components

A fourth tool-handler module, sibling to the existing three:

```
anatomy-cli/src/mcp/
  section-tools.ts        ← anatomy-native (overview, structure, tree, environment)
  memory-tools.ts         ← memory (search, show, stats, reverify)
  ast-grep-tools.ts       ← --with-ast-grep
  git-history-tools.ts    ← --with-git-history  (NEW)
```

`git-history-tools.ts` exports:

```ts
export const gitHistoryToolDefinitions: ToolDefinition[]
export const gitHistoryToolHandlers: Record<string, ToolHandler>
export const _internal = { parseBlamePorcelain, parseLogOutput, parseShowOutput, runGit, /* … */ }
```

Same shape as `ast-grep-tools.ts`. The `_internal` namespace is for the test seam.

A small shared loader is **not** needed (unlike `ast-grep-loader.ts`) because git resolution is straightforward and only this one consumer needs it. The binary-resolution logic lives inline in `git-history-tools.ts`.

### Wiring in `mcp.ts`

Parallel to the existing `if (opts.withFff)` and `if (opts.withAstGrep)` blocks, add:

```ts
if (opts.withGitHistory) {
  const { resolveGitBin, probeRepo } = await import("../mcp/git-history-tools.js");
  const gitBin = resolveGitBin();
  if (!gitBin) { /* exit 1: git not found */ }
  if (!probeRepo(gitBin, process.cwd())) { /* exit 1: not a git repository */ }
  if (!recordTelemetry) ({ recordTelemetry } = await import("../telemetry.js"));
  const { gitHistoryToolDefinitions, gitHistoryToolHandlers } = await import("../mcp/git-history-tools.js");
  // collision check parallel to ast-grep
  anatomyDefs.push(...gitHistoryToolDefinitions);
  Object.assign(anatomyHandlers, gitHistoryToolHandlers);
}
```

The dispatch loop wraps git_history tools with a telemetry recorder, parallel to the existing ast-grep wrapper.

## Tool surface

### `git_blame`

```json
{
  "name": "git_blame",
  "description": "Show who last touched each line of a file. Returns one record per line within the requested range, capped at ANATOMY_GIT_MAX_BLAME_LINES (default 500). For large files, pass `lines` to scope.",
  "inputSchema": {
    "type": "object",
    "required": ["file_path"],
    "properties": {
      "file_path": { "type": "string" },
      "lines": { "type": "string", "description": "Line range like \"10-25\" or single line \"42\". Optional — defaults to entire file (up to the cap)." },
      "follow": { "type": "boolean", "description": "Follow file moves/renames. Default false." }
    }
  }
}
```

Returns:
```ts
{
  matches: Array<{
    line: number,
    commit: string,         // full 40-char SHA
    author: string,
    author_date: string,    // ISO 8601
    summary: string,        // first commit message line
    content: string,        // the file content at that line, truncated at 500 chars
  }>,
  file: string,
  truncated: boolean,
  truncation_reason?: "max_lines"
}
```

### `git_log_search`

```json
{
  "name": "git_log_search",
  "description": "Find commits by content change (pickaxe), commit message, or path filter. Returns metadata + filenames touched, capped at ANATOMY_GIT_MAX_LOG_COMMITS (default 100).",
  "inputSchema": {
    "type": "object",
    "required": ["kind"],
    "properties": {
      "kind": { "type": "string", "enum": ["pickaxe", "message", "path"] },
      "query": { "type": "string", "description": "For pickaxe: string whose presence changes; for message: regex against commit message; for path: glob/path filter." },
      "limit": { "type": "number", "description": "Default 30. Hard ceiling = ANATOMY_GIT_MAX_LOG_COMMITS." },
      "since": { "type": "string", "description": "ISO date or git-relative (\"2 weeks ago\")." },
      "until": { "type": "string" },
      "author": { "type": "string", "description": "Filter by author (substring match against name or email)." }
    }
  }
}
```

`query` is required for `pickaxe` and `message`; optional for `path` (where its absence means "all commits in the time window").

Returns:
```ts
{
  commits: Array<{
    commit: string,         // full 40-char SHA
    author: string,
    date: string,           // ISO 8601
    summary: string,
    files: string[],        // up to 20 filenames; remainder truncated
  }>,
  truncated: boolean,
  truncation_reason?: "max_commits"
}
```

### `git_show`

```json
{
  "name": "git_show",
  "description": "Detailed metadata for one commit. Optional truncated patch.",
  "inputSchema": {
    "type": "object",
    "required": ["commit"],
    "properties": {
      "commit": { "type": "string", "description": "SHA or alias (HEAD, HEAD~3, branch name)." },
      "with_diff": { "type": "boolean", "description": "Include the patch body, truncated at ANATOMY_GIT_MAX_DIFF_BYTES (default 4096). Default false." }
    }
  }
}
```

Returns:
```ts
{
  commit: string,           // canonicalized to full SHA
  parents: string[],
  author: string,
  date: string,
  message: string,          // full message including body
  files: Array<{ path: string, status: "M" | "A" | "D" | "R" | "C", additions: number, deletions: number }>,
  diff?: string,            // present iff with_diff and the patch fit
  truncated?: boolean,
  truncation_reason?: "max_diff_bytes"
}
```

## Data flow (per `tools/call`)

```
tools/call git_blame { file_path: "src/foo.ts", lines: "10-25" }
  → validate inputs (file_path required, lines parseable)
  → spawnSync(git, ["blame", "--porcelain", "-L", "10,25", "src/foo.ts"], { cwd, shell: true, timeout })
  → parse --porcelain output (one record per line, header sections for new commits)
  → cap at ANATOMY_GIT_MAX_BLAME_LINES, set truncated flag if needed
  → wrap in MCP envelope { content: [{ type: "text", text: JSON.stringify(result) }], isError: false }
  → emit git_history_call telemetry (tool, duration_ms, truncated, outcome)
```

## Error handling

| Condition | Surfaced as |
|---|---|
| `git` binary not found at startup | exit 1, stderr `error: git not found on PATH; install git or omit --with-git-history` |
| cwd not a git work-tree at startup | exit 1, stderr `error: not in a git repository; cd into a git repo or omit --with-git-history` |
| File doesn't exist (`git_blame`) | `{ error: "file_not_found", path }`, `isError: true` |
| Invalid commit/ref | `{ error: "invalid_ref", ref, detail: git_stderr.slice(0, 500) }` |
| Invalid `lines` range syntax | `{ error: "invalid_input", field: "lines", detail }` |
| Per-call timeout | `{ error: "git_timeout", duration_ms }` |
| git command unexpected non-zero exit | `{ error: "git_command_failed", detail: git_stderr.slice(0, 500) }` |
| Output cap hit | `truncated: true, truncation_reason: <which>` (NOT an error) |

## Configuration

| Env | Purpose | Default |
|---|---|---|
| `ANATOMY_GIT_BIN` | Override path to git binary | resolved via PATH |
| `ANATOMY_GIT_MAX_BLAME_LINES` | Cap on blame output | `500` |
| `ANATOMY_GIT_MAX_LOG_COMMITS` | Cap on log results | `100` |
| `ANATOMY_GIT_MAX_DIFF_BYTES` | Cap on `git_show` patch body | `4096` |
| `ANATOMY_GIT_TIMEOUT_MS` | Per-call timeout for git operations | `5000` |
| `ANATOMY_GIT_DISABLE` | Force the loader to act as if git is unavailable. Test hook; pass `1`/`true` to enable. | unset |

## Telemetry

New variant on the existing `TelemetryRecord` union (matches `fff_call` and `ast_grep_call` shape):

```ts
| {
    kind: "git_history_call";
    ts: string;
    tool: "git_blame" | "git_log_search" | "git_show";
    duration_ms: number;
    truncated: boolean;
    outcome: "ok" | "file_not_found" | "invalid_ref" | "invalid_input" | "git_command_failed" | "git_timeout" | "error";
  };
```

No lifecycle events (there's no subprocess to enter `degraded` like fff).

## Testing

Mirrors `ast-grep-tools.test.ts`:

- **Tool definition + handler exports** (scaffold tests).
- **Real git via tmp-repo fixture**: `git init` + a few commits via `spawnSync`, then exercise blame/log/show against it. Cleanup is `mkdtemp`-based; OS handles eventual removal.
- **Error paths**: `file_not_found`, `invalid_ref`, `invalid_input` (malformed `lines`), `git_timeout` (force a sleep via injected env), `not_a_git_repository`.
- **Integration**: spawn `anatomy mcp --with-git-history` and round-trip a `tools/call` over stdio. Two integration tests parallel to ast-grep: hard-fail when `ANATOMY_GIT_DISABLE=1`, and tools-list merge when enabled (tool count rises from 9 to 12).
- **Composition**: spawn `anatomy mcp --with-ast-grep --with-git-history` and assert both tool sets are present (collision check works).
- **Windows-specific**: every `spawnSync`/`execSync` to git in the implementation must pass `shell: true`. Integration tests already exercise this on the runner's OS.

## Composition with prior extensions

```bash
anatomy mcp --with-fff --with-ast-grep --with-git-history
# 9 anatomy-native + 3 fff + 1 ast-grep + 3 git = 16 tools
```

The dispatch loop in `mcp.ts` handles ast_grep and git_history tools through telemetry wrappers; fff tools dispatch through the existing bridge branch. Collision check at startup covers all three sets.

## Tradeoffs vs. each prior extension

| Concern | `--with-fff` | `--with-ast-grep` | `--with-git-history` |
|---|---|---|---|
| Architecture | External subprocess bridge | In-process napi lib | One-shot shellout per call |
| Install footprint | External binary (`fff`) | optional dep already declared | git (assumed present) |
| Failure mode mid-session | crash → respawn → degrade | none (in-process) | none (one-shot) |
| Startup cost | binary resolve + handshake | napi probe | binary resolve + repo probe |
| Per-call latency | µs (resident index) | ms (cold AST parse per file) | ms-100s (`git log` on big repos) |
| Lifecycle state | yes (3 states + restart logic) | no | no |
| Output bound source | fff's own caps | hand-coded caps | hand-coded caps |

## Acceptance criteria

1. `anatomy mcp` with no flag advertises exactly 9 tools (regression).
2. `anatomy mcp --with-git-history` advertises 12 tools, includes `git_blame`, `git_log_search`, `git_show`.
3. `ANATOMY_GIT_DISABLE=1 anatomy mcp --with-git-history` exits 1 with `git not found on PATH`.
4. `anatomy mcp --with-git-history` in a non-git directory exits 1 with `not in a git repository`.
5. Round-trip via stdio MCP: `git_blame` on a file in the bundled fixture returns the expected line/commit/author tuples.
6. Round-trip: `git_log_search { kind: "message", query: "anatomy" }` returns matching commits with full SHAs.
7. Round-trip: `git_show { commit: "HEAD", with_diff: true }` returns metadata + truncated patch.
8. Composes with `--with-fff` and `--with-ast-grep`: full union is 16 tools, no collisions.
9. Telemetry: each call appends one `git_history_call` record to `~/.anatomy/telemetry.jsonl` (unless `ANATOMY_TELEMETRY_DISABLE` is set).
10. Without the flag, `anatomy mcp` behaviour is byte-identical to the prior release.
