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

Measured in a cross-repo N=3 eval (2026-05-09):

- **Citation reliability.** Across 27 cross-repo treatment trials, agents
  cited specific `.anatomy` rules / decisions / flows or `.anatomy-memory`
  entries in 24/27 (89%); baseline was 0/27.
- **Surfacing system-level facts.** Treatment caught a system-level rule that
  doesn't grep cleanly (a TPM-preflight gate) in 2/3 reps; baseline missed it
  in 3/3.
- **Self-detected staleness.** Every read pins to a git commit, so consumers
  see drift between `.anatomy.generated.commit` and `HEAD` and can react.

> **Honest scope.** The measured win is *citation reliability* and
> *self-detected staleness* — **not** faster lookups. On the same eval,
> baseline beat or tied treatment on `tool_calls_to_first_evidence` for 8 of
> 9 cross-repo cells, and the original single-repo headline of −36%
> wall-clock did **not** replicate cross-repo. The honest pitch is
> "machine-readable docs that agents cite reliably and that detect their own
> staleness," not "agents are faster."

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
```

A generated `.anatomy` is TOML you are expected to **hand-edit** — Pass 1
fills what it can deterministically and leaves `# TODO` markers for the
human-knowledge fields. The full command reference lives in
[`anatomy-cli/README.md`](anatomy-cli/README.md), kept in sync with
`anatomy --help` and intentionally not duplicated here.

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
