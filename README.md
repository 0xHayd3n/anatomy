# Anatomy

A specification for in-repo metadata files (`.anatomy`) and an append-only companion (`.anatomy-memory`) that give AI agents a small, machine-readable corpus of per-repo context they can **cite reliably** — repository identity along four pillars (**Stack**, **Form**, **Domain**, **Function**), uncapturable knowledge (rules, flows, decisions), and lived-experience memory (gotchas, decisions, conventions, attempts).

What it actually buys you, [from the 2026-05-09 cross-repo N=3 eval](docs/superpowers/specs/2026-05-09-anatomy-consumer-results-cross-repo-N3.md):

- **Citation reliability.** Across 27 cross-repo treatment trials, agents cited specific `.anatomy` rules / decisions / flows or `.anatomy-memory` entries in 24/27 (89%); baseline was 0/27.
- **Surfacing system-level facts.** Treatment caught the Verbifex TPM-preflight gate (a system-level rule that doesn't grep cleanly) in 2/3 reps; baseline missed it in 3/3.
- **Self-detected staleness.** Every read pins to a git commit; consumers see drift between `.anatomy.generated.commit` and `HEAD` and can react.

What it does **not** buy you, on the same eval: faster lookups. Baseline beat or tied treatment on `tool_calls_to_first_evidence` for 8 of 9 cross-repo cells. The original Anatomy-repo headline of −36% wall-clock did not replicate cross-repo. The honest pitch is "machine-readable docs that agents can cite reliably and that detect their own staleness," not "agents are faster."

## Status

Current versions (see [`spec/CURRENT.md`](spec/CURRENT.md) for the normative index):

- **`.anatomy` file format:** v1.0 (latest — stabilization of the v0.15 format, structurally identical). v0.1, v0.2, v0.4, v0.5, v0.6, v0.7, v0.8, v0.9, v0.10, v0.11, v0.12, v0.13, v0.14, v0.15 also valid; declared via the `anatomy_version` field. v0.3 is an ecosystem (validator + cascading) release whose per-file format is unchanged from v0.2.
- **Ecosystem version:** v0.3 — cascading-aware multi-`.anatomy` repos.
- **`.anatomy-memory` format:** v0.2 (latest). v0.1 still valid; v0.2 adds optional `last_verified_at` and `verified_by` fields for decay tracking.
- **AGENTS.md emission:** v0.10 (latest format) emits a derived `AGENTS.md` alongside `.anatomy` so [AGENTS.md-aware tools](https://agents.md/) (Codex / GitHub Copilot / Cursor) read the same surface anatomy-aware tools get via MCP. Token-budgeted; honors the optional `[generate]` config.
- **Rule verification (v0.12+):** Optional `verify` field on each `[[rules]]` entry declares how to check the rule against source. Two glob-based verifier kinds (no dependency), one AST-based kind via optional `@ast-grep/napi`, and (v0.13+) `kind = "semgrep"` for pattern combinators (`pattern-not`, `pattern-inside`), taint mode, and non-JS-family languages via optional `semgrep` CLI on PATH. Surfaces drift between documented rules and actual code.
- **Packages:** [`@anatomy/spec`](package.json) 1.0.0, [`@anatomy/validate`](anatomy-validate/) 1.0.0, [`@anatomy/cli`](anatomy-cli/) 1.0.0.

## Format

`.anatomy` files are TOML 1.0, UTF-8. Top level is grouped: `[identity]`, `[generated]` (both required), and the optional `[operation]` and `[substance]` groups for AI-grade per-repo context.

`.anatomy-memory` files are TOML 1.0, UTF-8 with a two-line header (`anatomy_memory_version`, `repo_fingerprint`) followed by `[[entries]]` blocks. Append-only by design.

## Documents

The normative reference is [`spec/CURRENT.md`](spec/CURRENT.md), which maps each format version to its normative docs (schema, canonicalization, prompt, versioning policy, recommended stacks).

Design documents (chronological, latest first):

- [v0.7 plan](docs/superpowers/plans/2026-05-07-anatomy-v0.7.md) — restructured insights track.
- [v0.6 plan](docs/superpowers/plans/2026-05-06-dynamic-insights.md) — dynamic insights.
- [memory v0.1 plan](docs/superpowers/plans/2026-05-08-anatomy-memory.md) — lived-experience layer.
- [v0.5 design](docs/specs/2026-05-06-anatomy-v0.5-design.md) — code-profile pillar.
- [v0.4 plan](docs/plans/2026-05-06-anatomy-v0.4-code-profile.md) — code-profile pillar (initial).
- [v0.3 design](docs/specs/2026-05-06-anatomy-v0.3-design.md) — cascading semantics.
- [v0.2 design](docs/specs/2026-05-06-anatomy-v0.2-design.md) — additive supersession of v0.1.
- [v0.1 design](docs/specs/2026-05-05-anatomy-standard-design.md) — original four-pillar standard.

## Conformance fixtures

`fixtures/` contains the conformance test set consumed by validator implementations. Counts:

- **Single-file:** 24 valid, 3 valid-with-warnings, 33 invalid (covering versions 0.1 through 1.0).
- **Cascading (multi-file):** 2 valid, 1 valid-with-warnings, 2 invalid.
- **Canonicalization:** 16 cases (11 valid + 5 invalid) in [`fixtures/canonicalization-cases.json`](fixtures/canonicalization-cases.json) driving ID → canonical-form transformation.

See [`fixtures/README.md`](fixtures/README.md).

## Local development

```bash
npm install
npm run validate
```

Runs the full content-integrity check: every schema is valid JSON Schema; every recommended-stacks file validates against its meta-schema; every `valid/*` fixture parses (TOML) and validates (JSON Schema) and has correct canonical-form hashes; every `invalid/*` fixture fails with the expected errors (or is a documented `schema_can_detect: false` boundary case); `valid-with-warnings/*` fixtures validate cleanly with their expected warning surface; canonicalization cases produce the documented canonical strings and hashes.

## CLI

[`@anatomy/cli`](anatomy-cli/) is the command-line tool for working with `.anatomy` and `.anatomy-memory` files — generate, validate, render, migrate, manage the lived-experience memory log, and serve the data to AI agents via a Claude Code SessionStart hook or an MCP server.

```bash
npm install -g @anatomy/cli
anatomy generate && anatomy validate
```

**Full command reference and usage:** [`anatomy-cli/README.md`](anatomy-cli/README.md) — the single source of truth for the command surface (kept in sync with `anatomy --help`). This section intentionally does not duplicate it.

## License

MIT
