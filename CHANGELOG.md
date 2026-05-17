# Anatomy — Changelog

This file tracks cross-package changes (spec versions, ecosystem changes,
release matrix). Per-package changelogs live alongside their `package.json`:

- [`@anatomy/spec`](CHANGELOG.md) — this file (the spec is the root package)
- [`@anatomy/validate`](anatomy-validate/CHANGELOG.md)
- [`@anatomy/cli`](anatomy-cli/CHANGELOG.md)

---

## [unreleased] — v0.10 AGENTS.md interop

Anatomy now emits `AGENTS.md` alongside `.anatomy`. `anatomy generate` and a
new `anatomy render` command both produce both files; AGENTS.md-aware tools
(Codex / GitHub Copilot / Cursor) get a working front-door view of every
anatomy-equipped repo without anatomy-aware integration. Memory and
commit-pinned staleness surface inside AGENTS.md so non-anatomy tools benefit
from anatomy's distinctives too. The on-ramp for the ~2,500 existing-AGENTS.md
repos: existing AGENTS.md becomes Pass 2 input, and the original is preserved
in `AGENTS.md.bak` on first regeneration. Per-package versions:
`@anatomy/spec` 0.5.0 → 0.6.0; `@anatomy/validate` 0.6.0 → 0.7.0; `@anatomy/cli`
0.12.7 → 0.13.0.

### `@anatomy/spec`

- **New:** v0.10 schema at [`spec/0.10/schema.json`](spec/0.10/schema.json).
  Additive over v0.9: adds optional `[generate]` top-level section
  (`agents_md`, `agents_md_budget`, `agents_md_memory_count`) holding
  per-repo render preferences. All fields optional with defaults — v0.9 files
  validate as v0.10 with no data change.
- **New:** v0.10 prompt at [`spec/0.10/prompt.md`](spec/0.10/prompt.md) — adds
  the optional `EXISTING_AGENTS_MD` input.
- **New:** [`spec/0.10/pass2-prompt-contract.md`](spec/0.10/pass2-prompt-contract.md)
  documents the EXISTING_AGENTS_MD input shape and field-influence rules.
- **Conformance:** 3 new fixtures (2 v0.10-valid: minimal, with-generate;
  1 v0.10-invalid: invalid-generate-budget). 5 AGENTS.md snapshot fixtures
  under `fixtures/agents-md/` (minimal, comprehensive-within-budget,
  over-budget-truncating, with-memory, with-existing-agents-md-merge).

### `@anatomy/validate`

- **New:** v0.10 schema registered; `supportedVersions` includes `"0.10"`.
  The v0.7-introduced `fingerprintFromPillars` branch covers v0.10 (identity
  shape unchanged from v0.7+).

### `@anatomy/cli`

- **New:** `anatomy render` command — cheap regen path that re-emits both
  `.anatomy` and `AGENTS.md` from an existing `.anatomy` without Pass 1 or
  Pass 2. Idempotent: `render(render(x))` is byte-identical. New flags:
  `--no-agents-md`, `--budget`, `--memory-count`, `--check`, `--yes`.
- **New:** AGENTS.md emission by default from `generate` and `render`.
  Comprehensive template (title pillars, regen banner with commit pin,
  tagline, description, commands, structure, rules-with-Why, flows,
  decisions, top-N decay-weighted memory entries, fingerprint footer).
  Token-budgeted graceful degradation: drops memory tail → decision reason
  truncation → flow summary truncation → structure collapse → key-dep
  truncation in priority order. Rules + commands are never dropped; if
  alone they exceed budget, `render` exits 3.
- **New:** `anatomy migrate --to 0.10` — additive version + schema URL bump.
- **New:** `--check` flag for `render` — exits non-zero with a unified diff
  if a fresh render would differ from disk. Intended for CI drift detection.
- **New:** Existing AGENTS.md becomes Pass 2 input when present and not
  anatomy-generated. Truncated to 3000 chars in the prompt; field-influence
  rules per the v0.10 contract.
- **New:** On-ramp write strategy. Three branches: no existing AGENTS.md →
  direct write; existing has regen banner → idempotent overwrite; hand-written
  AGENTS.md → backup to `AGENTS.md.bak`, then TTY prompt with diff or
  non-interactive direct write (with stderr line) under `--yes`.
