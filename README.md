# Anatomy

> A TOML + memory format that lets AI coding agents cite repo-specific rules and decisions — and detect when that knowledge has gone stale.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A5%2022-brightgreen.svg)](package.json)

AI coding agents have a recurring failure mode: they re-derive the same
project facts every session, miss system-level rules that don't grep cleanly,
and trust documentation that has silently drifted from the code.

**Anatomy** is a small, machine-readable corpus you commit to the repo so
agents stop guessing. It has two files:

- **`.anatomy`** — repository identity along four pillars (**Stack**,
  **Form**, **Domain**, **Function**) plus the *uncapturable* knowledge an
  agent can't infer from source: rules, flows, and decisions.
- **`.anatomy-memory`** — an append-only log of lived experience (gotchas,
  decisions, conventions, attempts) paired to the `.anatomy` by fingerprint.

Every read pins to a git commit, so consumers can tell when the knowledge no
longer matches `HEAD` instead of trusting it blindly.

## Contents

- [What it looks like](#what-it-looks-like)
- [What it buys you](#what-it-buys-you)
- [Install](#install)
- [Quick start](#quick-start)
- [Format](#format)
- [Versions & status](#versions--status)
- [Packages](#packages)
- [Conformance fixtures](#conformance-fixtures)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

## What it looks like

This repository describes *itself* with an `.anatomy` file. A trimmed excerpt:

```toml
anatomy_version = "0.13"
tagline = "TOML + memory format that lets AI agents cite repo-specific rules/decisions and detect their own staleness."

[identity]
stack       = "javascript"
form        = "monorepo"
domain      = "repo-metadata"
function    = "ai-context-format"
fingerprint = "jcevybzm4r897e6rhe11"

[[rules]]
rule = "Hand-roll TOML output when section order matters; do not use smol-toml.stringify"
why  = "smol-toml does not preserve insertion order; section order is normative per spec section 5"

[[decisions]]
topic  = "v0.3 is an ecosystem release, not a wire version"
reason = "v0.3 added cascading discovery + merge semantics for multi-.anatomy repos but did not change the per-file format…"

[generated]
at     = 2026-05-17T04:53:13.000Z
commit = "948fe0b"            # every read pins here; consumers detect drift vs HEAD
by     = "anatomy-cli@0.13.0"
```

An agent reading this can cite the exact rule and decision rather than
re-deriving them — and knows to flag the file if `commit` has fallen behind
`HEAD`.

## What it buys you

Measured across **two independent N=20 runs** on a fixed, commit-pinned slate
(4 repos each of JS/TS, Python, Rust, Go, and C/Ruby/Shell/C++),
`anatomy generate --ai` vs. an `/init`-style Claude agent producing the
equivalent `AGENTS.md`: a 2026-05-17 canonical run and a 2026-05-18 Sonnet
replication. Figures below are the replication run (median, [p25–p75] where
it matters); the canonical run agrees on every large effect.

| | anatomy | `/init`-style |
|---|--:|--:|
| Generation cost | **$0.115** [0.11–0.14] | $0.448 [0.41–0.48] |
| Input tokens | **33k** | 764k |
| Output tokens | **3.2k** | 5.5k |
| Wall clock | **56 s** | 172 s |
| Tool calls | **0** | 32 |
| Artifact size | **1 027 tok** [919–1 134] | 1 964 tok [1 717–2 306] |
| Accuracy | **83%** [83–100] | 67% [63–88] |
| Coverage of README facts | 33% | **38%** |
| Specificity | 54% | **84%** |
| Succeeded | 20 / 20 | 20 / 20 |

**What each metric means** (which direction is better, and the result here):

- **Generation cost** — USD for the single model call (anatomy) or agent
  session (`/init`) that produces the artifact. *Lower better.* anatomy ≈ ¼.
- **Input tokens** — tokens fed to the model to build the artifact, cache
  included; drives cost and context pressure. *Lower better.* anatomy ≈ 23×
  fewer: one bounded prompt over a deterministic digest vs. ingesting the repo.
- **Output tokens** — tokens the model generates. *Lower better at equal
  quality.* anatomy ≈ 40% fewer (3.2k vs 5.5k).
- **Wall clock** — elapsed time to produce the artifact. *Lower better.*
  anatomy ≈ 3× faster — no exploration loop.
- **Tool calls** — file reads/greps the agent runs while exploring. *Fewer
  better* (each is latency + tokens). anatomy 0 (Pass-1 is deterministic);
  `/init` a median 32.
- **Artifact size** — tokens in the produced `AGENTS.md` a consumer reloads
  every session. *Smaller better at equal information* (recurring context
  cost). anatomy ≈ half.
- **Specificity** — share of statements carrying a concrete identifier
  (file / symbol / flag). *Higher = denser.* `/init` wins — free-form prose
  name-drops more.
- **Coverage** — share of the repo's own README facts the artifact restates.
  *Higher = broader.* `/init` wins; anatomy's fixed schema captures fewer
  onboarding facts **by design**.
- **Accuracy** — share of sampled artifact claims a judge verifies true
  against the source. *Higher better.* **Soft metric** (3 claims/cell, one
  LLM judge): read as a direction, not a precise number — see below.
- **Succeeded** — cells that produced a valid artifact with no error.
  *Higher better.* 20 / 20 for both methods, in both runs.

**The honest read, both ways.** anatomy's artifact is **~3.9× cheaper, ~23×
fewer input tokens, ~2× smaller, ~3× faster, and needs zero exploration tool
calls** — and these efficiency effects **replicated across both N=20 runs**.
**Accuracy is the soft, run-sensitive metric:** the methods *tied* (91.7 /
91.7) in the canonical run and anatomy *led* (83 / 67) here, with anatomy ≥
the baseline in **19 / 20 repos** — so the defensible claim is **"at least as
accurate as the exploration baseline, never worse,"** not a fixed margin. The
trade-off is real and also replicated: the `/init`-style agent **covers more
of each repo's own README facts (38% vs 33%) and is far more identifier-dense
(84% vs 54%)** — by design, since anatomy's fixed schema deliberately omits
metadata an agent can re-derive from source. anatomy degrades most on
non-mainstream stacks. The pitch is **"a much cheaper, smaller,
at-least-as-accurate repo digest," not "a more complete one."**

- **Self-detected staleness.** Every read pins to a git commit, so consumers
  see drift between `.anatomy.generated.commit` and `HEAD` and can react —
  a structural property of the format, independent of the comparison above.

> A separate, smaller **N=3 consumer eval** measured *citation reliability*:
> agents cited specific `.anatomy`/memory entries in 24/27 treatment trials
> vs 0/27 baseline. It measures task-time **citation behaviour** — a
> different axis from the generation-cost comparison above, complementary to
> it, not part of it.

## Install

```bash
npm install -g @anatomytool/cli      # provides `anatomy` (and `anatomy-cli`)
# or, without installing:
npx @anatomytool/cli --help
```

Requires **Node.js ≥ 22**.

To work on the spec and conformance fixtures, or build the CLI from source:

```bash
git clone https://github.com/0xHayd3n/anatomy
cd anatomy
npm install
npm run validate   # full content-integrity check (see below)
```

## Quick start

```bash
anatomy generate          # Pass 1: starter .anatomy from manifest + README + dirs; also writes AGENTS.md
anatomy generate --ai     # Pass 2: enrich the human-knowledge fields via an AI provider
anatomy validate          # validate .anatomy (and a sibling .anatomy-memory if present)
anatomy mcp               # serve it to agents over MCP  (or: anatomy hook)
anatomy mcp --with-fff    # additionally proxy fff's fast file-search tools (see below)
anatomy mcp --with-ast-grep   # additionally expose ast_grep_search (structural code search)
```

A generated `.anatomy` is TOML you are expected to **hand-edit** — Pass 1
fills what it can deterministically and leaves `# TODO` markers for the
human-knowledge fields. The full command reference lives in
[`anatomy-cli/README.md`](anatomy-cli/README.md), kept in sync with
`anatomy --help` and intentionally not duplicated here.

### Pairing with fff for fast in-session search

`anatomy mcp --with-fff` spawns [`fff-mcp`](https://github.com/dmtrKovalenko/fff)
as a child stdio subprocess and proxies every tool it advertises (currently
`find_files`, `grep`, `multi_grep`) inside anatomy's MCP namespace. The agent
sees both layers — anatomy's curated rules/decisions/memory **and** fff's
resident in-memory file index — from one MCP endpoint, no double-wiring.

```bash
# 1. Install fff. Pre-built binaries are on the project's GitHub releases:
#    https://github.com/dmtrKovalenko/fff/releases
#    Download the fff-mcp-<platform> binary and put it on your PATH as `fff`
#    (or point ANATOMY_FFF_BIN at its full path).
# 2. Then start the anatomy MCP server with the bridge enabled:
anatomy mcp --with-fff
```

| Env | Purpose | Default |
|---|---|---|
| `ANATOMY_FFF_BIN` | Override the path to the `fff-mcp` binary. | resolve via `PATH` |
| `ANATOMY_FFF_ARGS` | Space-split argv passed to the binary at spawn. | (none — `fff-mcp` takes no subcommand) |
| `ANATOMY_FFF_TIMEOUT_MS` | Per-`tools/call` timeout in milliseconds. | `5000` |

Without `--with-fff`, the behaviour of `anatomy mcp` is byte-identical to
earlier versions — no fff discovery runs, no extra imports are loaded. The
bridge is **opt-in only**.

**Why pair them?** anatomy answers "what should I know about this repo?"
(curated rules, decisions, lived memory). fff answers "where is X?"
(sub-millisecond file/content search via a resident index). On a 20-query
agent session, fff is roughly an order of magnitude faster than cold
ripgrep (the latency floor for grep-style search tools); anatomy's bridge
adds ≤1 ms per call on top, so the combined endpoint matches direct-fff
performance within noise. A bench harness lives at
[`anatomy-cli/bench-fff-vs-grep.mjs`](anatomy-cli/bench-fff-vs-grep.mjs) —
run it locally with `ANATOMY_FFF_BIN` set to verify on your own repo.

**Failure semantics:** if `fff` isn't on PATH (or `ANATOMY_FFF_BIN` points
at nothing), `anatomy mcp --with-fff` hard-fails on startup with an
actionable error. A mid-session fff crash triggers one transparent
respawn; a second crash marks fff tools unavailable for the rest of the
session while anatomy's own tools keep serving. Per-call timeouts are
configurable via `ANATOMY_FFF_TIMEOUT_MS`. Telemetry events
(`fff_bridge_lifecycle`, `fff_call`) land in `~/.anatomy/telemetry.jsonl`
alongside the existing `mcp_call` stream.

### Pairing with ast-grep for structural code search

`anatomy mcp --with-ast-grep` adds a single read-only `ast_grep_search` tool
to anatomy's MCP namespace, backed by the `@ast-grep/napi` optional
dependency (already declared in `anatomy-cli`'s `package.json`). Unlike
`--with-fff`, there is **no subprocess and no bridge** — the napi module
loads in the same Node process as anatomy's MCP server. The tool answers
the verb that fff and ripgrep cannot: *find by AST shape*, not text.

```bash
anatomy mcp --with-ast-grep
# composes with --with-fff:
anatomy mcp --with-fff --with-ast-grep
```

| Env | Purpose | Default |
|---|---|---|
| `ANATOMY_AST_GREP_MAX_FILES` | Cap on files the walk reads per call. | `5000` |

The default-exclude list (`node_modules`, `dist`, `build`, `target`,
`.git`, and similar non-source dirs) is hardcoded — without it the tool
would be unusable on any real repo. Pass an explicit `file_path` glob to
scope a search further. Without `--with-ast-grep`, the behaviour of
`anatomy mcp` is byte-identical to v1.1.0 — no napi probe runs.

**Why pair it?** anatomy answers *"what should I know about this repo?"*
(curated rules, decisions, lived memory). fff answers *"where is X
textually?"*. ast-grep answers *"where is X **structurally**?"* — the
agent can search for *"every `CallExpression` whose callee is `spawnSync`
and whose options object lacks `shell: true`"*, a query the other two
cannot.

**Failure semantics.** If `@ast-grep/napi` failed to install (the
optionalDep can fail on exotic platforms), `anatomy mcp --with-ast-grep`
hard-fails at startup with an actionable error. There's no subprocess
crash recovery to worry about — the tool either loaded or it didn't.

## Format

`.anatomy` files are **TOML 1.0, UTF-8**. The top level is grouped:
`[identity]` and `[generated]` are required; `[operation]` and `[substance]`
are optional groups for AI-grade per-repo context.

`.anatomy-memory` files are also TOML 1.0, UTF-8, with a two-line header
(`anatomy_memory_version`, `repo_fingerprint`) followed by `[[entries]]`
blocks. **Append-only by design** — entries are superseded, never rewritten.

`npm run validate` runs the full content-integrity check: every schema is
valid JSON Schema; every recommended-stacks file validates against its
meta-schema; every `valid/*` fixture parses and validates with correct
canonical-form hashes; every `invalid/*` fixture fails with the expected
errors (or is a documented `schema_can_detect: false` boundary case);
`valid-with-warnings/*` fixtures validate cleanly with their expected warning
surface; and canonicalization cases produce the documented strings and hashes.

## Versions & status

The normative version index is [`spec/CURRENT.md`](spec/CURRENT.md). Current state:

| Surface | Latest | Notes |
|---|---|---|
| `.anatomy` file format | **v1.0** | Stabilization of v0.15 — structurally identical; the 0→1 bump is a stability commitment, not a breaking change. v0.1–v0.15 remain valid, declared via `anatomy_version`. |
| Ecosystem | **v0.3** | Cascading-aware multi-`.anatomy` repos. An ecosystem (validator + cascading) release — the per-file wire format is unchanged from v0.2. |
| `.anatomy-memory` | **v0.2** | v0.1 still valid; v0.2 adds optional `last_verified_at` / `verified_by` for decay tracking. |
| AGENTS.md emission | **v0.10** | Emits a derived [`AGENTS.md`](https://agents.md/) (read by Codex / Copilot / Cursor) alongside `.anatomy`. Token-budgeted; honors the optional `[generate]` config. |
| Rule verification | **v0.12+** | Optional `verify` on each `[[rules]]` entry checks the rule against source. Two glob-based kinds (no dependency), one AST kind via optional `@ast-grep/napi`, and (v0.13+) `kind = "semgrep"` for pattern combinators and non-JS languages via an optional `semgrep` CLI. Surfaces drift between documented rules and actual code. |

## Packages

| Package | Version | What it is |
|---|---|---|
| [`@anatomytool/spec`](https://www.npmjs.com/package/@anatomytool/spec) | 1.0.0 | The standard — schema, recommended-stacks reference, canonicalization rules, conformance fixtures. (This repo root.) |
| [`@anatomytool/validate`](https://www.npmjs.com/package/@anatomytool/validate) | 1.0.0 | Version-routed JSON-schema validator; fingerprint / hash / path checks; cascading tree discovery. |
| [`@anatomytool/cli`](https://www.npmjs.com/package/@anatomytool/cli) | 1.0.0 | The `anatomy` command — generate, validate, render, migrate, manage the memory log, and serve agents via a Claude Code SessionStart hook or an MCP server. |

## Conformance fixtures

[`fixtures/`](fixtures/README.md) is the conformance test set consumed by
validator implementations:

- **Single-file:** 34 valid, 3 valid-with-warnings, 43 invalid (covering
  versions 0.1 through 1.0).
- **Cascading (multi-file):** 2 valid, 1 valid-with-warnings, 2 invalid.
- **Canonicalization:** 16 cases (11 valid + 5 invalid) in
  [`fixtures/canonicalization-cases.json`](fixtures/canonicalization-cases.json),
  driving the ID → canonical-form transformation.

## Documentation

- **Normative reference:** [`spec/CURRENT.md`](spec/CURRENT.md) — maps each
  format version to its schema, canonicalization, prompt, versioning policy,
  and recommended-stacks docs.
- **CLI reference:** [`anatomy-cli/README.md`](anatomy-cli/README.md).

## Contributing

Issues and pull requests welcome. Before opening a PR, run `npm run validate`
from the repo root — it is the same content-integrity gate CI enforces, and a
green run is required to merge. Commits follow the
[Conventional Commits](https://www.conventionalcommits.org/) style used
throughout the history.

## License

[MIT](LICENSE)
