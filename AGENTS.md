# javascript monorepo · repo-metadata · ai-context-format

> **Regenerated from `.anatomy` at commit `9dec2b3` by `anatomy-cli@0.13.0`.**
> DO NOT EDIT — changes will be overwritten on next `anatomy render`.
> Edit `.anatomy` instead, then run `anatomy render`.
> If your HEAD ≠ `9dec2b3`, this file may be stale — re-run `anatomy render`.

TOML + memory format that lets AI agents cite repo-specific rules/decisions and detect their own staleness.

Monorepo for the Anatomy standard: the TOML spec for `.anatomy` repository-metadata files (organized along four pillars — Stack, Form, Domain, Function) plus an append-only `.anatomy-memory` companion for lived experience, the `@anatomy/cli` tool (validate, generate, MCP server), the `@anatomy/validate` library, a Claude Code consumer plugin, and the conformance fixture suite — together giving AI agents a citable per-repo knowledge surface that pins to a git commit so consumers can detect drift. Empirically (2026-05-09 N=3 cross-repo eval, docs/superpowers/specs/2026-05-09-anatomy-consumer-results-cross-repo-N3.md): treatment cites .anatomy rules/memory entries in 89% of trials vs 0% baseline, surfaces system-level facts that don't grep cleanly, and pays a citation-overhead wall-clock cost that's worth it for cross-file synthesis tasks but not for grep-friendly lookups.

## Commands
```sh
# validate
node scripts/validate-spec.mjs
# test
npm run validate
```

## Project structure
- `anatomy-cli/` — @anatomy/cli — validate, generate (Pass 1 deterministic + optional Pass 2 AI fill), show, migrate, rehash, memory, mcp
- `anatomy-validate/` — @anatomy/validate — version-routed JSON-schema validator, fingerprint/hash/path checks, cascading tree discovery
- `anatomy-consumer.plugin/` — Claude Code plugin — .claude-plugin/plugin.json wires SessionStart hook + MCP server; installable via /plugin install
- `spec/` — Normative spec: per-version schema.json + v0.2-frozen canonicalization, versioning policy, recommended-stacks
- `fixtures/` — Conformance test set: valid/invalid/with-warnings .anatomy fixtures + canonicalization-cases.json for validators
- `scripts/` — Spec-package scripts: validate-spec.mjs (content-integrity), canonical.mjs (normative algorithm), fix-fixture-hashes.mjs
- `docs/` — Design docs and superpowers plans/specs — chronological per-version design rationale and implementation plans
- `eval/` — A/B harness measuring whether the anatomy consumer (hook + MCP) helps Claude Code agents — 6 fixed tasks with rubric

## Rules
- Schema additions within a major version must be additive — consumers reading anatomy_version = X must accept later X.Y files without modification
  *Why:* spec/0.2/versioning-policy.md is normative for all v0.x; consumer-side breakage forces simultaneous upgrades
- spawnSync calls to git or external CLIs must pass shell: true on Windows for .cmd shim resolution
  *Why:* memory entry t9ykw3em — npm-installed CLIs don't resolve as plain executables on Windows
- Hand-roll TOML output when section order matters; do not use smol-toml.stringify
  *Why:* smol-toml does not preserve insertion order; section order is normative per spec section 5
- Tests live in {package}/tests/ and are named *.test.ts
  *Why:* established convention across anatomy-cli and anatomy-validate; vitest globs depend on it
- Per-version schema docs live in spec/{ver}/; canonicalization, versioning policy, and recommended-stacks remain at spec/0.2/ until explicitly superseded
  *Why:* spec/CURRENT.md is the normative version index — implementers rely on the freeze
- Do not add fields that an LLM can re-derive from source; reserve schema slots for uncapturable human knowledge
  *Why:* v0.7 dropped [[insights]] for this reason — derivable fields rot fast and bloat AI context
- All validate() checks return { errors, warnings } — never throw
  *Why:* consumers compose checks; throws would break batch validation and cascading

