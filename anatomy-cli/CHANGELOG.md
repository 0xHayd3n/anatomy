# `@anatomy/cli` — Changelog

See the cross-package [root CHANGELOG](../CHANGELOG.md) for ecosystem-level events.

## [1.0.1] — 2026-05-23

### Fixed

- **Pass 2 `claude-cli` provider timeout on medium-large monorepos.** The
  hardcoded 120s `spawnSync` ceiling tipped over under any IO contention on
  monorepo-scale prompts (live repro: `mui/material-ui` pass-2 call ~90s,
  full run ~200s) and the retry conflated pre-launch Windows shim
  `ETIMEDOUT` (where retry recovers) with post-launch wall-clock `SIGTERM`
  (where retry burns another 120s on the same prompt against the same
  model and still misleads the caller with `"claude CLI not found or
  failed to start"`).

  Changes:
  - Default raised 120s → 300s. Covers material-ui-class monorepos with
    headroom; still bounds runaway.
  - New env override `ANATOMY_CLAUDE_CLI_TIMEOUT_MS` (mirrors the pattern
    in `ANATOMY_PER_RULE_TIMEOUT_MS` / `ANATOMY_DRY_RUN_TIMEOUT_MS`).
    Strict `/^\d+$/` digit-only parse with `n > 0` guard (rejects `"0"`
    which `spawnSync` would otherwise treat as an immediate kill).
  - Retry policy split: only `ETIMEDOUT` (shim contention) retries.
    `SIGTERM` (wall-clock) fails fast with a distinct error message that
    names the env var and the current timeout value.

  Commits: `2bb8762`, `5f0e29d`.

## [0.13.0] — unreleased

AGENTS.md interop release + the verifier-suggestion + per-rule-staleness
pair. Cross-package summary in the root
[CHANGELOG](../CHANGELOG.md#unreleased--v010-agentsmd-interop).

### New: `anatomy verify suggest`

Interactive CLI command that proposes a `verify` clause for each
`[[rules]]` entry that lacks one. Three sources in fixed order with a
dry-run gate per candidate:

1. **Test mining** — walks the repo's test files with ast-grep, extracts
   identifiers tests assert are thrown, matches against `ALL_CAPS` tokens
   in the rule text. Optional dep: `@ast-grep/napi`.
2. **Semgrep-rules registry** — clones github.com/returntocorp/semgrep-rules
   to `~/.anatomy/semgrep-rules/` on first use, embeds rule metadata via
   `Xenova/all-MiniLM-L6-v2`, cosine-matches per anatomy rule. Optional
   dep: `@xenova/transformers`.
3. **LLM fallback** — reuses the Pass 2 provider (default `claude-cli`).
   Custom prompt asks for a single TOML inline-table verify clause OR the
   literal `NO_VERIFIER_FEASIBLE`.

Per-rule `[a]ccept / [r]eject / [e]dit / [s]kip / [q]uit`. Edit opens
`$EDITOR` and re-dry-runs the result before accepting. Accepted clauses
are surgically inserted into `.anatomy` in place (preserves section
order, comments, line endings). Semgrep registry rules also copy the
matched yaml into `.semgrep/<hash>-<basename>` inside the user's repo.

Requires a TTY. Telemetry: one `verify_suggest_session` record per run
(aggregate stats only — no per-rule granularity).

### New: per-rule staleness on the MCP envelope

`resolveAnatomy` now re-runs each rule's `verify` clause against HEAD
when staleness is non-cosmetic, and attaches a `rules: RuleStaleness[]`
array to the staleness object on every successful MCP envelope. Each
entry: `{ index, status: "passing" | "failing" | "unverified" | "error",
hits?: [{file, line}], error?: string }`. The `verify-pattern-found-where-forbidden`
warning's hits parse into structured `{file, line}` pairs (capped at 10
per rule).

Zero overhead in the fresh case (`staleness == null`) and in the
cosmetic case (`rules: []`). 5-second whole-run timeout, in-process LRU
memo keyed by HEAD short-sha (cap 8).

### Other changes

### Breaking changes

- `resolveAnatomy()` from `@anatomy/cli` is now async (returns `Promise<ResolvedAnatomy | ErrorResult>`). Internally cascades from the v0.12 async `validate()` API.

- **New:** `anatomy render` command — cheap regen of `.anatomy` + `AGENTS.md`
  without Pass 1 or Pass 2. Idempotent. Flags: `--no-agents-md`, `--budget`,
  `--memory-count`, `--check`, `--yes`.
- **New:** AGENTS.md emission by default. Comprehensive template with token
  budget + priority drop logic.
- **New:** `--check` mode for CI drift detection (exit 4 + unified diff on drift).
- **New:** `--yes` / `-y` flag for non-interactive overwrite of hand-written
  AGENTS.md (defaults to true on non-TTY).
- **New:** Existing AGENTS.md becomes Pass 2 input; hand-written content is
  preserved in `AGENTS.md.bak` on first regeneration.
- **New:** `anatomy migrate --to 0.10` (additive version + schema URL bump).
- **Architectural:** `commands/generate.ts` and the new `commands/render.ts`
  both route through a unified `renderAll` + `writeArtifacts` boundary.

## [0.12.7] — 2026-05-10

### Pass 1 ref-style badge + cargo implicit + erlang/OTP (14th sweep)

