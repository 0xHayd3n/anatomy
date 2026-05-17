# `@anatomy/validate`

TypeScript validator for `.anatomy` and `.anatomy-memory` files. Routes by declared wire version (v0.1, v0.2, v0.4, v0.5, v0.6, v0.7, v0.8) and supports v0.3 cascading semantics for repos with multiple `.anatomy` files.

## Install

```bash
npm install @anatomy/validate
```

Requires Node.js ≥ 22.

## Usage

### Single file

```typescript
import { validate } from "@anatomy/validate";
import { readFileSync } from "node:fs";

const text = readFileSync(".anatomy", "utf8");
const result = validate(text, { repoRoot: process.cwd() });

if (result.ok) {
  console.log("Valid:", result.value.identity);
  for (const w of result.warnings) console.warn(w.code, w.message);
} else {
  for (const e of result.errors) console.error(e.code, e.pointer, e.message);
}
```

### Cascading tree

```typescript
import { validateTree } from "@anatomy/validate";

const tree = validateTree(repoRoot);
// tree.results: Map<path, ValidateResult>
// tree.crossFile: warnings spanning multiple .anatomy files (e.g. duplicate-fingerprint-in-tree)
```

### Memory file

```typescript
import { validateMemory } from "@anatomy/validate";

const result = validateMemory(memoryText, {
  anatomyFingerprint: parsedAnatomy.identity.fingerprint,
  repoRoot,
});
```

## What it checks

### `.anatomy` (single file)

- **TOML syntax** — parse error → `toml-parse` error.
- **Schema conformance** — version-routed against `spec/{0.1, 0.2, 0.4, 0.5, 0.6, 0.7, 0.8}/schema.json`. Unknown `anatomy_version` → `unsupported-anatomy-version`.
- **Identity integrity** — version-aware:
  - **v0.7+ (incl. v0.8):** flat 4-string identity + single fingerprint via `fingerprintFromPillars(stack, form, domain, function)` = `Crockford-base32(SHA-256(stack\0form\0domain\0function))[:20]`.
  - **v0.1–v0.6:** per-pillar `hash = canonicalHash(id)`; `fingerprint = concat(stack.hash, form.hash, domain.hash, function.hash)`.
- **Path checks** — `structure.entries[].path`, `entry_points[].path`, `phrase_with_source.source.{path, symbol}` — soft-warn if missing on disk; nested-path-escape error for paths that climb above `repoRoot/anatomyDir`.
- **Interface↔form match** — `[interface.exports]` requires a library-shaped form; `[interface.subcommands]` requires a CLI-shaped form; etc.
- **Soft warnings** — `description-too-long`, `entry-point-description-deprecated` (v0.2 alias), `commands-no-test` (v0.4+: `[operation.commands]` without a `test` key).

### `.anatomy-memory` (paired file)

- **Schema conformance** — version-routed against `spec/memory/{0.1, 0.2}/schema.json`.
- **Paired-fingerprint integrity** — `repo_fingerprint` must match the paired `.anatomy`'s fingerprint (`memory-fingerprint-mismatch`).
- **Supersession integrity** — no cycles (`memory-supersedes-cycle`), no dangling targets (`memory-supersedes-not-found`).
- **Reference soundness** — entry `refs` pointing to nonexistent files → `memory-dangling-ref` warning.
- **v0.2 verification field hygiene** — `verified_by` items match the attribution regex (`memory-verified-by-malformed`); `verified_by` array bounded at 5 (`memory-verified-by-too-many` warning if exceeded by hand-edits); `last_verified_at` not earlier than the entry's creation `at` (`memory-last-verified-before-at` warning).

### Rule verification (v0.12+)

Each `[[rules]]` entry may carry an optional `verify` field that declares how to check the rule against actual source. Three kinds:

- `glob_exists` — assert files matching a glob exist (or, with `should_not=true`, don't exist).
- `glob_only` — assert files matching one glob all live inside another.
- `ast_pattern` — ast-grep pattern + `expect_in` or `forbid_in` glob. Requires the optional `@ast-grep/napi` dependency.

Example:

```toml
[[rules]]
rule = "Tests live in tests/"
verify = { kind = "glob_exists", path = "tests/*.test.ts" }

[[rules]]
rule = "No fetch() outside src/api/"
verify = { kind = "ast_pattern", lang = "ts", pattern = "fetch($_)", forbid_in = "src/!(api)/**/*.ts" }
```

Verify clauses run during `validate()` when `repoRoot` is provided. Violations surface as warnings; under `anatomy validate --strict` (the default), the relevant warning codes elevate to errors.

**`validate()` is async as of v0.12.** Earlier versions returned a sync object; callers must now `await`.

## Cascading (v0.3 ecosystem)

For repos with multiple `.anatomy` files (one at root, plus per-package overrides):

```typescript
import { findAnatomyForPath, discoverAllAnatomies } from "@anatomy/validate";

const nearest = findAnatomyForPath(repoRoot, "packages/server/src/index.ts");
const all = discoverAllAnatomies(repoRoot);
```

Cross-file checks include `duplicate-fingerprint-in-tree` (sibling files sharing a fingerprint).

## Public API

| Export | What |
|---|---|
| `validate(text, options)` | Single-file validation; returns `{ ok, value?, errors, warnings }`. |
| `validateTree(repoRoot, options)` | Cascading tree validation. |
| `validateMemory(text, options)` | `.anatomy-memory` single-file validation. (No tree-mode equivalent yet — call validateMemory once per discovered memory file.) |
| `findAnatomyForPath(repoRoot, queryPath)` | Locate the nearest `.anatomy` for a given file path. |
| `discoverAllAnatomies(repoRoot, options)` | Walk and parse every `.anatomy` in a tree. |
| `canonicalize(s)` / `hash(c)` / `canonicalHash(s)` / `fingerprintFromPillars(stack, form, domain, fn)` | Re-exported canonical-form helpers. |
| `supportedVersions` | Frozen tuple of supported wire versions. |
| `ECOSYSTEM_VERSION` | Currently `"0.3"`. |
| Types: `AnatomyDoc`, `ValidationError`, `Warning`, `ValidateOptions`, `ValidateResult`, `ErrorCode`, `WarningCode` |

## License

MIT
