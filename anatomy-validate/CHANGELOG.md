# `@anatomy/validate` — Changelog

See the cross-package [root CHANGELOG](../CHANGELOG.md) for ecosystem-level events.

## [0.8.0] — 2026-05-13

### Breaking changes

- **`validate()` is now async.** Returns `Promise<ValidateResult>` instead of `ValidateResult`.
  This change accommodates the new v0.12 `[[rules]].verify` field, whose AST-based
  verifier (`ast_pattern`) needs async I/O (file globbing + ast-grep parsing).
  Consumers must `await` calls to `validate()`. Sync callers will get a Promise
  where they previously got a `{ ok, errors, warnings }` object.
- **`validateTree()` is now async.** Returns `Promise<TreeValidateResult>`.

### Added

- v0.12 schema support: optional `[[rules]].verify` field with three verifier kinds
  (`glob_exists`, `glob_only`, `ast_pattern`).
- New warning codes: `verify-glob-empty`, `verify-glob-unexpected-files`,
  `verify-glob-outside-container`, `verify-pattern-not-matched`,
  `verify-pattern-found-where-forbidden`, `verify-ast-grep-unavailable`,
  `verify-invalid-pattern`, `verify-source-scan-truncated`.
- Optional dependency on `@ast-grep/napi` for AST-based rule verification.

## [0.7.0] — unreleased