Surfaced by `anatomy generate` against 15 more popular GitHub repos (round-7: oz-contracts, foundry, otp, valkey, tree-sitter, black, scrapy, etcd, storybook, gatsby, deno-std, rustlings, expo, undici, mongo-c-driver). Round-7 broadened stack diversity (first Solidity, Erlang, Crystal coverage); three actionable issues:

- **Reference-style badge form `[![alt][ref]](url)`** — tree-sitter's README uses markdown reference-style images inside badges. The 9th-sweep badge rule required `(badgeUrl)` for the inner image; this form uses `[ref]` (resolved via a `[ref]: url` def stripped earlier). New sibling pre-pass rule.
- **Cargo workspace with `exclude` only + implicit src/main.rs** — rustlings has `[workspace] exclude = [...]` (no `members`) plus `[package]`. Pre-fix the workspace branch fired and returned null because `members` wasn't an array, bubbling up as `todo-form`. Three-part fix: (a) workspace branch only fires when `members` is declared as an array; (b) workspaces with declared-but-uninformative members fall back to filesystem-implicit form before returning null; (c) workspaces with no `members` declared use implicit form directly. Cargo treats `src/main.rs` as an implicit binary and `src/lib.rs` as an implicit library.
- **Erlang detector + `otp_build` + loose-`.erl` signals** — erlang/otp uses traditional Erlang build (configure + Makefile + otp_build) with apps nested under `lib/<app>/src/`. Detector now also checks for `otp_build` script presence and ≥2 loose `.erl` files at root or in `src/` (mirrors the Python detector's loose-py fallback).

### Sweep arc

Issue counts per round across sweeps 8-14: 6 → 5 → 5 → 5 → 4 → 2 → 3. Round-7's slight uptick driven by new stack diversity (Solidity, Erlang) testing previously-uncovered code paths. ~245 LOC across `tagline.ts`, `identity.ts`, `manifest/erlang.ts`.

## [0.12.6] — 2026-05-10

### Pass 1 code fences + blockquote distinction (13th sweep)

Surfaced by `anatomy generate` against 12 more popular GitHub repos (fastapi, pydantic, vite, astro, clap, tonic, winget-cli, gleam, crystal, wasmer, discord.js, postgrest). Two issues — both in the precision-failure subcategories the 12th sweep articulated:

- **Fenced code blocks stripped from pre-pass** — astro's README opens with `\`\`\`bash` install instructions; the line filter was picking the fence opener as tagline. New pre-pass rule strips whole fenced code blocks (``` ... ```), pairing conceptually with the existing RST title-block strip. Order matters: must run before the standalone-decorator rule, which would otherwise consume bare ``` close fences as decorator chars.
- **Markdown blockquote-as-tagline distinguished from HTML fragments** — clap uses `> **Command Line Argument Parser for Rust**` as a stylized tagline. The 9th-sweep `>`-startsWith rule was added to skip multi-line HTML close-tag fragments (axios round-1 shape) and over-broadly caught blockquotes. Tightened to `line === ">"` (exact match — the HTML fragment is always bare); added a leading `> ` strip in post-pick so blockquote-with-content reads cleanly. Second over-strip failure across 5 sweeps of pre-pass work; same subcategory A.1 as the 12th sweep's auto-link fix.

### Sweep arc

Issue counts per round across sweeps 8-13: 6 → 5 → 5 → 5 → 4 → 2. Decreasing toward stress-test saturation. Total fixes landed: 21 surgical fixes, ~215 LOC across `tagline.ts` and `identity.ts`.

## [0.12.5] — 2026-05-10

### Pass 1 auto-links + bullets + link-rows + GUI-libs (12th sweep)

Surfaced by `anatomy generate` against 12 more popular GitHub repos (alacritty, helix, rubocop, laravel, junit5, phoenix, streamlit, ant-design, opentofu, mocha, fish-shell, vuetify). Four issues across three categories from the 11th-sweep root-cause framework, with one new precision-failure subcategory:

- **HTML rule no longer over-strips RFC auto-links** — `<https://example.com>` was being matched by the pre-pass HTML self-closing rule (because `<h` opens, `ttps` matches `[\w-]*`, `://...>` consumes the rest). Both HTML rules (multi-line block + self-closing) now use a `(?=[\s/>])` lookahead requiring a tag-valid char after the tag name; URLs have `:` next, which fails the lookahead. Fixes phoenix's broken tagline `"See the official site at ."`.
- **Pipe-separated markdown-link nav rows** — opentofu's `[Homepage](url) | [Slack](url) | [Get Started](url)` slipped past the 11th-sweep separator-list rule (token cap of 30 chars excluded link-as-token). New pre-pass rule for "line of 2+ pipe-separated markdown links" removes the entire row before line-pick.
- **Markdown bullet lines** — ant-design and mocha had bullets (`- 🌈 Enterprise UI...`, `- Documentation`) picked as taglines. Line filter now skips lines starting with `- ` or `* ` (followed by a space — avoids matching emphasis like `*italic*`).
- **`RUST_DESKTOP_LIBS` extended** with `winit`, `glutin`, `gtk`, `gtk4`, `gtk4-rs`, `relm4`, `vizia`. winit is the universal low-level Rust windowing primitive (alacritty uses it directly); the GTK family covers GTK4-based desktop apps. `wgpu` was deliberately excluded — it has non-GUI uses (compute, headless rendering).
- **First over-strip failure across 4 sweeps** — issue L (auto-link false-positive) is the first time the pre-pass eats valid content rather than missing decoration. Prior sweeps were all under-strip (filter blind to a pattern). Documented as new subcategory A.1 in the spec for future-sweep awareness.

## [0.12.4] — 2026-05-10

### Pass 1 emphasis + separators + workspace identity (11th sweep)

Surfaced by `anatomy generate` against 12 more popular GitHub repos (pandas, requests, sphinx, tokio, cargo, eslint, async, lerna, commander, zed, typst, helmfile). Five issues across three distinct root-cause categories:

- **Markdown emphasis strip** — `**bold**`, `__bold__`, `*italic*`, `_italic_`, `~~strike~~` now stripped from picked taglines (post-pick rewrite). Fixes pandas, requests, sphinx, tokio outputs that carried raw markup.
- **Separator-list lines** — pre-pass rule for "Token | Token | Token" with multiple short pipe-separated tokens. Each token capped at 30 chars to avoid matching prose. Fixes helmfile (`English | 简体中文` language switcher).
- **Introducer lines** — `firstNonBlankNonHeadingLine` now skips lines ending with `:` (header/introducer indicator). Fixes lerna ("A few links to help you get started:" was picked as tagline).
- **Cargo workspace name-match preference** — `cargoWorkspaceFormSuffix` now does two passes: first prefers the member whose `package.name` matches the repo dir basename (canonically the "main" crate), using ITS nature directly; falls back to the original walker only when no match. Fixes tokio (workspace has `tokio` library + auxiliary crates with `[[bin]]` examples — was misclassified as `cli-tool`).
- **Rust desktop-app detection** — new `hasCargoDesktopSignal` scans root Cargo.toml deps + workspace member deps for canonical Rust GUI libraries (gpui, eframe, egui, iced, slint, dioxus, druid, tauri, tauri-bundler, fltk, cushy). Mirrors the existing `hasNpmDesktopSignal`. When found, cargo form returns `desktop-app` at highest precedence. Fixes zed (uses `gpui` — was misclassified as `cli-tool`).

## [0.12.3] — 2026-05-10

### Pass 1 RST + reference-style links (10th sweep)

Surfaced by `anatomy generate` against 12 more popular GitHub repos (angular, mui, nextjs, prettier, playwright, ruff, uv, hugo, django, scikit-learn, prisma, bun). Three more tagline edge cases — all in the same root-cause family as the 9th sweep (README format extensions the line filter doesn't recognize):

- **RST title blocks** (django shape: `======\nDjango\n======`) are now stripped as a 3-line unit — neither the decorator nor the bare title text leaks into the tagline.
- **RST directive blocks** (scikit-learn shape: `.. -*- mode: rst -*-` and `.. |Foo| image:: url\n   :target: link\n   :alt: text`) are stripped including indented continuation lines.
- **Standalone decorator lines** (`======`, `------`, `~~~~~~`, etc., plus markdown `---` horizontal rules) are stripped — covers RST underline-only titles and never-a-tagline markdown rules.
- **Reference-style inline links** (`[text][ref]` and `[text][]` — hugo shape) are now stripped from picked taglines in addition to the existing `[text](url)` form. Reference DEFINITIONS (`[label]: url`) were already stripped by the 9th-sweep pre-pass; the inline references in prose were not.

## [0.12.2] — 2026-05-09

### Pass 1 README structural pre-pass (9th sweep)

Surfaced by `anatomy generate` against 12 more popular GitHub repos (bevy, TypeScript, flask, lodash, prometheus, rails, redis, fastify, vuejs/core, nestjs/nest, numpy, electron). The 8th-sweep tagline filter still bled garbage from multi-line README constructs that a line-local filter can't see. Five distinct failures (lodash table, prometheus mid-line `</p>`, fastify `/>` fragment, nestjs ref-link def, numpy line-wrapped image URL) all share one root cause; one structural fix collapses them.

- **`stripReadmeDecorations` pre-pass** runs over the whole README text before `firstNonBlankNonHeadingLine`. Removes HTML comments, multi-line HTML blocks, self-closing/void HTML tags, badge-as-link forms (`[![...](...)](url)`, including multi-line URL), bare markdown images (including line-wrapped URLs), reference-link definitions (`[label]: url`), and markdown table rows (any line ending with `|` — catches both standard `| Col | Col |` form and lodash-style trailing-pipe separators). Existing line-local regexes (`MARKDOWN_BADGE_LINE`, `HTML_ATTR_LINE`, `<`/`>` startsWith) stay as defense-in-depth.
- **Trade-off note (table rule):** the spec originally proposed `^\s*\|.*\|.*$` (≥2 pipes, line starts with `|`). Implementation changed to `^[^\n]*\|\s*$` (any line ending with `|`) because lodash uses pipe SEPARATORS without leading pipes (`[Site](url) |`), which the original regex missed. The new form is strictly more aggressive — a prose line like `"Combine columns using |"` would be stripped. Acceptable risk for README header areas (rare in practice); the existing fallback chain (manifest description → `todo-tagline`) covers any false positive.

## [0.12.1] — 2026-05-09

### Pass 1 stress-test fixes (8th sweep)

Surfaced by `anatomy generate` against 10 popular GitHub repos (react, ohmyzsh, bootstrap, axios, deno, tailwindcss, svelte, express, gin, llama.cpp). All five fixes are unified by the demote-to-placeholder philosophy already established by the `isPrimary` refactor: when Pass 1 can't make a confident call, prefer `todo-*` over wrong-but-valid output. No schema change.

- **Commands whitelist** — `[operation.commands]` now filters to ~21 canonical npm-script names (`dev`, `build`, `test`, `lint`, etc.) plus their dotted variants (`test.unit`). Drops bespoke names like `build-for-flight-prod`. Drops surviving values >200 chars. Fixes generator self-validation failure on react/bootstrap-style monorepos (36-50 scripts each).
- **Tagline filter** — skips markdown badge lines (`[![Badge](url)](url)`), bare image lines (`![alt](url)`), HTML attribute-continuation lines (`href="..."` inside a multi-line `<a>` tag), and stray `>` lines that close such tags. Strips inline `[text](url)` markdown from picked taglines. Fixes garbage taglines on most popular OSS READMEs (express, deno, svelte, gin, llama.cpp, axios, ohmyzsh).
- **Sidecar pyproject demotion** — `pyproject.toml` with `[project].name` ending in `-scripts` / `-tools` / `-helpers` / `-utils` / `-bindings` / `-build` is marked `isPrimary=false`. Lets cpp/cargo/etc. win as the surviving real primary. Fixes llama.cpp (was misdetected as `python-cli-tool` due to its `llama-cpp-scripts` helper pyproject).
- **Cargo workspace form walk** — when root `Cargo.toml` is workspace-only, walks members for `[[bin]]` / `[lib]` declarations. `[[bin]]` in any member → `cli-tool`; only `[lib]` → `library`; neither → `todo-form` (via new `null` return + caller branch). Fixes deno (was `rust-library`; now `rust-cli-tool`).
- **Drop bare `scripts.start` from npm service signals** — too generic; almost every npm package has one. Real services still identified by server-framework dep + node-server-shape start script. Fixes axios (was misdetected as `typescript-service`).
- **Description smart-truncate** — manifest/README descriptions are smart-truncated at 500 chars (schema cap) instead of accepted up to 2000 then triggering `description-too-long` at validate time. Fixes gin (1107-char description).

## [unreleased] — post-0.11.0

- **Behavior change (CLI):** `anatomy validate` is now **strict by default**. Source-cross-check warnings (`unused-dependency-claim`, `literal-not-in-source`, `source-cross-check-truncated`) are elevated to errors and cause exit 1. The previous default (warnings stay as warnings, exit 0) is now `--no-strict`. The old `--strict` flag is accepted as a silent no-op for backward compatibility — existing CI that opted-in to strict still works unchanged. Motivated by the cross-repo eval finding (citations are the empirical value-add; drift in cited material is a real failure mode that needs to fail loudly).
- **Bug fix (source-cross-check Class 1):** `package.json`'s `dependencies` / `devDependencies` / `peerDependencies` / `optionalDependencies` / `bundleDependencies` sections are now stripped from the haystack before matching. Previously, any dep declared in `package.json` looked "used" because its quoted name in the manifest matched `findQuotedReference` — meaning Class 1 could not fire on the very case that motivated it (Snipper's `@codemirror/*` orphan-dep bug). Verified against the eval pre-refinement files: Snipper now correctly flags all 5 unused `@codemirror/*` deps. Three usage-detection extensions complement the strip:
  - **Scripts bare-token check:** dep name is detected as used when it appears as a whitespace-or-operator-bounded command in any `package.json` `scripts` value (e.g. `"format": "prettier --write ."`, `"build": "npx esbuild ..."`, `"ci": "lint && vitest run"`).
  - **Scope-name conventional bin form:** `@scope/name` deps also match the `scope-name` token form when invoked in scripts (e.g. `@electron/rebuild` → bin `electron-rebuild`). Catches the Snipper post-refinement FP that the strip introduced.
  - **Subpath imports:** `findQuotedReference` now matches `'pkg/sub/path'` and `"pkg/sub/path"` in addition to bare-quoted forms. Catches CSS / dist / submodule imports like `import '@fontsource/inter/400.css'` that previously false-positived as unused. The right-side boundary is still strict on `-` and `.` (so `react` does not match `react-dom`/`react.foo`).
  - **Top-level source files in scan:** the scan root's top-level files matching common source extensions (`.ts`/`.js`/`.mjs`/`.cjs`/`.tsx`/`.jsx`/`.py`/`.go`/`.rs`/`.java`/`.kt`/`.swift`/`.c`/`.cpp`/`.h`/`.hpp`/`.rb`/`.php`) are now included. Catches small repos that put `server.js` / `database.js` / `main.py` at the root (Verbifex pattern) where the structure entries don't list them.
- **Updated:** `error-docs.ts` `unused-dependency-claim` entry rewritten to document the new mechanics (declaration-vs-usage, scripts-bare-token detection, scope-name heuristic, allowlist scope). All three cross-check entries' "to gate CI on this warning, run `--strict`" footnotes updated to reflect strict-by-default.
- **Field findings appendix** added to [`docs/superpowers/specs/2026-05-09-pass2-source-cross-check-design.md`](../docs/superpowers/specs/2026-05-09-pass2-source-cross-check-design.md) capturing the dogfood pass against the 8 eval-shipped `.anatomy` files and the 4 fixes it surfaced.

## [unreleased] — post-0.10.0

- **New (Pass 2 portability — Phase 3):** Third-party Pass 2 providers can now register via `.anatomy-cli.toml` config or `ANATOMY_PASS2_PROVIDERS` env var.
  - **Config:** at the repo root, `.anatomy-cli.toml` `[pass2]` section accepts `providers = ["anatomy-pass2-vendor", "@org/my-provider"]` (an ordered list of npm package specifiers to dynamic-import) and `default = "<name>"` (overrides auto-detect when `--provider` and `ANATOMY_PASS2_PROVIDER` are unset).
  - **Env var:** `ANATOMY_PASS2_PROVIDERS=pkg1,pkg2` is comma-separated and wins over the config file when both are present (useful for CI / one-off testing).
  - **Loader:** [`pass2/providers/loader.ts`](src/pass2/providers/loader.ts) imports each spec via dynamic `import()`, validates the default export matches the `Pass2Provider` shape (`name`, `description`, `available()`, `generate()`), and registers it. Unknown packages, import failures, and shape mismatches each emit a single stderr warning and skip the bad entry — the registry never fails fatally on a misconfigured third party.
  - **Caching:** providers load once per process per cwd. `_resetThirdPartyCache()` is exposed for tests.
  - **Provider package convention:** publish a package whose `default` export is a `Pass2Provider`-shaped object. Naming convention: `anatomy-pass2-<vendor>` for discoverability (e.g. `anatomy-pass2-gemini`), but any package name works. The contract is at [`spec/0.8/pass2-prompt-contract.md`](../spec/0.8/pass2-prompt-contract.md) §5.
  - **API change (small):** `listProviders()` and `getProvider()` are now async to support lazy third-party loading. `selectProvider()` was already async. Internal-only callers updated; no public CLI surface change.
  - 22 new tests covering config parsing (env / file precedence, malformed TOML, partial schemas), shape validation, dynamic-import failure paths, config-default vs env vs explicit precedence.
- **New (Pass 2 portability — Phase 2):** Two HTTP providers ship as built-ins. The CLI is no longer Claude-Code-only for Pass 2 generation.
  - `openai-http` — OpenAI-compatible Chat Completions endpoint. Auth via `OPENAI_API_KEY` (or `ANATOMY_PASS2_API_KEY` fallback). Endpoint via `OPENAI_BASE_URL` (or `ANATOMY_PASS2_BASE_URL`), default `https://api.openai.com`. Works with OpenAI, vLLM, llama.cpp's server mode, OpenRouter, Together, and any compatible inference framework. Default model `gpt-4o`; override via `ANATOMY_PASS2_MODEL` or `--provider openai-http` + explicit input. Sets `response_format: {"type": "json_object"}`.
  - `anthropic-http` — Anthropic Messages API direct (no Claude Code installation required). Auth via `ANTHROPIC_API_KEY` (or `ANATOMY_PASS2_API_KEY` fallback). Default model `claude-sonnet-4-6`; pinned `anthropic-version: 2023-06-01`.
  - Both providers map HTTP status codes to categorical `ProviderError` codes: 401/403 → `pass2-provider-auth`, 429 → `pass2-provider-quota`, other non-2xx → `pass2-provider-network`. Parse failures → `pass2-provider-parse`.
  - Auto-detect order: claude-cli > anthropic-http > openai-http. A user with both Claude Code installed AND an `ANTHROPIC_API_KEY` set still gets claude-cli by default. Override with `--provider <name>` or `ANATOMY_PASS2_PROVIDER`.
  - 22 new tests in [`tests/pass2-http-providers.test.ts`](tests/pass2-http-providers.test.ts) covering auth/network/quota/parse paths against a mocked `fetch`.
- **New (Pass 2 portability — Phase 1):** Pass 2 LLM dispatch now goes through a `Pass2Provider` interface ([`anatomy-cli/src/pass2/providers/`](src/pass2/providers/)). The default `claude-cli` provider preserves v0.10.0 behavior byte-for-byte; existing users see no change. New CLI affordances:
  - `--provider <name>` selects a registered provider (implies `--ai`).
  - `--providers` lists registered providers and their availability.
  - `--print-prompt` dumps the system + user prompt that *would* be sent to Pass 2 and exits 0 — used by plugin authors verifying their provider against the published contract.
  - `ANATOMY_PASS2_PROVIDER` env var sets the default provider when `--provider` isn't passed.
  - Categorical `ProviderError` codes (`pass2-provider-network`, `-auth`, `-quota`, `-parse`, `-schema`, `-not-available`) so future providers surface failures uniformly.
  - Published contract at [`spec/0.8/pass2-prompt-contract.md`](../spec/0.8/pass2-prompt-contract.md). Third-party providers can implement against the doc without reading TypeScript.
  - Phase 3 (third-party plugin loading via `.anatomy-cli.toml`) is deferred — not blocked, just not yet needed since no third-party providers exist to consume it.
- **Behavior change (subtle):** `enrichWithAI(result, repoRoot)` gains a backwards-compatible third arg `options: EnrichOptions = {}`. Existing two-arg callers see no change. The return type now optionally includes `prompt` (set only when `printPromptOnly: true`).
- **New (eval methodology):** `ANATOMY_HOOK_DISABLE` env var makes `anatomy hook` exit silently (no markdown, no telemetry record). Used by the mcp-only eval condition (per [`docs/superpowers/specs/2026-05-08-eval-methodology-design.md`](../docs/superpowers/specs/2026-05-08-eval-methodology-design.md) §4) to decompose hook-vs-MCP contribution without uninstalling the consumer plugin. Same truthy-string convention as `ANATOMY_TELEMETRY_DISABLE` (any non-`0`/`false`/empty value disables).
- **New (eval methodology):** `ANATOMY_TELEMETRY_TAG` env var adds a `tag` field to every telemetry record. Used by eval runs to filter their own activity from `~/.anatomy/telemetry.jsonl` post-hoc. Empty / unset value emits no `tag` field (no behavior change for non-eval users).
- **New (memory v0.2):** `anatomy memory verify <id>` subcommand records that an entry is "still relevant" — bumps the file's `anatomy_memory_version` to `"0.2"` on first verify against a v0.1 file, sets `last_verified_at` to current time, prepends the current attribution to `verified_by` (LRU at 5).
- **New:** `MEMORY_VERSION` constant bumped to `"0.2"`. Fresh `.anatomy-memory` files (created by `anatomy add`) now declare `anatomy_memory_version = "0.2"` from the start. Existing v0.1 files keep their version until the first `verify` call.
- **New:** decay-bucket annotations (`fresh`/`aging`/`stale`/`untouched`) in `anatomy memory list` (a `decay` column), `anatomy memory stats` (per-kind sub-counts), and the MCP `anatomy_memory_search` tool (each result gets a `decay_bucket` field).
- **New:** MCP `anatomy_memory_search` ranking applies decay multipliers (default fresh=1.0, aging=0.85, untouched=0.7, stale=0.6) to the token-match score. Multipliers are configurable via `ANATOMY_MEMORY_DECAY_MULTIPLIERS` env var (`fresh:0.9,stale:0.3` syntax; clamped to [0,1]). Tokenless queries use a base score of 1, so decay is the dominant ranking signal; token queries multiply by the AND-matched token count.
- **New:** `anatomy memory list --only-fresh` flag restricts listing to entries last verified in the last 30 days.
- **New:** `error-docs.ts` entries for `memory-verified-by-malformed`, `memory-verified-by-too-many`, `memory-last-verified-before-at`.
- **Fix:** Pass 1 form detection now correctly classifies Electron/Tauri desktop apps (`desktop-app` form suffix) and web-server-shaped repos (`service` form). Surfaced by a 6-repo evaluation in [`docs/superpowers/specs/2026-05-08-pillar-redesign-evidence.md`](../docs/superpowers/specs/2026-05-08-pillar-redesign-evidence.md): 4 of 5 sampled non-self repos had previously misclassified forms (Electron apps → `*-library`, web apps → `*-library`). New signals: `electron`/`@tauri-apps/{api,cli}`/electron-build-tooling deps as desktop-app; `electron`/`tauri` script invocations as desktop-app; server-framework deps (express/fastify/hono/koa/nest/polka/tinyhttp/h3) as a service moderate-signal; `node X.js` / `tsx X.ts` / `bun X.ts` / `deno run X.ts` start-script shapes as a service moderate-signal. +8 tests covering the new paths.
- **Hook fix:** rules-section truncation now drops whole rule entries from the end rather than char-cutting then stripping the partial last line. Preserves rule integrity (no bullet without its `*Why:*` continuation).
- **Tests:** +27 covering decay buckets, recordVerification (LRU + dedup + version bump), verify CLI subcommand (happy path, v0.1→v0.2 bump, no-memory/no-id errors, list/stats integration), MCP search rank ordering across decay buckets.

## [0.10.0] — 2026-05-08

v0.8 wire-version support — subtractive cleanup. See the cross-package [root CHANGELOG](../CHANGELOG.md) for the full release framing.

- **New:** `anatomy migrate --to 0.8` — drops `code_profile` silently (dead surface since `ec73e00`); drops `substance.capabilities`/`limitations` with stderr warnings listing dropped phrases as candidates for re-expression as `[[decisions]]`. Identity is unchanged across the migration, so paired `.anatomy-memory` keeps its `repo_fingerprint` without rehash.
- **New:** v0.8 emit in [`render/toml.ts`](src/render/toml.ts) (`anatomy_version = "0.8"`, schema URL bumped). Drops `[code_profile.*]` block emission entirely.
- **Removed:** `anatomy_code_profile` MCP tool from the section-tools registry. Tool count: 11 → 10.
- **Removed:** [`pass1/code-profile.ts`](src/pass1/code-profile.ts). The subcommand-name extraction it housed (used to feed `interface.subcommands` for CLI tools) moved into [`pass1/interface.ts`](src/pass1/interface.ts) as `extractCommandNamesFromDir`. Component/endpoint/export extraction (which fed the now-deleted `code_profile` variants) is gone.
- **Removed:** `CodeProfileSignals` from [`types.ts`](src/types.ts); `Pass1Result.codeProfileSignals` field gone.
- **Show:** [`commands/show.ts`](src/commands/show.ts) keeps rendering `substance.capabilities`/`limitations` for legacy v0.7 files (validator routes them to schema-0.7.json which still allows those fields).

## [unreleased] — post-0.9.0

Quality pass after the v0.7 + memory + plugin work; surfaced and addressed by an A/B eval (see `docs/superpowers/specs/2026-05-08-anatomy-consumer-results.md`).

- **New:** `ANATOMY_TELEMETRY_DISABLE` env var. Set to any truthy value other than `"0"` / `"false"` (case-insensitive) to suppress all writes to `~/.anatomy/telemetry.jsonl`. Used by integration tests to avoid polluting the user's log; also a clean privacy opt-out.
- **Fix:** `anatomy rehash` for v0.7 documents now uses an in-place line replace of `fingerprint = "..."` instead of `smol-toml.stringify`. Preserves the file byte-for-byte outside the changed line — `[[rules]]`/`[[flows]]`/`[[decisions]]` section ordering is no longer at risk. v0.1–v0.6 keep using stringify (their per-pillar hash fields make a line-targeted edit brittle, and older docs lack the order-sensitive sections).
- **New:** `anatomy rehash --update-memory` flag. After rehashing `.anatomy`, propagates the new fingerprint to the paired `.anatomy-memory.repo_fingerprint` header. Closes the UX paper-cut where changing identity pillars left the memory file stale until you remembered to hand-edit it.
- **Fix:** Match-count guard in both rehash paths (.anatomy fingerprint + memory repo_fingerprint). Refuses to replace when the fingerprint-shaped regex matches more than once — defeats the false-positive scenario where a `[[rules]]`/`[[flows]]`/`[[decisions]]` multi-line basic string contains a literal `fingerprint = "..."` line.
- **Tests:** +10 tests across telemetry and rehash (env bypass × 3, byte-identical preservation, section-order assertion, --update-memory × 4, false-positive guards × 2).

## [0.9.0] — 2026-05-08

Claude Code consumer plugin: SessionStart hook + MCP server + telemetry.

- **New:** `anatomy hook [--root] [--max-tokens N] [--json]` — emits markdown for Claude Code SessionStart context injection. Default 1,200-token budget (truncates optional sections from the end first; never drops `[[rules]]` entirely). Prepends a staleness banner when `generated.commit` doesn't match git HEAD. `--root` resolves repo-root `.anatomy` instead of cwd-nearest. `--json` emits structured JSON instead.
- **New:** `anatomy mcp` — stdio JSON-RPC MCP server exposing 11 tools:
  - **Section tools** (8): `anatomy_overview`, `anatomy_structure`, `anatomy_interface`, `anatomy_environment`, `anatomy_substance`, `anatomy_code_profile`, `anatomy_domain_model`, `anatomy_tree`.
  - **Memory tools** (3): `anatomy_memory_search` (tokenized query; corpus = topic + content + tags), `anatomy_memory_show <id>`, `anatomy_memory_stats`.
  - Uniform response envelope: `{ anatomy_path, staleness, repo_fingerprint, data }`.
- **New:** Telemetry. Append-only JSONL at `~/.anatomy/telemetry.jsonl`, recording `hook_fire` and `mcp_call` events with repo_fingerprint, args, latency, error. `anatomy telemetry stats` (kind/tool counts + top memory queries) and `anatomy telemetry clear` helpers.
- **New:** Foundation `src/resolve.ts` — nearest-`.anatomy` resolution + parse + git-HEAD staleness check used by both `hook` and `mcp` paths.
- Tests: ~50 new across hook (10), MCP envelope, MCP section tools, MCP memory tools, MCP integration (subprocess), telemetry + telemetry-cmd, lazy-import.

## [0.8.0] — 2026-05-08

Lived-experience memory layer.

- **New:** `anatomy add <kind> <topic> [content]` — appends a memory entry. Kinds: `gotcha | decision | convention | attempt | milestone`. Optional `--supersedes <id>` (patches predecessor's `superseded_by`), `--refs <a,b>` (file refs), `--tags <a,b>`. Reads content from stdin (`-`) or `$EDITOR` when omitted.
- **New:** `anatomy memory list / grep / show / stats / deprecate / thanks / credits`:
  - `list [--kind <k>] [--topic <s>] [--ref <s>] [--tag <t>] [--include-superseded]` — tabular list (hides superseded/deprecated by default).
  - `grep "<query>"` — substring match in topic + content (newest first).
  - `show <id>` — full detail of one entry plus its supersession chain.
  - `stats` — per-kind counts of active/superseded/deprecated.
  - `deprecate <id> --reason <text>` — marks an entry obsolete with no replacement.
  - `thanks <id>` — records that an entry helped you (idempotent per identity).
  - `credits` — markdown table of contributors with thanks/contribution counts.
- **New:** Attribution detector (`src/memory/attribution.ts`) — tags entries `claude-session:<model>` (when run from a Claude Code session) or `human:<user>` based on env signals.
- **New:** `anatomy show --prose [--no-memory | --memory-only] [--memory-limit-{gotcha,decision,attempt}=N]` — appends a memory section to the prose render (or shows it standalone). Per-kind item caps prevent runaway memory sections from drowning the anatomy in prose mode.
- **Update:** `anatomy validate` auto-detects a sibling `.anatomy-memory` and validates it too via `validateMemory()`. Exit code reflects the union.
- **Internals:** `src/memory/{io,id,attribution}.ts` for memory file IO (read-parse-append-patch), Crockford-base32 entry id generator, attribution detector. Parse-reserialize for memory mutations to eliminate any regex-injection surface.

## [0.5.0] — 2026-05-07

Schema v0.7 wire alignment + Pass 2 context enrichment + multi-version migrate.

- **New:** Renders `anatomy_version = "0.7"` with flat identity (`stack`/`form`/`domain`/`function` as plain strings), single fingerprint via `fingerprintFromPillars`, and the new `[[rules]]`/`[[flows]]`/`[[decisions]]` array-of-tables. `[[insights]]` and `[[architecture.invariants]]` are no longer emitted.
- **New:** `anatomy migrate --to <version>` supports v0.4 / v0.5 / v0.6 / v0.7. The v0.6 → v0.7 migration flattens identity, drops insights+architecture, recomputes fingerprint.
- **New:** `anatomy show [<path>] [--prose]` command — natural-language render for AI context. The non-prose form is the parsed structure; `--prose` is the format used by the SessionStart hook (added in 0.9.0).
- **New:** `anatomy validate --require-fresh` — exits 1 if `generated.commit` doesn't match git HEAD. Useful as a CI gate to keep `.anatomy` from drifting.
- **New:** Pass 2 context-extras (`src/pass2/context-extras.ts`):
  - `buildGitLog` — last 15 commits, ~600 chars.
  - `buildTestSample` — slice of one representative test file.
  - `buildImportSample` — first-level imported files (resolved across .ts/.tsx/.js/.jsx/.mjs).
- **New:** Pass 2 prompt asks for `[[rules]]`/`[[flows]]`/`[[decisions]]` (replacing the old `[[insights]]` ask). `applyAiFill` understands the v0.7 flat identity.
- **Update:** `anatomy rehash` handles v0.7 flat identity (recomputes fingerprint via `fingerprintFromPillars`; v0.1–v0.6 path unchanged).
- **Brief detour:** A code-intelligence module (import-graph hubs, enum/singleton detection emitting into `code_profile.{import_graph,enums,globals}`) was added then removed in commit `ec73e00`. The pivot reasoning is captured in `.anatomy-memory` entry `et5gth9k`: those fields were re-derivable from source on every read, and v0.7 + the memory layer better serve that use case.
- **Tests:** ~80 new (Pass 2 builders, v0.7 generation/render/migrate, --require-fresh gate, prose rendering).

## [0.3.2] — 2026-05-06

- **New:** `--verbose` / `-v` flag prints debug output to stderr (manifest detection, stack/form heuristics, tagline source, structure counts, pass1 timing, render byte count, validation gate result).
- **Security:** `JSON.parse` reviver in npm manifest detector strips `__proto__`, `constructor`, `prototype` keys from untrusted package.json input. Defense-in-depth against prototype pollution.
- **Security:** TS-vs-JS dep check uses `Object.prototype.hasOwnProperty.call` instead of `in` operator (ignores prototype-chain entries).
- **Tests:** new `tests/security.test.ts` (9 tests) — prototype pollution, malformed JSON, oversize files, NULL bytes in README, structure walker hard limit.

## [0.3.1]

Robustness sprint. No behavior changes, no new features beyond `explain`.

- **Refactor:** inline `canonical.mjs` helpers as TypeScript (`src/canonical.ts`); drop prebuild step. Eliminates the stale-vendored-file footgun under `vitest --watch`.
- **Robustness:** wrap manifest parse errors with helpful messages naming the file and format.
- **Robustness:** new `src/io.ts` strips UTF-8 BOM at all file-read sites and enforces size limits (1 MB manifest, 1 MB README, 200 KB `.anatomy`).
- **Robustness:** structure walker hard-limits at 1000 top-level entries; emit at most 25 (matches schema's `maxItems`).
- **Robustness:** `generate` writes atomically (tmp + rename) to protect concurrent readers.
- **New:** `anatomy explain <code>` command prints docs for any error/warning code emitted by the validator.
- **New:** `validate` command appends `(run \`anatomy explain <code>\` for details)` hint to its error/warning output.
- **Tests:** new fuzz suite with `fast-check` covering canonical idempotence and the Pass 1 → render → validate invariant on random repo states.

## [0.3.0] — 2026-05-06

- First release of the CLI package, aligned with `@anatomy/spec` and `@anatomy/validate` at the v0.3 baseline.
- `anatomy validate [<path>] [--quiet]` — wraps `@anatomy/validate`'s single-file mode.
- `anatomy generate [--repo <path>] [--force] [--stdout]` — Pass 1 deterministic generation:
  - Detects npm / cargo / pyproject / go manifests in priority order.
  - Stack-prefixed form IDs (`<stack>-cli-tool` / `<stack>-library`).
  - TS-vs-JS detection for npm via `tsconfig.json` or `typescript` dep.
  - Tagline from README first non-heading line, with manifest-description fallback.
  - Commands from `package.json.scripts` (npm only).
  - Top 5 dependencies as key_dependencies.
  - Top-level dirs classified by name into `kind`.
  - Form-conditional `[interface]` emission (npm bin → subcommands; npm exports → exports).
  - Schema-valid output with TODO placeholders for fields needing human/AI input.
  - Internal validation gate: every generated `.anatomy` is validated before write; exit 3 on generator-bug failure.
- Programmatic surface: `runPass1`, `renderToml`, `Pass1Result`.
- Two npm bin entries: `anatomy` and `anatomy-cli`.
- 91 tests covering manifest detectors, every Pass 1 module, the renderer, and end-to-end CLI behavior.