- **Architectural:** Derive/render split. `commands/generate.ts` no longer
  inlines `renderToml` + `writeFileSync`; both `generate` and the new
  `render` route through `render/index.ts`'s `renderAll` and
  `render/write.ts`'s `writeArtifacts`. New `render/agents-md.ts`,
  `render/budget.ts`, `render/parse-anatomy.ts`, `render/memory-for-agents-md.ts`,
  `render/token-count.ts`, `render/types.ts`. Banner detection
  centralized in `src/banner.ts`; unified-diff helper in `src/diff.ts`.

### Migration

```bash
anatomy migrate --to 0.10
anatomy render
```

`anatomy render` emits AGENTS.md alongside the existing `.anatomy`. If you
have a hand-written AGENTS.md, it is backed up to `AGENTS.md.bak` and
replaced; reconcile any custom content into your `.anatomy` if you want it
preserved across regenerations.

Design doc:
[`docs/superpowers/specs/2026-05-13-anatomy-agents-md-interop-design.md`](docs/superpowers/specs/2026-05-13-anatomy-agents-md-interop-design.md).
Implementation plan:
[`docs/superpowers/plans/2026-05-13-anatomy-agents-md-interop.md`](docs/superpowers/plans/2026-05-13-anatomy-agents-md-interop.md).

## [unreleased prior] — memory v0.2 + form-detection + hook truncation

Cross-package follow-up after the v0.8 release. Three pieces of work landed in
sequence after the deferred items in v0.8 design doc §7 were re-prioritized
based on a 6-repo evidence pass:

### Pillar redesign — deprioritized

[`docs/superpowers/specs/2026-05-08-pillar-redesign-evidence.md`](docs/superpowers/specs/2026-05-08-pillar-redesign-evidence.md)
ran Pass 1 + Pass 2 against five non-self repos (cursorinline, Snipper, Verbifex,
Sentinel, Git-Suite) plus this repo. 5 of 6 produced cleanly-separated
domain × function pairs; only the self-defining Anatomy repo (whose function
*is* its domain) collapsed. Verdict: **stand down on pillar redesign.**
v0.9 design doc updated to "Deprioritized" status. Documented-overlap (Option B)
is the implicit resolved choice.

### Form detection — fixed

The same evidence pass surfaced a real Pass 1 bug: 4 of 5 sampled repos had wrong
form values (Electron apps → `*-library`, Express web app → `*-library`).
[`@anatomy/cli`](anatomy-cli/CHANGELOG.md): new signals for Electron/Tauri
detection (deps, script invocations, build tooling) → `desktop-app`; server
framework deps + `node X.js`-style start scripts → service moderate-signals.

### Hook truncation — fixed

[`@anatomy/cli`](anatomy-cli/CHANGELOG.md): rules-section trimming now drops
whole rule entries from the end rather than char-cutting then stripping the
partial last line. Preserves rule integrity at low token budgets.

### `.anatomy-memory` v0.2 — shipped

[`@anatomy/spec`](CHANGELOG.md): new memory schema at
[`spec/memory/0.2/schema.json`](spec/memory/0.2/schema.json). Adds optional
`last_verified_at` and `verified_by` fields on entries for decay tracking.
v0.1 schema's `$defs.entry.additionalProperties` relaxed from `false` to `true`
in the same release for forward-compat (v0.1 consumers tolerate v0.2 entries).

[`@anatomy/validate`](anatomy-validate/CHANGELOG.md): registers v0.2 in
`supportedMemoryVersions`. Three new checks: `memory-verified-by-malformed`,
`memory-verified-by-too-many`, `memory-last-verified-before-at`.

[`@anatomy/cli`](anatomy-cli/CHANGELOG.md): new `anatomy memory verify <id>`
subcommand bumps a v0.1 file to v0.2 on first verify and records a
verification timestamp + attribution. New `anatomy memory list --only-fresh`
flag and decay-bucket columns in `list` / per-bucket sub-counts in `stats`.
MCP `anatomy_memory_search` ranks entries by token-match × decay-multiplier
(fresh=1.0 / aging=0.85 / untouched=0.7 / stale=0.6 by default), configurable
via `ANATOMY_MEMORY_DECAY_MULTIPLIERS` env var.

Design docs are at [`docs/superpowers/specs/`](docs/superpowers/specs/) for
each piece of work.

## [0.6.0] — 2026-05-08