## Flows
- **generate-pipeline** — Pass 1 deterministic (manifest + README + dir walker) → optional Pass 2 (Claude CLI fills domain/function/purposes/rules/flows/decisions) → renderToml → atomic write
- **validate-pipeline** — TOML parse → version-routed schema → fingerprint check (v0.7=fingerprintFromPillars; v0.1-0.6=per-pillar-hash concat) → path checks → cascading discovery (v0.3+) → return errors+warnings
- **mcp-request-pipeline** — resolveAnatomy (find + parse + staleness vs HEAD) → tool handler → wrap in envelope (anatomy_path, staleness, repo_fingerprint, data) → record telemetry to ~/.anatomy/telemetry.jsonl
- **memory-append** — anatomy add <kind> <topic> <content> → generate Crockford-base32 id → infer attribution (claude-session vs human:user) → append [[entries]] block; never rewrite existing entries

## Key decisions
- **v0.7 drops derivable metadata** — Schema additions should capture uncapturable human knowledge (rules/flows/decisions), not metadata an LLM can re-extract from source on every read — the v0.7 lesson when [[insights]] and [[architecture.invariants]] were dropped. Detail: memory entries s4z6f6xz, 1m3714zm.
- **v0.7 flattens identity to plain string pillars** — Per-pillar hashes were a fingerprint-construction implementation detail leaking into the schema. v0.7 uses four plain strings plus a single fingerprint via fingerprintFromPillars (SHA-256 of stack\0form\0domain\0function, base32, first 20 chars). See memory entries kjj9dpxw, 5barj9az.
- **v0.3 is an ecosystem release, not a wire version** — v0.3 added cascading discovery + merge semantics for multi-.anatomy repos but did not change the per-file format. Files in v0.3 cascades declare anatomy_version = '0.2'. There is no '0.3' wire version. See spec/CURRENT.md and spec/0.3/cascading.md.
- **Hand-rolled TOML renderer in anatomy-cli** — smol-toml.stringify does not preserve insertion order, but section order is normative per spec section 5 and load-bearing for human readability. anatomy-cli/src/render/toml.ts emits sections in canonical order with explicit blank-line spacing. Memory entry m0jnp3kq.
- **Removed Pass 1 code-intelligence module** — An earlier Pass 1 had import-graph-hub detection, enum/singleton inference, and similar static analysis. Removed in commit ec73e00 — this was the wrong direction; Claude derives such structure from reading source already, so storing it duplicated context and rotted faster than the code. Memory entry et5gth9k.
- **v0.8 finishes the v0.7 cleanup** — Removed code_profile (already dead surface — Pass 1 generator gone since ec73e00) and substance.capabilities/limitations (derivable from source). Schema now matches the v0.7 principle stated in memory entry et5gth9k and rule 'Do not add fields that an LLM can re-derive from source'. Identity/fingerprint formula unchanged from v0.7.
- **[substance] is for why-annotated dependencies only** — v0.8 narrows [substance] to its key_dependencies sub-section. Capabilities and limitations were either re-derivable on every read or, when they encoded a deliberate choice, belonged in [[decisions]] proper. The phrase_with_source $def was orphaned and dropped at the same time.

## Recent lived experience
- **decision** *(2026-05-09)* — **rust-desktop-libs**: hasCargoDesktopSignal scans for these Rust GUI library names as direct dependencies (root Cargo.toml or any workspace m…
- **decision** *(2026-05-09)* — **pyproject-sidecar-suffixes**: pyproject.toml with [project].name ending in -scripts, -tools, -helpers, -utils, -bindings, or -build is treated as a s…
- **decision** *(2026-05-09)* — **canonical-npm-script-whitelist**: Pass 1 [operation.commands] filters to a fixed canonical-name whitelist (dev, build, test, lint, format, etc.) rather t…
- **milestone** *(2026-05-09)* — **isPrimary refactor**: Replaced ad-hoc tooling-stub polyglot rules with a per-manifest isPrimary contract on DetectedManifest. Dual-usage form…
- **milestone** *(2026-05-09)* — **seventh-sweep-3-categories**: Seventh sweep targeting non-language stack categories. Found 3 worth detecting: Helm (Chart.yaml — Kubernetes deploymen…
- **milestone** *(2026-05-09)* — **sixth-sweep-3-fixes**: Sixth stress sweep on 6 niche public repos found 3 actionable issues — two polyglot misclassifications and one stack ga…

---

*Fingerprint: `jcevybzm4r897e6rhe11` · Schema: `https://anatomy.dev/spec/0.10/schema.json`*
*Machine-readable source: [`.anatomy`](.anatomy) · Memory log: [`.anatomy-memory`](.anatomy-memory)*