AGENTS.md interop release. Cross-package summary in the root
[CHANGELOG](../CHANGELOG.md#unreleased--v010-agentsmd-interop).

- **New:** v0.10 schema registered. `supportedVersions` includes `"0.10"`.
- **No behavior change to existing checks.** v0.10 is additive over v0.9
  (adds optional `[generate]` section); identity / fingerprint / hash check
  logic is unchanged — the `v0.7-introduced` `fingerprintFromPillars` branch
  already covers v0.10.

## [unreleased] — post-0.5.0

- **Bug fix (source-cross-check Class 1 — declaration vs. usage):** `package.json` is now special-cased in the source index. Its dep-declaration sections (`dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies`, `bundleDependencies`, `bundledDependencies`) are stripped before joining into the haystack, because declaring a dep is the manifest claim itself, not evidence of use. Previously, every quoted dep name in `package.json` matched `findQuotedReference` and Class 1 could not fire on declared-but-unused deps — exactly the case that motivated the check. Verified against the eval pre-refinement files: Snipper now correctly flags all 5 unused `@codemirror/*` claims that the original implementation silently passed.
- **New: `isUsedInScripts(name, scripts)`** — exported helper. Returns true when `name` appears as a whitespace/operator-bounded token (`\s|&&|\|\||;|\||>`) in any script value. Handles bare invocation (`prettier --write .`), `npx <name>`, and chained commands. For `@scope/name` deps, also matches the conventional bin form `<scope>-<name>` (e.g. `@electron/rebuild` published as `electron-rebuild`). Wired into `checkDependencyUsage` as a second-chance match after `findQuotedReference`.
- **`findQuotedReference` extended to handle subpath imports.** Now matches `'pkg/sub/path'` and `"pkg/sub/path"` in addition to bare-quoted forms. Catches CSS / dist / submodule imports like `import '@fontsource/inter/400.css'` that previously false-positived as unused. The right-side boundary is still strict on `-` and `.` (so `react` does not match `react-dom`/`react.foo`).
- **Top-level source files in scan.** `buildSourceIndex` now includes top-level files at the scan root matching common source extensions (`.ts`/`.js`/`.mjs`/`.cjs`/`.tsx`/`.jsx`/`.py`/`.go`/`.rs`/`.java`/`.kt`/`.swift`/`.c`/`.cpp`/`.h`/`.hpp`/`.rb`/`.php`). Catches small repos that put `server.js` / `database.js` / `main.py` at the root (the Verbifex pattern), where deps imported there previously false-positived because the structure entries didn't list them.
- **Internal: package.json loaded first.** The structure walker's `seenAbs` skip then prevents the unfiltered version from re-loading via a structure entry pointing at `.`. Before this reorder, a structure entry of `path = "."` would shadow the filtered package.json with the original, re-introducing the bug.
- **Tests:** +12 in `tests/source-cross-check.test.ts` covering all four extensions plus the dep-declaration strip across `dependencies`/`devDependencies`/`peerDependencies`/`optionalDependencies`. Two pre-existing tests that codified the bug ("no warning when dep name only appears in package.json", "finds dep referenced only in package.json scripts") were rewritten to assert the corrected behavior.

## [unreleased] — post-0.4.0

- **New:** memory v0.2 schema registered. `supportedMemoryVersions = ["0.1", "0.2"]`. v0.2 adds optional `last_verified_at` (date-time) and `verified_by` (array of attribution strings, max 5) fields on entries for decay tracking.
- **Behavior change:** v0.1 memory schema's `$defs.entry.additionalProperties` relaxed from `false` to `true` so a v0.1 consumer reading a v0.2-authored file silently tolerates the new fields rather than rejecting them. This is a one-time backward-compat amendment; documented in `spec/CURRENT.md`.
- **New checks:**
  - `memory-verified-by-malformed` (error) — verified_by item doesn't match the attribution regex.
  - `memory-verified-by-too-many` (warning) — verified_by has > 5 entries (slips past schema when reading v0.1 with relaxed additionalProperties).
  - `memory-last-verified-before-at` (warning) — last_verified_at < at, indicating typo or clock skew.
- **Tests:** +5 in `tests/memory-validate.test.ts` covering v0.2 acceptance, malformed verified_by, last-verified-before-at warning, and v0.1 forward-compat tolerance.

## [0.4.0] — 2026-05-08

v0.8 wire-version support. Subtractive — the validator gains one more entry in the routing map; existing v0.1–v0.7 behavior is unchanged.

- **New:** v0.8 schema registered; `supportedVersions = ["0.1", "0.2", "0.4", "0.5", "0.6", "0.7", "0.8"]`.
- **Updated:** version-aware identity checks now use a `FLAT_PILLAR_VERSIONS = {"0.7", "0.8"}` set in [`fingerprint-check.ts`](src/checks/fingerprint-check.ts) and [`hash-check.ts`](src/checks/hash-check.ts). Both versions share the flat-pillar identity shape and `fingerprintFromPillars` formula.
- **Updated:** `commands-no-test` warning's `APPLICABLE_VERSIONS` now includes `"0.8"`.

## [unreleased] — schema additions for v0.4–v0.7 + memory layer

The package version remains 0.3.2 (the v0.3 ecosystem version did not bump — v0.4–v0.7 are wire-version additions registered through the existing routing infrastructure). Behavior is additive: previously-valid v0.1/v0.2 documents still validate identically.

### Schema registration

- Routes v0.4, v0.5, v0.6, and v0.7 wire-version files via `supportedVersions = ["0.1", "0.2", "0.4", "0.5", "0.6", "0.7"]`.
- Each version's schema is loaded as a separate AJV-compiled validator in `validators` map; `validate()` selects the right one from the document's declared `anatomy_version`.

### v0.7-aware identity checks

- `fingerprintCheck` is version-aware: v0.7 documents have a flat identity (4 plain string pillars + single `fingerprint`) and are validated against `fingerprintFromPillars(stack, form, domain, function)` — `Crockford-base32(SHA-256(stack\0form\0domain\0function))[:20]`. v0.1–v0.6 keep the per-pillar-hash concat formula.
- `hashCheck` short-circuits as no-op for v0.7 (no per-pillar hash fields exist) and runs the per-pillar canonical-hash check for v0.1–v0.6.
- New canonical-form helper `fingerprintFromPillars` is exported (and re-exported through the public API for downstream consumers).

### `commands-no-test` warning (v0.4+)

- New `WarningCode "commands-no-test"`. Fires when a v0.4+ document declares `[operation.commands]` but the table has no `"test"` key. Skipped entirely on v0.1/v0.2/v0.3 — `[operation.commands]` only became a recommended convention from v0.4 onward. Exact-match semantics: a `test.unit` key alone still warns; a `test` key alongside other namespaced `test.*` keys does not.

### Memory layer (`.anatomy-memory` validation)

- New entry point `validateMemory(text, options)` for paired memory files. Schema-routed (`memory_schema_0_1`) on a separate AJV instance to avoid cross-contamination.
- New 3-check pipeline:
  - **`memory-fingerprint-check`** — paired-fingerprint integrity. Errors with `memory-fingerprint-mismatch` if `repo_fingerprint` doesn't match the paired `.anatomy`'s fingerprint.
  - **`memory-supersession-check`** — detects `--supersedes` cycles (errors with `memory-supersedes-cycle`) and dangling targets (errors with `memory-supersedes-not-found`).
  - **`memory-dangling-ref-check`** — warns with `memory-dangling-ref` when an entry's `refs` list points to a file that doesn't exist on disk.
- (No tree-mode entry point for memory yet — call `validateMemory` once per discovered file. The cli's `anatomy validate` already does this for the sibling `.anatomy-memory` of the validated `.anatomy`.)
- New ErrorCodes: `memory-fingerprint-mismatch`, `memory-supersedes-not-found`, `memory-supersedes-cycle`.
- New WarningCode: `memory-dangling-ref`.

### Internals

- `parseAnatomyToml` (the date-normalizing TOML parser) now used by both `validate` and `validateMemory` so `TomlDate` instances become ISO strings before AJV's `format:date-time` runs.

## [0.3.2] — 2026-05-06

- Aligned package version with siblings; no behavior changes.

## [0.3.1]

- Aligned package version with siblings; no behavior changes.

## [0.3.0] — 2026-05-06

- Aligned package version with `@anatomy/spec` and `@anatomy/cli` at the v0.3 baseline.
- Description field updated to mention `validateTree` + cross-file warning.
- No behavior changes from 0.2.0.

## [0.2.0]

- New API: `validateTree(repoRoot, options) → TreeValidateResult` for cascading repos.
- New API: `findAnatomyForPath(repoRoot, queryPath)`, `discoverAllAnatomies(repoRoot, options)`.
- New option: `ValidateOptions.anatomyDir` — when supplied alongside `repoRoot`, structurePathCheck and sourcePathCheck resolve paths relative to `repoRoot/anatomyDir`, and a new `nestedPathEscapeCheck` fires.
- New per-file ErrorCodes: `nested-path-escape`.
- New tree-mode ErrorCode: `anatomy-read-error`.
- New cross-file WarningCode: `duplicate-fingerprint-in-tree`.
- New constant: `ECOSYSTEM_VERSION = "0.3"`.

## [0.1.0]

- Routes schema by file's declared `anatomy_version` (supports v0.1 and v0.2).
- `ValidateOptions.repoRoot` activated for path-existence checks.
- New checks: `structure-path-check`, `interface-form-check`, `entry-point-alias-warn`, `source-path-check`.
- New ErrorCodes: `unsupported-anatomy-version`, `structure-path-not-found`, `interface-form-mismatch`, `source-path-not-found`.
- New WarningCodes: `entry-point-description-deprecated`, `source-path-soft-not-found`.

## [0.0.1]

- First release. TOML parse + v0.1 JSON Schema validation + hash + fingerprint checks + description-too-long warning.