Anatomy v0.8 release: subtractive principle-conformance pass over v0.7. The schema now matches its own stated principle (memory entry [`et5gth9k`](.anatomy-memory), repo rule "Do not add fields that an LLM can re-derive from source") by removing the three sections that violated it. Per-package versions: `@anatomy/spec` 0.3.2 → 0.4.0; `@anatomy/validate` 0.3.2 → 0.4.0; `@anatomy/cli` 0.9.0 → 0.10.0.

### `@anatomy/spec`

- **New:** v0.8 schema at [`spec/0.8/schema.json`](spec/0.8/schema.json). Subtractive cleanup of v0.7: removes `code_profile`, `substance.capabilities`, `substance.limitations`, and the now-orphan `phrase_with_source` $def. Identity, fingerprint formula, and `[[rules]]`/`[[flows]]`/`[[decisions]]` shape are unchanged from v0.7 — a v0.7 file's identity fingerprint equals its v0.8 migration target's, so paired `.anatomy-memory` files keep their pairing without rehash.
- **New:** v0.8 prompt at [`spec/0.8/prompt.md`](spec/0.8/prompt.md), with capabilities/limitations/code_profile asks removed.
- **Updated:** [`spec/CURRENT.md`](spec/CURRENT.md) — v0.8 added to the version index and bumped to current latest.
- **Conformance:** 5 new fixtures (3 v0.8-valid: minimal, with-substance, full; 2 v0.8-invalid: has-code-profile, has-capabilities). Single-file totals: 22 valid + 1 valid-with-warnings + 30 invalid.

### `@anatomy/validate`

- **New:** v0.8 schema registered; `supportedVersions` includes `"0.8"`. Fingerprint and hash check logic unchanged — the v0.7 `fingerprintFromPillars` branch covers v0.8 (identity shape unchanged); both versions are now in a `FLAT_PILLAR_VERSIONS` set in the version-aware checks.
- **Updated:** `commands-no-test` warning now also fires on v0.8 (`APPLICABLE_VERSIONS = {"0.4", "0.5", "0.6", "0.7", "0.8"}`).

### `@anatomy/cli`

- **New:** `anatomy migrate --to 0.8` (drops `code_profile` silently — was dead surface; warns on `substance.capabilities`/`limitations` listing the dropped phrases as candidates for `[[decisions]]` re-expression).
- **Removed:** `anatomy_code_profile` MCP tool. Tool count drops from 11 to 10. `anatomy_substance` continues to work, returning just `key_dependencies`.
- **Removed:** [`pass1/code-profile.ts`](anatomy-cli/src/pass1/code-profile.ts) (was non-functional in v0.7 since commit `ec73e00` removed its emit path; v0.8 retires the file). Subcommand-name extraction for `interface.subcommands` moved into [`pass1/interface.ts`](anatomy-cli/src/pass1/interface.ts) as `extractCommandNamesFromDir`, the only remaining consumer.
- **Renderer:** [`render/toml.ts`](anatomy-cli/src/render/toml.ts) bumps `anatomy_version` and `SCHEMA_URL` to v0.8 and drops the `[code_profile.*]` emit path.
- **Show:** [`commands/show.ts`](anatomy-cli/src/commands/show.ts) keeps backward-compat rendering of `substance.capabilities`/`limitations` for older v0.7 files; v0.8 files don't have them.
- **Dogfood:** this repo's own `.anatomy` is migrated to v0.8 in this release; two new memory entries (`sa2d77ty`, `cwfyt5ep`) and two new `[[decisions]]` capture the rationale.

---

## [0.5.0] — 2026-05-08

Anatomy v0.7 release + lived-experience memory layer + Claude Code consumer plugin + post-release quality pass. Per-package version trajectory: `@anatomy/cli` 0.3.2 → 0.5.0 → 0.8.0 → 0.9.0 ; `@anatomy/validate` and `@anatomy/spec` remain at 0.3.2 (the `0.3` ecosystem version did not bump; v0.7 is a wire-version addition under the same cascading semantics).

### `@anatomy/spec`

