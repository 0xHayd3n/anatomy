# @anatomytool/cli

`anatomy` — the command-line tool for the [Anatomy standard](https://anatomy.dev).
Generate, validate, and maintain **`.anatomy`** files: a small,
machine-readable corpus of per-repo context that AI coding agents can
**cite reliably** and that **detects its own staleness** against git. Manage
the paired **`.anatomy-memory`** lived-experience log, and serve both to AI
tooling as a Claude Code SessionStart hook or an MCP server.

It targets a recurring failure mode: agents re-derive the same project facts
every session, miss system-level rules that don't grep cleanly, and trust
stale docs. `.anatomy` captures the *uncapturable* (rules, flows, decisions,
coined vocabulary, cross-file invariants, anti-patterns, prerequisites) plus a
four-pillar identity, pins every read to a commit, and renders the same
surface into formats other tools already read (`AGENTS.md`, Cursor, Aider,
Cline, Roo, Continue, Windsurf).

> Honest scope: the measured win is *citation reliability* and
> *self-detected staleness*, not faster lookups. See the
> [project README](../README.md) for the cross-repo eval numbers.

## Install

```bash
npm install -g @anatomytool/cli      # provides `anatomy` (and `anatomy-cli`)
# or, without installing:
npx @anatomytool/cli --help
```

Requires **Node.js ≥ 22**.

## Quick start

```bash
anatomy generate          # Pass 1: starter .anatomy from manifest + README + dirs; also writes AGENTS.md
anatomy generate --force --ai   # Pass 2: enrich the TODO/human-knowledge fields via an AI provider
anatomy validate          # validate .anatomy (and a sibling .anatomy-memory if present)
anatomy render            # cheap re-render of derived files after hand-edits (no Pass 1/2)
anatomy mcp               # expose it to agents over MCP  (or: anatomy hook)
```

A generated `.anatomy` is TOML you are expected to **hand-edit** — Pass 1
fills what it can deterministically and leaves `# TODO` markers for the
human-knowledge fields.

## Concepts

- **`.anatomy`** — TOML at the repo root. Required: `[identity]` (four
  pillars — Stack, Form, Domain, Function — plus a derived `fingerprint`) and
  `[generated]` (provenance, including the git commit it was generated at).
  Optional high-value sections: `[[rules]]`, `[[flows]]`, `[[decisions]]`,
  and (v0.15+/v1.0) `[[vocabulary]]`, `[[invariants]]`, `[[anti_patterns]]`,
  `[[prerequisites]]`.
- **`.anatomy-memory`** — append-only log of lived experience (gotchas,
  decisions, conventions, attempts, milestones), paired to the `.anatomy` by
  `repo_fingerprint`.
- **Staleness** — every consumer read compares `[generated].commit` to git
  `HEAD`; drift is surfaced, not silently trusted.
- **Rule verification** — a `[[rules]]` entry may carry an optional `verify`
  clause so the documented rule is machine-checked against source; per-rule
  drift is reported on MCP reads.
- **Format version** — declared by `anatomy_version`. Latest is **v1.0**
  (the stabilization of v0.15 — structurally identical; the 0→1 bump is a
  stability commitment, not a breaking change). v0.1–v0.15 remain valid and
  routable. Normative index: [`spec/CURRENT.md`](../spec/CURRENT.md).

## Commands

`anatomy --help` is the authoritative, always-current reference. Global
options: `-h, --help` · `--version` · `-v, --verbose`.

### Generation & authoring

- **`anatomy generate [--repo <path>] [--force] [--stdout] [--ai] [--rich] [--provider <name>] [--print-prompt] [--providers] [--no-agents-md]`**
  Deterministic Pass 1 from manifest + README + directory listing. `--ai`
  runs Pass 2 to fill `domain`/`function`, structure purposes, and
  `[[rules]]`/`[[flows]]`/`[[decisions]]`. `--rich` additionally pulls
  README-derivable facts (author, license, docs URL, install/dev commands,
  key dependencies with versions, full description) and emits the latest
  format version (implies `--ai`). Also writes `AGENTS.md` unless
  `--no-agents-md`.
- **`anatomy ingest [<path>] [--repo <dir>] [--force] [--no-pass1] [--stdout]`**
  Seed a `.anatomy` from an existing `CLAUDE.md` / `AGENTS.md` /
  `.cursorrules` / `.windsurfrules`. Auto-scans the repo root when no path is
  given; uses Pass 1 for identity/structure and a heading allowlist (Rules /
  Conventions / Guidelines / Code style / …) for rule extraction. Refuses on
  an existing `.anatomy` unless `--force`. Deterministic, no AI dependency.
- **`anatomy render [--repo <path>] [--check] [--budget <tokens>] [--memory-count <n>] [--no-agents-md] [--yes]`**
  Re-emit the derived files from an existing `.anatomy` — no Pass 1/2. Cheap
  regen after hand-edits to `.anatomy` or `.anatomy-memory`. `--check` exits
  non-zero with a unified diff if disk is out of date (CI drift gate). Hand-
  written `AGENTS.md` is backed up to `AGENTS.md.bak` on first regeneration.

Per-tool emitters can be individually suppressed on `generate`/`render`:
`--no-cursor-mdc`, `--no-cursor-rules`, `--no-aider`, `--no-cline`,
`--no-roo`, `--no-continue`, `--no-windsurf`.

### Validation & maintenance

- **`anatomy validate [<path>] [--require] [--require-fresh] [--no-strict] [--json] [--quiet]`**
  Validate a `.anatomy` (and a sibling `.anatomy-memory` if present).
  **Strict by default**: source-cross-check warnings
  (`unused-dependency-claim`, `literal-not-in-source`,
  `source-cross-check-truncated`) are treated as errors — this catches Pass 2
  fiction (e.g. listing deps no source imports). `--no-strict` keeps them as
  warnings. `--require` fails if no file is found; `--require-fresh` fails if
  `generated.commit` ≠ git HEAD; `--json` emits structured output.
- **`anatomy explain <code>`** — print the documentation for any error or
  warning code emitted by the validator.
- **`anatomy migrate --to <version> [<path>] [--stdout]`** — migrate a
  `.anatomy` to a newer format version; intermediate steps are chained
  automatically (any version up to **v1.0**). Identity-preserving steps keep
  a paired `.anatomy-memory` valid; lossy steps warn.
- **`anatomy rehash [<path>] [--update-memory]`** — recompute the pillar
  fingerprint from the identity IDs (byte-preserving otherwise).
  `--update-memory` propagates the new fingerprint to a paired
  `.anatomy-memory` header.
- **`anatomy verify suggest [--repo <path>] [--refresh-registry]`** —
  interactively propose `verify` clauses for `[[rules]]` lacking one
  (test-mining → semgrep-rules registry → LLM fallback, each dry-run gated;
  per-rule accept / edit / reject / skip). Requires a TTY.

`verify` clause kinds: `glob_exists`, `glob_only`, `ast_pattern` (optional
`@ast-grep/napi`), and (v0.13+) `semgrep` for pattern combinators / taint
mode / non-JS-family languages (optional `semgrep` CLI on PATH).

### Lived-experience memory

- **`anatomy add <kind> <topic> [content] [--refs a,b] [--tags a,b] [--supersedes <id>]`**
  Append a memory entry. Kinds: `gotcha | decision | convention | attempt |
  milestone`. Content from arg, `-` (stdin), or `$EDITOR` if omitted.
- **`anatomy memory list [--kind <k>] [--topic <s>] [--ref <s>] [--tag <t>] [--include-superseded] [--only-fresh]`**
  Tabular list (superseded/deprecated hidden by default). Includes a `decay`
  column: `fresh` (verified ≤30d), `aging` (30–180d), `stale` (>180d),
  `untouched` (never verified).
- **`anatomy memory grep "<query>"`** — substring match over topic + content.
- **`anatomy memory search "<query>" [--kind <k>] [--tag <t>] [--ref <s>] [--limit <n>] [--include-superseded]`**
  BM25F relevance ranking (topic ×3, tags ×2, content ×1) × decay. Default
  limit 10.
- **`anatomy memory show <id>`** — full detail + supersession chain.
- **`anatomy memory stats`** — per-kind active/superseded/deprecated counts,
  with v0.2 decay-bucket sub-counts.
- **`anatomy memory deprecate <id> --reason <text>`** — mark obsolete with no
  replacement.
- **`anatomy memory verify <id>`** — confirm an entry is still relevant
  (memory v0.2): records `last_verified_at` + `verified_by`; bumps a v0.1
  file to `anatomy_memory_version = "0.2"` on first verify.
- **`anatomy memory thanks <id>`** / **`anatomy memory credits`** — record
  that an entry helped (idempotent per identity); show a contributor table.

### Agent integration

- **`anatomy hook [--root] [--max-tokens <n>] [--json]`** — emit markdown for
  a [Claude Code](https://docs.claude.com/en/docs/claude-code) SessionStart
  injection (default 1,200-token budget; prepends a staleness banner when out
  of sync with HEAD). Wire it via your client's hook config — see
  [`anatomy-consumer.plugin/`](../anatomy-consumer.plugin/).
- **`anatomy show [<path>] [--prose] [--no-memory | --memory-only] [--memory-limit-<kind>=N]`**
  Print a parsed `.anatomy`; `--prose` renders natural language (the hook
  format) and appends the memory log if present. Default prose caps: 10
  gotcha/decision, 5 attempt/milestone, uncapped conventions.
- **`anatomy mcp`** — start an MCP stdio JSON-RPC server. Every response uses
  a uniform staleness-aware envelope:
  `{ anatomy_path, staleness, repo_fingerprint, data }`.

  | Group | Tools |
  |---|---|
  | Section | `anatomy_brief` (primary — rules + memory + flows for a query), `anatomy_overview` (identity + tagline), `anatomy_structure`, `anatomy_environment`, `anatomy_tree` |
  | Memory | `anatomy_memory_search`, `anatomy_memory_show`, `anatomy_memory_stats`, `anatomy_memory_reverify` |

  (`anatomy_interface`, `anatomy_substance`, `anatomy_domain_model`, and
  `anatomy_code_profile` were removed alongside their schema slots in
  v0.8–v0.9.)

  **Per-rule staleness.** When the envelope reports non-cosmetic staleness,
  each `[[rules]]` entry's `verify` clause is re-run against the working tree
  and the outcome attached as `staleness.rules`: `passing`, `failing` (with
  file:line hits where the verifier supports it), `unverified` (no clause
  authored), or `error` (verifier dependency missing or timed out). Pair with
  `anatomy verify suggest` to author the clauses interactively, then surface
  per-rule drift on every MCP read.

- **`anatomy mcp --with-fff`** — opt-in flag that additionally spawns
  [`fff-mcp`](https://github.com/dmtrKovalenko/fff) as a child MCP subprocess
  and exposes every tool it advertises (as of fff 0.9.x: `find_files`,
  `grep`, `multi_grep`) inside anatomy's MCP namespace. Anatomy is both an
  MCP server to the agent and an MCP client to `fff` in the same process,
  so the agent gets curated repo knowledge AND fast file search from one
  endpoint. The bridge is name-agnostic — whatever the installed `fff-mcp`
  binary advertises is what the agent sees.

  - **Hard fail on missing binary.** If `fff` is not on `PATH` (or
    `ANATOMY_FFF_BIN` points at a missing file), `anatomy mcp --with-fff`
    exits 1 with an actionable error.
  - **One-shot restart, then degrade.** A first child crash triggers a
    transparent respawn. A second crash marks `fff` tools unavailable for
    the rest of the session; anatomy's own tools keep serving.
  - **Per-call timeout.** A forwarded call that doesn't return within
    `ANATOMY_FFF_TIMEOUT_MS` (default 5000) returns `fff_timeout`.

  | Env | Purpose | Default |
  |---|---|---|
  | `ANATOMY_FFF_BIN` | Override the path to the `fff-mcp` binary. | (resolve via `PATH`) |
  | `ANATOMY_FFF_ARGS` | Space-split argv passed to the binary at spawn. fff ships as a dedicated `fff-mcp` server that takes no subcommand. | (none) |
  | `ANATOMY_FFF_TIMEOUT_MS` | Per-`tools/call` timeout in milliseconds. | `5000` |

  Without `--with-fff`, the behaviour of `anatomy mcp` is byte-identical to
  earlier versions — no new dependencies are loaded, no discovery runs.

- **`anatomy mcp --with-ast-grep`** — opt-in flag that exposes
  `ast_grep_search` inside anatomy's MCP namespace via the existing
  `@ast-grep/napi` optional dependency. Unlike `--with-fff`, this is **not a
  bridge** — there's no subprocess, no IPC. The napi module loads in the
  same Node process as anatomy's MCP server.

  - **What it adds.** A single read-only `ast_grep_search` tool that takes
    a `pattern` (ast-grep pattern syntax) plus either an explicit `lang` or
    a `file_path` glob (lang inferred from extension). Returns matches with
    `{ file, line, column, text, captures }`. Find by AST shape — *"every
    `CallExpression` whose callee is `spawnSync`"* — instead of by text.
  - **Hard fail on missing napi.** If `@ast-grep/napi` failed to install
    (the optionalDep can fail on exotic platforms), `anatomy mcp
    --with-ast-grep` exits 1 with an actionable error.
  - **Default-exclude list.** The walk skips `node_modules`, `dist`,
    `build`, `target`, `.git`, and similar non-source dirs by default —
    without this, the tool would be unusable on any real repo. Pass an
    explicit `file_path` to scope further.

  | Env | Purpose | Default |
  |---|---|---|
  | `ANATOMY_AST_GREP_MAX_FILES` | Cap on files the walk reads per call. | `5000` |

  Composes with `--with-fff`: `anatomy mcp --with-fff --with-ast-grep`
  exposes both. Without the flag, the napi probe never runs and anatomy
  mcp behaves byte-identically to v1.1.0.

### Telemetry

- **`anatomy telemetry stats`** / **`anatomy telemetry clear`** — summarize
  or wipe the local log.

## AI generation (Pass 2 providers)

Pass 2 dispatches through a `Pass2Provider` interface. Three providers ship:

| Provider | Auth | Use when |
|---|---|---|
| `claude-cli` | none (uses a local `claude` CLI / Claude Code session) | Default; you have Claude Code installed |
| `anthropic-http` | `ANTHROPIC_API_KEY` | Anthropic API key, no Claude Code |
| `openai-http` | `OPENAI_API_KEY` (+ optional `OPENAI_BASE_URL`) | OpenAI / vLLM / llama.cpp / OpenRouter / any OpenAI-compatible endpoint |

Auto-detect order: `claude-cli` → `anthropic-http` → `openai-http`.
`--provider <name>` overrides; `ANATOMY_PASS2_PROVIDER` sets a default.
`ANATOMY_PASS2_API_KEY` is a generic fallback for both HTTP providers;
`ANATOMY_PASS2_MODEL` overrides the per-provider default model.
`--print-prompt` dumps the exact system + user prompt and exits without
calling a provider; `--providers` lists registered providers. The prompt
contract is published at
[`spec/1.0/pass2-prompt-contract.md`](../spec/1.0/pass2-prompt-contract.md).

**Third-party providers.** A `.anatomy-cli.toml` at the repo root can register
additional providers from npm:

```toml
[pass2]
providers = ["anatomy-pass2-gemini", "@org/my-provider"]
default   = "anatomy-pass2-gemini"   # optional; overrides auto-detect
```

Or via `ANATOMY_PASS2_PROVIDERS=anatomy-pass2-gemini,@org/my-provider` (env
wins over the file). Each entry is a package whose default export is a
`Pass2Provider`-shaped object (see the contract §5). Naming convention:
`anatomy-pass2-<vendor>`. Selection precedence: `--provider` >
`ANATOMY_PASS2_PROVIDER` > `[pass2].default` > auto-detect.

## Output renderers

`generate` and `render` always emit **`AGENTS.md`** (token-budgeted; read by
[AGENTS.md-aware](https://agents.md/) tools — Codex, Copilot, Cursor). Per-tool
rule files are **opt-in** via the `[generate]` table in `.anatomy`:

```toml
[generate]
cursor_mdc        = true   # .cursor/rules/anatomy.mdc
cursor_rules      = true   # .cursorrules
aider_conventions = true   # CONVENTIONS.md
cline_rules       = true   # .clinerules
roo_rules         = true   # .roorules
continue_rules    = true   # .continuerules
windsurf_rules    = true   # .windsurfrules

render_budget       = 1500 # token cap for renderers (default 1500)
render_memory_count = 10   # max memory entries surfaced (default 10)
```

All renderers share one markdown body; only the path (and Cursor MDC's YAML
frontmatter) differs. Banner detection + `.bak` backups apply to all. CLI
`--no-<tool>` flags override the config for a single invocation.

## Exit codes

- `0` — success (or no `.anatomy` found, unless `--require`).
- `1` — validation failed, bad usage, or `render --check` detected drift.
- `2` — refused to overwrite an existing `.anatomy` without `--force`.
- `3` — internal invariant violation (e.g. a migration produced an invalid
  file); please report.

`validate --require` / `--require-fresh` and `render --check` are designed for
CI gating.

## Privacy

Telemetry is **local-only**: hook fires and MCP-tool calls are recorded to
`~/.anatomy/telemetry.jsonl` and never transmitted; file *contents* are never
logged. Disable all writes with `ANATOMY_TELEMETRY_DISABLE=1` (`"0"`,
`"false"`, and empty string keep it enabled).

Other environment knobs: `ANATOMY_HOOK_DISABLE` (silences `anatomy hook`),
`ANATOMY_TELEMETRY_TAG` (tags each telemetry record),
`ANATOMY_TELEMETRY_DIR` (overrides the storage directory),
`ANATOMY_MEMORY_DECAY_MULTIPLIERS` (tunes memory-search decay weighting).

## Programmatic surface

For tools building on top of the CLI:

```ts
import { runPass1, renderToml } from "@anatomytool/cli";
import type { Pass1Result } from "@anatomytool/cli";
```

`runPass1` is the deterministic generator (manifest + README + walker →
`Pass1Result`); `renderToml` emits a canonical TOML serialization with
normative section ordering preserved.

## Related

- The standard, schema, and conformance fixtures: [project README](../README.md)
  and the normative [`spec/CURRENT.md`](../spec/CURRENT.md).
- Validator library: [`@anatomytool/validate`](https://www.npmjs.com/package/@anatomytool/validate).
- Design + implementation docs: [`docs/superpowers/`](../docs/superpowers/).

## License

MIT
