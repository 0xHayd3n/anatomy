# `anatomy mcp --with-ast-grep` — In-Process AST Search Extension Design

**Status:** Design approved; implementation plan pending.
**Date:** 2026-06-15
**Touches:** `anatomy-cli/src/commands/mcp.ts` (modify), `anatomy-cli/src/mcp/` (new `ast-grep-tools.ts`), `anatomy-cli/src/bin.ts`, `anatomy-cli/src/telemetry.ts`, `anatomy-cli/tests/`.
**Sibling:** [2026-06-15-anatomy-mcp-with-fff-design.md](2026-06-15-anatomy-mcp-with-fff-design.md) — the first MCP extension. Same opt-in pattern, deliberately *different* architecture (see Decisions §1).

## Context

[ast-grep](https://ast-grep.github.io/) is a structural code-search tool that matches by AST shape rather than text — *"find every `CallExpression` whose callee is `spawnSync` and whose options object lacks `shell: true`"* — queries that text-grep (and fff) structurally cannot answer.

anatomy already optional-depends on `@ast-grep/napi` and lazy-loads it in
[`anatomy-cli/src/verify-suggest/test-mining.ts`](../../../anatomy-cli/src/verify-suggest/test-mining.ts) to power the `kind = "ast_pattern"` verify clause on `[[rules]]` entries. This design extends that already-paid investment one layer up: expose ast-grep to the agent at runtime via an opt-in MCP tool so the agent can run structural queries during a session, not just at rule-verification time.

`--with-ast-grep` is the **second** optional MCP extension on `anatomy mcp`. It sits next to `--with-fff` and composes with it (`anatomy mcp --with-fff --with-ast-grep` enables both). Architecturally it is **not a bridge** — there is no subprocess to proxy. The napi module loads in the same Node process as anatomy's MCP server and the tool handler runs in that process. Naming and code structure reflect that.

## Goals

1. Add one new MCP tool, `ast_grep_search`, that executes an ast-grep pattern against the repo and returns structured matches. Read-only; no rewriting.
2. Zero install footprint beyond what users already have: `@ast-grep/napi` is already an optional dependency in `anatomy-cli/package.json`.
3. Compose cleanly with `--with-fff`: both flags can be set together; the tool catalogs merge without collision.
4. Anatomy's existing behaviour is **byte-identical** when `--with-ast-grep` is absent: no new imports load, no napi probe runs, no test outcomes change.
5. Hard-fail visibly when the napi module is unavailable; never silently lose the tool.

## Non-goals (explicitly out of scope for v1)

- `ast_grep_rewrite` — mutating ast-grep operations. Requires confirm / dry-run semantics; defer until the read-only tool's value is demonstrated.
- `ast_grep_scan` against a project's existing `sgconfig.yml`. Useful for repos that already use ast-grep as a linter; defer.
- Cross-linking with fff (e.g., feed fff's frecency into ast-grep's file walk order). Same "v2 cross-link" punt the fff design made.
- Polyglot search (one call, multiple languages in the same invocation). Each call is single-language.
- Pattern-diagnostic suggestions on parse failures. Surface the error, no auto-correct.
- A `[[rules]]`-driven aggregate scan (run every anatomy rule's `ast_pattern` verify clause in one call). The existing per-rule-staleness machinery already covers this on MCP reads when staleness is non-cosmetic.
- Generalising the existing fff bridge pattern into a shared abstraction. See Decisions §1 — fff and ast-grep are intentionally different shapes.

## Decisions

These are locked from the brainstorming pass. Each carries the rationale.

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | Integration shape | **In-process via `@ast-grep/napi`** | The optional dep is already declared and already lazy-loaded by `verify-suggest/test-mining.ts`. Loading it in the MCP server too is free in install footprint and a clean reuse of an existing pattern. Zero IPC overhead. The alternatives — spawning the `ast-grep` CLI per call or wrapping a community `ast-grep-mcp` server — either reintroduce fork-per-call cost (the exact thing `--with-fff` exists to avoid) or take a dependency on an immature ecosystem. |
| 2 | Tool surface | **Single `ast_grep_search` tool** | The 80/20 win: "find structurally" is the dominant agent need. `_scan` and `_rewrite` are real, distinct surfaces with different risk profiles and are listed as follow-ups. |
| 3 | Activation | **`--with-ast-grep` flag (opt-in)** | Mirrors `--with-fff`. Explicit, debuggable, no surprise behaviour from the napi module's presence. The flag composes with `--with-fff`. |
| 4 | Missing `@ast-grep/napi` | **Hard fail with actionable error** | User explicitly opted in via the flag. Silently dropping the tool masks the configuration mistake. Reuses the existing `verify-ast-grep-unavailable` error string. |
| 5 | `lang` parameter | **Hybrid: optional, inferred from `file_path` extension** | If `file_path` is provided, infer `lang` from the extension; if `file_path` is absent, require `lang` explicitly and fail with a hint listing supported languages. Ergonomic without silent guessing. |
| 6 | Generalise bridge pattern? | **No** | fff is a subprocess MCP we proxy; ast-grep is a library we load. They are genuinely different shapes; forcing a shared abstraction would obscure both. Each extension gets its own module; the common surface is the convention (opt-in flag, lazy load, telemetry event, tool-name collision check at startup), not a class. |

## Architecture

```
                                  ┌──────────────────────────────────────┐
   ┌─────────────┐    stdio MCP   │  anatomy mcp (Node)                  │
   │   Agent     │ ──────────────►│                                      │
   │             │                │  ┌────────────────────────────────┐  │
   │             │ ◄──────────────│  │ ToolRegistry                   │  │
   └─────────────┘                │  │   • anatomy_* (built-in)       │  │
                                  │  │   • ffgrep / fffind  ← bridge  │  │
                                  │  │   • ast_grep_search  ← in-proc │  │
                                  │  └────────────────────────────────┘  │
                                  │  ┌────────────────────────────────┐  │
                                  │  │ src/mcp/ast-grep-tools.ts      │  │
                                  │  │   lazy `@ast-grep/napi` import │  │
                                  │  │   walks fs.glob; parses each   │  │
                                  │  │   file; collects matches       │  │
                                  │  └────────────────────────────────┘  │
                                  └──────────────────────────────────────┘
```

When `--with-ast-grep` is set, `mcpCommand` probes `@ast-grep/napi` via the existing `loadAstGrep()` helper (extracted from `verify-suggest/test-mining.ts` into a shared location). On success, `ast_grep_search`'s definition + handler get merged into the same `allDefs` / `anatomyHandlers` arrays that already carry `section-tools.ts` and `memory-tools.ts`. The handler runs entirely inside this Node process — no subprocess.

## Components

### `anatomy-cli/src/mcp/ast-grep-tools.ts` (new, ~180 LOC)

Owns the `ast_grep_search` tool. Exports:

```ts
export const astGrepToolDefinitions: ToolDefinition[];  // single entry
export const astGrepToolHandlers: Record<string, ToolHandler>;
```

Mirrors the shape of `section-tools.ts` and `memory-tools.ts` so the `mcpCommand` dispatch loop integrates it with no special casing — it's just another tool-handler module.

Internal structure:

- **`loadAstGrep()`** — **extracted to a new shared module** `anatomy-cli/src/ast-grep-loader.ts` and re-exported from there. The existing `verify-suggest/test-mining.ts` copy gets replaced with the import. One module owns the napi probe; both consumers (verify-suggest and ast-grep-tools) share it. This refactor is a Phase 0 task in the implementation plan.
- **`inferLang(filePath: string | undefined): string | null`** — maps a file extension to an ast-grep language id via the table below. Returns `null` when no extension match.
- **`defaultExtensionsFor(lang: string): string[]`** — the inverse mapping: given a language, return the extensions to walk by default when `file_path` is omitted. Same source of truth as `inferLang`.
- **`walkFiles(opts: { globPattern?: string; lang: string; maxFiles: number }): AsyncIterable<string>`** — uses Node 22's `fs.glob` (already used by `test-mining.ts:38`). If `globPattern` is provided, use it; else build a glob from `defaultExtensionsFor(lang)` rooted at `process.cwd()`. **Always filters out** the common non-source directories listed below — this is what makes the tool usable on a real repo with `node_modules` etc. Caps at `ANATOMY_AST_GREP_MAX_FILES` (default 5000).
- **`runSearch(args)`** — orchestrates: validate input → resolve lang → walk files → parse + match each → return result envelope.

**Language / extension table** (single source of truth, used by both `inferLang` and `defaultExtensionsFor`):

| ast-grep `lang` | Extensions (default walk set) |
|---|---|
| `ts` | `.ts` |
| `tsx` | `.tsx` |
| `js` | `.js`, `.mjs`, `.cjs` |
| `jsx` | `.jsx` |
| `py` | `.py` |
| `rs` | `.rs` |
| `go` | `.go` |
| `java` | `.java` |
| `c` | `.c`, `.h` |
| `cpp` | `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hh` |
| `rb` | `.rb` |
| `php` | `.php` |
| `swift` | `.swift` |
| `kotlin` | `.kt`, `.kts` |
| `scala` | `.scala` |
| `lua` | `.lua` |
| `html` | `.html`, `.htm` |
| `css` | `.css` |
| `yaml` | `.yml`, `.yaml` |
| `json` | `.json` |
| `bash` | `.sh`, `.bash` |

The table is exhaustive for the v1 surface — languages not listed must be invoked with an explicit `file_path` glob (and a `lang` value ast-grep itself recognises), since neither inference nor default-walk works without an entry.

**Default-exclude directories** (always pruned from the walk, regardless of `file_path`):

```
node_modules/  dist/  build/  out/  target/  .git/  .next/  .nuxt/
.svelte-kit/  .turbo/  .cache/  coverage/  vendor/  __pycache__/
.venv/  venv/  env/  .tox/  .pytest_cache/
```

This list is deliberately conservative — every entry is a directory that, if scanned, would dwarf the actual source. The list is hard-coded for v1; if real usage surfaces a missed common case (e.g., Rust's `target/debug/build/...`), add to the list rather than introducing a config knob.

### `anatomy-cli/src/commands/mcp.ts` (modify)

Add a sibling block to the existing `if (opts.withFff)` branch:

```ts
if (opts.withAstGrep) {
  const { loadAstGrep } = await import("../mcp/ast-grep-tools.js");
  const napi = await loadAstGrep();
  if (!napi) {
    process.stderr.write(
      "error: @ast-grep/napi not available; reinstall with " +
      "'npm install --save-optional @ast-grep/napi' or omit --with-ast-grep\n"
    );
    return 1;
  }
  const { astGrepToolDefinitions, astGrepToolHandlers } = await import("../mcp/ast-grep-tools.js");
  anatomyDefs.push(...astGrepToolDefinitions);
  Object.assign(anatomyHandlers, astGrepToolHandlers);
  // Tool-name collision check (cheap; mirrors the fff bridge's check)
  // ... see Data flow §3.
}
```

The merge happens against the same `anatomyDefs` / `anatomyHandlers` the section + memory tools already populated, so dispatch in the `CallToolRequestSchema` handler needs no changes.

### `anatomy-cli/src/bin.ts` (modify)

- Add `if (a === "--with-ast-grep") { flags.withAstGrep = true; i++; continue; }` next to the existing `--with-fff` line.
- Thread `withAstGrep: !!flags.withAstGrep` into `mcpCommand({ ... })`.
- Update the HELP block's `mcp` entry to document the new flag alongside the existing `--with-fff` notes.

### `anatomy-cli/src/telemetry.ts` (modify)

Append one variant to `TelemetryRecord`:

```ts
| {
    kind: "ast_grep_call";
    ts: string;
    tool: "ast_grep_search";
    lang: string;
    files_scanned: number;
    matches: number;
    truncated: boolean;
    duration_ms: number;
    outcome: "ok" | "missing_pattern" | "missing_lang_or_file_path" | "pattern_parse_failed" | "error";
  };
```

No lifecycle variant — there is no subprocess to enter `degraded`. The hard-fail-at-startup path is observable via the existing process exit, which is what the equivalent fff bridge state would also produce.

### Test files

- **`anatomy-cli/tests/ast-grep-tools.test.ts`** *(new, ~150 LOC)*. Real napi (it's already a dev/CI dep). Real tiny fixture repos (a couple of `.ts`, `.py`, `.rs` files). Coverage:
  - Basic search: pattern with no captures returns expected matches.
  - Pattern with metavariables (`spawnSync($X, $$$)`) returns captures.
  - Language inference from `file_path` (`.ts` → `ts`).
  - Hard-error when both `lang` and `file_path` are missing.
  - `max_results` truncation sets `truncated: true` and stops the walk early.
  - Malformed pattern returns `pattern_parse_failed`.
  - Empty result set returns `{ matches: [], files_scanned: N }` (not an error).

- **`anatomy-cli/tests/mcp-integration.test.ts`** *(modify)*. One new integration test that spawns `node bin.js mcp --with-ast-grep`, makes an `ast_grep_search` round-trip via stdio, and asserts the response shape. Plus the existing `tools.length).toBe(9)` regression test still pins the no-flag path.

### Files explicitly **not** touched

`section-tools.ts`, `memory-tools.ts`, `brief-tool.ts`, `fff-bridge.ts`, every Pass 1 / Pass 2 path, every render / validate path. The extension is additive; no anatomy-native or fff-bridge code path branches on ast-grep state.

## Data flow

### Startup (with `--with-ast-grep`)

1. `bin.ts` parses argv → `mcpCommand({ withAstGrep: true })` (composes with `withFff`).
2. `mcpCommand` enters the `withAstGrep` branch. Calls `loadAstGrep()`.
3. Null → log the documented error to stderr, exit 1. Anatomy never starts the MCP server.
4. Non-null → import `astGrepToolDefinitions` / `astGrepToolHandlers`, push the single definition onto `anatomyDefs`, merge the handler into `anatomyHandlers`.
5. Collision check: if any name in `astGrepToolDefinitions` already exists in the prior `anatomyHandlers` (i.e., shadows a built-in or a fff-bridge tool), hard fail with `Error: ast-grep tool name collision: <name>`, exit 1.
6. Continue normal startup. The unified `ListTools` response includes the new tool.

### Per `ast_grep_search` call

1. Read args from `request.params.arguments`. Required: `pattern: string`. Optional: `lang: string`, `file_path: string` (glob), `max_results: number` (default 50, hard cap 500).
2. If `pattern` is missing or empty → return `{ isError: true, content: [{ type: "text", text: JSON.stringify({ error: "missing_pattern" }) }] }`, record telemetry with `outcome: "missing_pattern"`.
3. Resolve `lang`:
   - explicit `lang` → use it
   - else if `file_path` → call `inferLang(file_path)`; if null → return `missing_lang_or_file_path` error
   - else → return `missing_lang_or_file_path` error
4. Compile the pattern via napi for the chosen language. On parse failure → return `pattern_parse_failed` with the language and the parser error message.
5. Walk files via `walkFiles({ globPattern: file_path, lang, maxFiles: process.env.ANATOMY_AST_GREP_MAX_FILES ?? 5000 })`. Increment `files_scanned` per successfully-read file.
6. Per file: `readFile` → `napi.parse(lang, content).root().findAll(compiled)`. Collect matches:
   - `file`: repo-relative path
   - `line`, `column`: 1-indexed start position
   - `text`: matched node's text (capped at 500 chars; longer → suffix `…`)
   - `captures`: `{ name: text }` for every metavariable matched
7. If `matches.length >= maxResults` mid-walk → break out and set `truncated: true`.
8. Return `{ matches, files_scanned, truncated, language }`. Record telemetry with `outcome: "ok"`.

### Per call when `--with-ast-grep` is off

Not applicable — `ast_grep_search` is not in the tool catalog. `tools/call name="ast_grep_search"` falls through anatomy's existing `unknown_tool` error path.

## Error handling

| Failure | Behavior | Telemetry `outcome` |
|---|---|---|
| `--with-ast-grep` set but `@ast-grep/napi` not loadable | Hard fail at startup with actionable error, exit 1. | (none — process exits before any tool call) |
| Tool name collision at startup | Hard fail, exit 1, log both names. | (none) |
| Missing `pattern` arg | `isError: true`, `error: "missing_pattern"` | `missing_pattern` |
| Both `lang` and `file_path` missing | `isError: true`, `error: "missing_lang_or_file_path"`, hint listing supported langs | `missing_lang_or_file_path` |
| Pattern parse fails for the chosen language | `isError: true`, `error: "pattern_parse_failed"`, `language`, `detail` | `pattern_parse_failed` |
| Empty result set (zero matching files OR zero matches across all scanned files) | `isError: false`, `matches: []`, `files_scanned: N` (NOT an error) | `ok` |
| Individual file fails to read or parse during the walk | Skip silently, decrement nothing, continue the walk. | `ok` (assuming any other file produces matches; the failed file does not count in `files_scanned`) |
| Walk hits `ANATOMY_AST_GREP_MAX_FILES` | Stop the walk; return what was collected; do NOT set `truncated` (truncation tracks the match cap, not the file cap). | `ok` |

The error names (`missing_pattern`, `missing_lang_or_file_path`, `pattern_parse_failed`) are documented stable contract — agents that know these strings can recover gracefully.

## Configuration surface

| Surface | Purpose | Default |
|---|---|---|
| `anatomy mcp --with-ast-grep` | Enable the `ast_grep_search` tool for this MCP server instance. Without the flag, no napi probe runs and the tool is not in the catalog. | off |
| `ANATOMY_AST_GREP_MAX_FILES` env | Cap on the number of files the walk will read per call. Bounds worst-case latency on huge repos. | `5000` |
| `ANATOMY_MCP_DISABLE` env *(existing)* | Disables the entire MCP server, regardless of which `--with-*` flags are set. | off |

No new fields in `.anatomy` or `.anatomy-memory`. No new CLI subcommand. No new top-level package dependency — `@ast-grep/napi` is already an `optionalDependency`. The MCP SDK client side used by `--with-fff` is irrelevant here (no subprocess to talk to).

## Testing

### Unit — `anatomy-cli/tests/ast-grep-tools.test.ts` (new)

Real napi (already a dev/CI dep), tiny fixture repos written into `mkdtempSync`. Test cases:

1. **Basic search**: search `console.log($X)` against a TS fixture → exactly the expected line + capture.
2. **Multiple languages**: same shape against a Python fixture (`print($X)`) and a Rust fixture (`println!($X, $$$)`).
3. **Language inference**: invoking with `file_path: "src/**/*.ts"` and no `lang` correctly resolves to `lang: "ts"`.
4. **Missing both lang and file_path**: returns `missing_lang_or_file_path`.
5. **Missing pattern**: returns `missing_pattern`.
6. **Malformed pattern**: returns `pattern_parse_failed` with the language echoed back.
7. **`max_results` truncation**: fixture with 10 matches, `max_results: 3` → 3 matches, `truncated: true`.
8. **Empty result set**: fixture with no matches → `matches: []`, `files_scanned > 0`, no `isError`.
9. **Captures**: pattern with metavariables (`spawnSync($X, $$$)`) returns `captures: { X: "..." }` on each match.
10. **File-walk skipping**: a fixture with one valid file + one zero-byte/binary file → only the valid file is in `files_scanned`; no error surfaces.

### Integration — opt-in via stdio MCP

One new test appended to `anatomy-cli/tests/mcp-integration.test.ts`: spawn `node anatomy-cli/dist/bin.js mcp --with-ast-grep`, send `tools/list` (expect 10 tools — the 9 anatomy-native + `ast_grep_search`), then `tools/call` with a real pattern against the fixture repo and assert match shape.

The existing regression test (no-flag path: 9 tools) is the safety net that the off-by-default invariant holds.

### Existing-behaviour regression

Every existing anatomy-cli test must pass identically without `--with-ast-grep`. This is enforced by leaving `mcpCommand`'s default path unchanged when the flag is absent: no ast-grep imports, no napi probe, no env read beyond what today's `mcpCommand` already does.

## Telemetry

The new `ast_grep_call` variant on the existing `~/.anatomy/telemetry.jsonl` stream lets us answer:

- How often agents call `ast_grep_search`.
- Median `files_scanned` per call (calibrates the 5000-file cap).
- Median `matches` per call.
- Truncation rate (calibrates the 500-match cap).
- Outcome distribution — especially how often agents trigger `missing_lang_or_file_path` (a UX signal that the schema hint isn't landing).

No lifecycle variant. There's no subprocess to enter `restarting` / `degraded`. The startup hard-fail is observable via the existing process-exit telemetry channel (or, if needed later, a one-shot `ast_grep_loaded` event — but that's premature today).

## Rollout

1. Implement and merge behind the explicit `--with-ast-grep` flag. Default `off`. No change to install footprint or default-path behaviour.
2. Document the flag in `anatomy-cli/README.md` and `anatomy --help` next to `--with-fff`.
3. Eat our own dog food: run anatomy's MCP with `--with-fff --with-ast-grep` against the anatomy repo itself. Capture telemetry across a sprint of real agent sessions.
4. Calibrate the 5000-file / 500-match caps from telemetry. If truncation rate is >5%, raise the match cap; if `files_scanned` p99 is well under 5000, leave the file cap or even lower it.
5. The `_rewrite`, `_scan`, and cross-link follow-ups stay decoupled from this rollout.

## Risks

- **napi platform compatibility.** `@ast-grep/napi` ships prebuilds per (os × arch × node-abi); a user on an exotic combo (e.g., FreeBSD ppc64) may have it install successfully as `null` (no binary). The hard-fail-at-startup path catches this loudly, which is the intended behaviour. Mitigation: the error message points at the explicit reinstall command.
- **Walk performance on monorepos.** The default 5000-file cap is a guess. On a very large repo a careless agent could spend non-trivial wall-clock per call. Mitigation: env-var override + telemetry-driven calibration in Phase 4 of rollout. Mid-call cancellation is *not* added in v1; the cap is the only backstop.
- **Pattern syntax foot-guns.** ast-grep's pattern language has subtle behaviours (e.g., `$X` matches a single node vs. `$$$X` matching a sequence). The tool description points at the docs but doesn't teach the language. An agent unfamiliar with the syntax may waste calls on malformed patterns. Mitigation: `pattern_parse_failed` carries the parser error verbatim so the agent gets immediate feedback.
- **Tool-name collision with future ecosystem.** `ast_grep_search` is unlikely to collide today, but the startup collision check guards against future drift between an external tool and our naming.
- **Coupling the optional dep into a runtime path.** Until now `@ast-grep/napi` was only loaded inside `verify-suggest`, which most users never touch. This makes it also loaded by anyone using `--with-ast-grep`. That is the intended change. The existing `verify-ast-grep-unavailable` error code already documents the install path for users who want the optional dep present.

## Open follow-ups (not part of v1)

- **`ast_grep_rewrite`** — mutating ast-grep operations with dry-run + confirm semantics. Real risk surface; needs its own design pass on UX.
- **`ast_grep_scan`** — run a project's existing `sgconfig.yml` and return all rule violations. Useful for repos that already use ast-grep as a linter.
- **fff frecency → ast-grep walk order** — feed fff's resident frecency index into the file-walk order so likely-relevant files are scanned first. Same "v2 cross-link" punt the fff design made.
- **Aggregate `[[rules]]` scan** — run every `kind = "ast_pattern"` rule's verify clause in one call. Overlaps with the per-rule-staleness machinery already wired into MCP envelopes; revisit if real demand surfaces.
- **Polyglot search** — one pattern, multiple languages in one call. Probably implementable as a thin wrapper that fans out internally; defer until single-language flow has telemetry support.