- **New:** v0.7 schema at [`spec/0.7/schema.json`](spec/0.7/schema.json). Identity flattens from nested pillar objects (each with `id`+`hash`) to four plain strings (`stack`/`form`/`domain`/`function`) plus a single `fingerprint`. `[[insights]]` and `[[architecture.invariants]]` are removed and replaced by `[[rules]]` (project-specific guardrails, near-required, max 20), `[[flows]]` (cross-subsystem workflows, max 15), and `[[decisions]]` (architectural rationales, max 15). Fingerprint formula changes from concat of per-pillar 5-char hashes to `Crockford-base32(SHA-256(stack\0form\0domain\0function))[:20]`.
- **New:** `.anatomy-memory` v0.1 format at [`spec/memory/0.1/schema.json`](spec/memory/0.1/schema.json). Append-only TOML log paired with `.anatomy` via `repo_fingerprint`. Entry kinds: `gotcha | decision | convention | attempt | milestone`. Supports `--supersedes` chain, `--refs` (file refs), `--tags`, `helped_by` thanks pattern, and `deprecated_at`/`deprecated_reason` for retraction without rewriting history.
- **New:** [`spec/CURRENT.md`](spec/CURRENT.md) — normative version index pointing each format version (0.1 through 0.7) at its canonical schema/canonicalization/versioning-policy/recommended-stacks docs. Eliminates the "which docs apply to v0.7?" ambiguity.
- **New:** `scripts/canonical.mjs` exports `fingerprintFromPillars`. `scripts/validate-spec.mjs` is v0.7-aware (registers v0.7 in routing; hash check is version-aware — v0.7 uses `fingerprintFromPillars`, v0.1–v0.6 keep per-pillar-hash concat).
- **Conformance:** 10 new fixtures (3 v0.7-valid, 2 v0.7-invalid, 1 memory-with-milestone valid, 1 commands-no-test warning, plus assorted). Single-file totals: 18 valid + 2 valid-with-warnings + 28 invalid.

### `@anatomy/validate`

- **New:** v0.7 schema registered; `supportedVersions` includes `"0.7"`. `fingerprintCheck` and `hashCheck` are version-aware: v0.7 uses `fingerprintFromPillars`; v0.1–v0.6 keep the per-pillar-hash concat formula.
- **New:** Memory validation entry point `validateMemory(text, options)` and a 3-check pipeline:
  - `memory-fingerprint-check` — paired `.anatomy`/`.anatomy-memory` fingerprint integrity.
  - `memory-supersession-check` — detects supersession cycles and dangling `--supersedes` targets.
  - `memory-dangling-ref-check` — warns when entry `refs` point to nonexistent files.
- **New:** `commands-no-test` warning (v0.4+ only) — fires when `[operation.commands]` is declared but has no `test` key. Exact-match semantics (so `test.unit` alone still warns).
- **API:** Re-exports `fingerprintFromPillars` for downstream consumers. (No tree-mode entry point for memory; the cli's `validate` command auto-detects and validates the sibling `.anatomy-memory` of each `.anatomy`.)
- **New ErrorCodes:** `memory-fingerprint-mismatch`, `memory-supersedes-not-found`, `memory-supersedes-cycle`.
- **New WarningCodes:** `commands-no-test`, `memory-dangling-ref`.

### `@anatomy/cli`

The CLI grew from 0.3.2 to 0.9.0 across this release window. Major capability additions:

- **MCP server** (`anatomy mcp`) — stdio JSON-RPC server exposing 11 tools: `anatomy_overview`, `anatomy_structure`, `anatomy_interface`, `anatomy_environment`, `anatomy_substance`, `anatomy_code_profile`, `anatomy_domain_model`, `anatomy_tree`, `anatomy_memory_search` (tokenized; corpus = topic + content + tags), `anatomy_memory_show`, `anatomy_memory_stats`. Uniform `{anatomy_path, staleness, repo_fingerprint, data}` envelope.
- **SessionStart hook** (`anatomy hook`) — emits markdown for Claude Code SessionStart context injection. Default 1,200-token budget (truncates optional sections first; preserves rules); prepends a staleness banner when `generated.commit` doesn't match git HEAD.
- **Memory commands:** `anatomy add <kind> <topic> [content]` (with `--supersedes`/`--refs`/`--tags`); `anatomy memory list/grep/show/stats/deprecate/thanks/credits`. Attribution detector tags entries `claude-session:<model>` or `human:<user>` based on env signals.
- **Show command:** `anatomy show [<path>] [--prose]` for natural-language render. Memory-aware (`--no-memory`, `--memory-only`, `--memory-limit-{gotcha,decision,attempt}=N`).
- **Migrate v0.6 → v0.7:** flattens identity, drops insights/architecture, recomputes fingerprint via `fingerprintFromPillars`.
- **Rehash v0.7-aware:** in-place line-replace of `fingerprint = "..."` instead of `smol-toml.stringify`, preserving byte-identical formatting outside the changed line. New `--update-memory` flag also propagates the new fingerprint to the paired `.anatomy-memory.repo_fingerprint`. Match-count guard refuses to replace when multiple fingerprint-shaped lines are present (defense against entry content with embedded fingerprint-like strings).
- **Validate enhancements:** `--require-fresh` checks `generated.commit` against git HEAD; `--json` structured output; auto-detects sibling `.anatomy-memory` and validates it too.
- **Pass 2 context enrichment:** new builders `buildGitLog`, `buildTestSample`, `buildImportSample` add fresh repo signals to the AI prompt; v0.7 prompt asks for `[[rules]]`/`[[flows]]`/`[[decisions]]`.
- **Telemetry:** append-only JSONL at `~/.anatomy/telemetry.jsonl`; records hook fires + MCP calls + repo_fingerprint + latency. `anatomy telemetry stats`/`clear` helpers. `ANATOMY_TELEMETRY_DISABLE` env var (case-insensitive truthy) suppresses all writes; integration tests use it to avoid polluting the user's log.

### Tooling / repo-wide

- **`anatomy-consumer.plugin/`** — Claude Code plugin. `.claude-plugin/plugin.json` declares the SessionStart hook (`anatomy hook`) and MCP server (`anatomy mcp`); the actual hook + MCP code lives inside `@anatomy/cli`. Installable via `/plugin install anatomy-consumer` once `@anatomy/cli` is on PATH.
- **Eval harness** (`eval/`) — 6-task A/B suite with rubric for measuring whether the consumer helps Claude Code agents. First run results captured at [`docs/superpowers/specs/2026-05-08-anatomy-consumer-results.md`](docs/superpowers/specs/2026-05-08-anatomy-consumer-results.md). Treatment passed all 6 pass criteria across the 4 non-stale tasks (36% faster wall-clock, 57% fewer tool-calls-to-first-evidence).
- **`.mcp.json`** tracked at repo root for project-level consumer bootstrapping.
- **CI:** multi-platform (Ubuntu/macOS/Windows), multi-Node (22, 24).

### Code-intelligence detour, then memory pivot

A short-lived experiment between v0.5 and the memory layer added a Pass 1 code-intelligence module (import-graph hubs, enum/singleton detection) and a `code_profile` block carrying that derived metadata. Removed in commit `ec73e00` after recognizing the fields were re-derivable from source on every read; v0.7's reorientation toward uncapturable knowledge (rules/flows/decisions) and the parallel `.anatomy-memory` work absorbed the use case. Documented in `.anatomy-memory` entry `et5gth9k` for future readers.

---

## [0.4.0] — 2026-05-06 (superseded)

Schema v0.6: dynamic insights. **Superseded by v0.7 (above), which dropped `[[insights]]` and `[[architecture.invariants]]` in favor of `[[rules]]`/`[[flows]]`/`[[decisions]]`.** Block kept for historical fidelity — v0.6 files remain valid against `spec/0.6/schema.json` and the validator still routes them correctly.

### `@anatomy/spec`

- New optional `[[insights]]` array (v0.6). Each entry: `type` (closed enum: architecture, pattern, data-model, protocol, invariant, constraint), `name` (slug ≤ 40 chars), `summary` (single line ≤ 200 chars). Array constraints: `minItems: 3, maxItems: 8` — only applies when field is present, so v0.5 files are valid v0.6 without modification.

### `@anatomy/validate`

- Registers v0.6 schema; `supportedVersions` includes `"0.6"`.

### `@anatomy/cli`

- `--ai` pass now emits `[[insights]]` when the LLM finds 3+ genuinely notable repo-specific observations.
- `renderToml` bumped to emit `anatomy_version = "0.6"`.
- `migrate --to 0.6` supported (no-op field migration; bumps version and schema URL).

---

## [0.3.2] — unreleased

Continuation of the robustness sprint.

### `@anatomy/spec`

- No spec content changes.

### `@anatomy/validate`

- No behavior changes; version aligned with siblings.

### `@anatomy/cli`

- New `--verbose` / `-v` flag with strategic debug output (manifest detection, identity heuristics, tagline source, structure counts, validation gate result, timing).
- JSON.parse reviver strips `__proto__`, `constructor`, `prototype` keys from package.json (defense-in-depth against prototype pollution).
- New adversarial test suite (`tests/security.test.ts`, 9 tests) covering proto-pollution, malformed input, oversize files, NULL bytes, and walker hard-limit.
- Internal: TS-vs-JS dep check now uses `Object.prototype.hasOwnProperty.call` instead of `in` operator.

---

## [0.3.1]

Robustness sprint (no behavior changes, no new features). Targets v0.3.0's
production-readiness gaps documented in the post-v0.3 audit.

### `@anatomy/spec`

- No spec content changes.

### `@anatomy/validate`

- No behavior changes.

### `@anatomy/cli`

- Inline canonical helpers as TypeScript; drop prebuild dependency.
- Wrap manifest parse errors with helpful messages (manifest type + path).
- Strip UTF-8 BOM at all file-read sites.
- Enforce size limits: 1 MB manifests, 1 MB README, 200 KB `.anatomy`.
- Hard-cap structure walker at 1000 top-level entries; emit at most 25.
- Atomic write in `generate` (tmp file + rename).
- New `anatomy explain <code>` command and `error-docs.ts` source.
- New fuzz tests with `fast-check` (canonical idempotence + Pass 1 invariant).

### Tooling

- New CI workflow at `.github/workflows/ci.yml` — multi-platform (Ubuntu / macOS / Windows), multi-Node (22, 24).

---

## [0.3.0] — 2026-05-06

All three packages aligned at version 0.3.0 to mark the v0.3 ecosystem baseline.

### `@anatomy/spec` 0.3.0

- v0.3 cascading semantics published at `spec/0.3/cascading.md`.
- Per-file format unchanged from v0.2 (no `spec/0.3/schema.json`).
- Forward pointers added in `spec/0.1/versioning-policy.md` and `spec/0.2/versioning-policy.md` describing the ecosystem-version concept.
- 5 cascading conformance fixtures under `fixtures/cascading/` (2 valid + 1 valid-with-warnings + 2 invalid).

### `@anatomy/validate` 0.3.0

- Bumped from 0.2.0 to align with the v0.3 baseline.
- New API: `validateTree(repoRoot, options)` for tree-mode validation.
- New API: `findAnatomyForPath`, `discoverAllAnatomies` for cascade discovery.
- New option: `ValidateOptions.anatomyDir` (backward-compatible additive field).
- New ErrorCode: `nested-path-escape`, `anatomy-read-error`.
- New WarningCode: `duplicate-fingerprint-in-tree`.
- `ECOSYSTEM_VERSION = "0.3"` constant exported.

### `@anatomy/cli` 0.3.0

- First release of the CLI package (was 0.1.0; bumped to align).
- Two commands: `validate` (wraps `@anatomy/validate`) and `generate` (deterministic Pass 1).
- Detects npm / cargo / pyproject / go manifests.
- Generates schema-valid `.anatomy` with TODO placeholders for fields needing human/AI input.

---

## [0.2.0] — earlier

`@anatomy/spec` 0.2.0 + `@anatomy/validate` 0.1.0.

### `@anatomy/spec` 0.2.0

- Adds `[structure]`, `[environment]`, `[interface]`, `[domain_model]` sections.
- Adds required `tagline` top-level field; reclassifies `description` to optional.
- Depth additions: `entry_points.description` → `entry_points.purpose` (with alias for back-compat); dotted command keys; structured `phrase_with_source.source = { path, symbol }`.
- Strictly additive over v0.1.

### `@anatomy/validate` 0.1.0

- Schema routing by `anatomy_version`; supports v0.1 and v0.2 files.
- New checks: `structure-path-check`, `interface-form-check`, `entry-point-alias-warn`, `source-path-check`.
- New ErrorCodes: `unsupported-anatomy-version`, `structure-path-not-found`, `interface-form-mismatch`, `source-path-not-found`.
- New WarningCode: `entry-point-description-deprecated`, `source-path-soft-not-found`.

---

## [0.0.1] — initial

`@anatomy/spec` 0.0.1: v0.1 spec content (schema, recommended-stacks, canonicalization rules, prompt template, versioning policy, conformance fixtures).
`@anatomy/validate` 0.0.1: TOML parse + v0.1 schema validation + hash/fingerprint checks + description-too-long warning.
