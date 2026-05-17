# Cascading Semantics

**Status:** Normative for `.anatomy` cascading semantics. v0.3 ecosystem; per-file format remains v0.2 (see [`spec/0.2/schema.json`](../0.2/schema.json)). Files participating in v0.3 cascading continue to declare `anatomy_version = "0.2"`. Full design rationale in [`docs/specs/2026-05-06-anatomy-v0.3-design.md`](../../docs/specs/2026-05-06-anatomy-v0.3-design.md).

## 1. Architectural commitment: freestanding files

Each `.anatomy` is a complete, self-contained v0.2 file. Sub-anatomies have their own `[identity]`, `tagline`, hashes, and fingerprint. **No inheritance, no `extends`, no merging.** A monorepo of N described directories has N independently-readable anatomies.

Sub-anatomies legitimately have different identity from the root: a Discord extension under a TypeScript gateway can be `plugin / messaging-integration / discord-channel-adapter`, while the gateway is `cli-tool / ai-assistant / personal-ai-gateway`. Inheritance would actively fight this modelling.

A single `.anatomy` file per directory (filesystem natural). The `extends` mechanism is reserved for a hypothetical future revision; until then, every file is independent.

## 2. Path scoping

### 2.1 Path resolution (normative)

Paths in the following fields are interpreted **relative to the directory containing the `.anatomy` file**, not relative to the repository root:

- `[[operation.entry_points]].path`
- `[[structure.entries]].path`
- `[[substance.capabilities]].source.path` (structured form)
- `[[substance.limitations]].source.path` (structured form)
- The path component before `#` in the v0.1-string form of `[[substance.capabilities|limitations]].source` (best-effort; same v0.1 soft-warning semantics)

A root `.anatomy` is a special case only in that its containing directory IS the repository root; the rule is the same. For files declaring `anatomy_version = "0.2"`, the on-disk byte content of every existing fixture and consumer file remains correct under v0.3 semantics — single-file root validation is byte-identical to v0.2.

### 2.2 Containment rule (normative)

A sub-anatomy MUST NOT reference paths that resolve outside its own directory. After path normalisation (resolving `./` and `../` segments), every referenced path MUST be either equal to, or a descendant of, the directory containing the `.anatomy` file.

Validator: error code **`nested-path-escape`**. Hard error. The check requires knowing the `.anatomy` file's directory — see §6 (validator surface) for the `ValidateOptions.anatomyDir` field.

#### Examples

Given `extensions/discord/.anatomy`:

| `[[structure.entries]].path` | Verdict |
|---|---|
| `"src/"` | OK — resolves to `extensions/discord/src/` |
| `"./README.md"` | OK — equivalent to `README.md`, within scope |
| `"../slack/lib.ts"` | **`nested-path-escape`** — escapes the discord/ directory |
| `"/absolute/path"` | already a schema error in v0.2 (`path` regex disallows leading `/`) |
| `"src/../sibling/"` | OK if `sibling/` is within `extensions/discord/`; this rule is post-normalisation |

## 3. Discovery (normative)

Two pure operations on filesystem state.

### 3.1 `findAnatomyForPath(repoRoot, queryPath) → string | null`

Returns the absolute path to the `.anatomy` file that **describes `queryPath`** — the nearest-ancestor `.anatomy`. Returns `null` when no anatomy exists between `queryPath` and `repoRoot`.

#### Input handling (normative)

- `repoRoot` MUST be an existing directory. Throw `TypeError` synchronously otherwise.
- `queryPath` MAY be a file or directory; absolute or relative; existing or non-existent (an agent asking "where would this future file's anatomy be?" is valid).
- Relative `queryPath` is resolved against `repoRoot` (NOT against `process.cwd()`).
- Symlinks in `queryPath` are NOT canonicalized before walking. The lexical path is what's used.
- After resolution, the canonical input path MUST be either equal to `repoRoot` or a descendant of it. Throw `RangeError` synchronously otherwise.

#### Algorithm

```
input = resolve(repoRoot, queryPath)         // absolute, lexical
if !input.startsWith(repoRoot): throw RangeError
let dir = (input is an existing directory or input == repoRoot)
            ? input
            : dirname(input)                  // for non-existent paths, treat as a file path
while true:
  if exists(dir + "/.anatomy"): return dir + "/.anatomy"
  if dir == repoRoot: return null
  dir = parent(dir)
```

#### Edge cases

- `queryPath == repoRoot`: walk starts at `repoRoot`; returns root anatomy if present, else null.
- `queryPath` is non-existent under `repoRoot`: treated as a file path (`dirname`); walk proceeds normally.

### 3.2 `discoverAllAnatomies(repoRoot, options?) → Array<{ dirPath, absPath }>`

Returns every `.anatomy` file in the repository, ordered by `dirPath` lexicographically (deterministic). At most one entry per directory (filesystem natural).

### 3.3 No symlink following

Symlinks are not followed during discovery — guarantees no walk cycles, matches conservative discovery convention. If a maintainer wants a symlinked sub-tree included, they should place `.anatomy` files in the canonical location.

## 4. Tree-walk skip rules (normative)

`discoverAllAnatomies` and `validateTree` skip the following directories during descent:

- `.git/`
- `node_modules/`
- Any directory whose name starts with `.` (e.g., `.next/`, `.cache/`, `.venv/`, `.idea/`)

No `.gitignore` parsing.

### Recursion cap

Default `maxDepth: 10` levels below `repoRoot` (so `repoRoot` itself is depth 0; an immediate child is depth 1). Configurable via `options.maxDepth`.

**Behavior at the cap (normative):** when the walker reaches `maxDepth`, it processes the directory at that depth (may emit a `.anatomy` if one is present) but does NOT descend further into its children. The walk continues normally in sibling subtrees. The cap is a per-subtree depth limit, not a global walk abort. The walker emits no error and no warning when the cap is reached.

## 5. Cross-anatomy invariants

Exactly one cross-file rule. Soft (warning, not error). No others.

### 5.1 `duplicate-fingerprint-in-tree` (warning)

When `validateTree` encounters two or more anatomies in the same tree whose `[identity].fingerprint` strings are identical, emit **one warning per duplicate after the first**, in the lexicographic order of `relPath`. The first occurrence (lowest-sorting `relPath` for that fingerprint) is taken as the canonical anatomy and emits no warning; every subsequent anatomy with the same fingerprint emits one. This rule is normative so that two implementations produce identical `crossFileWarnings` arrays for the same tree.

The warning carries:
- Code: `duplicate-fingerprint-in-tree`
- Message: identifies the duplicate's relPath and the canonical (first) relPath
- Pointer: empty string `""` (tree-level finding, not a per-document pointer)

### 5.2 What is deliberately NOT enforced

- Child anatomy's stack must equal parent's stack — would gate legitimate polyglot monorepos.
- Child's identity must differ from parent's — covered by §5.1's soft warning.
- No two anatomies may exist in the same dir — already filesystem-natural.
- Identity / fingerprint chain consistency — would re-introduce inheritance through the back door.

## 6. Validator surface contract (normative)

### 6.1 Extended `ValidateOptions`

`ValidateOptions` gains one new optional field:

```ts
interface ValidateOptions {
  expectedVersion?: string;       // unchanged from v0.1/v0.2
  repoRoot?: string;              // unchanged from v0.2
  /** v0.3: relative path (POSIX-style, no leading "/", no "./" prefix) from
   *  repoRoot to the directory containing the .anatomy whose text is being
   *  validated. Use "" (empty string) for a root .anatomy. When set together
   *  with repoRoot:
   *    - structurePathCheck and sourcePathCheck resolve paths relative to
   *      repoRoot/anatomyDir
   *    - nestedPathEscapeCheck (new) is enabled
   *  When omitted, behavior is exactly v0.2.
   */
  anatomyDir?: string;
}
```

This preserves byte-identical v0.2 behavior for all existing callers. Adding an optional field is signature-compatible.

### 6.2 New function: `validateTree`

```ts
function validateTree(
  repoRoot: string,
  options?: ValidateTreeOptions,
): TreeValidateResult;

interface ValidateTreeOptions {
  maxDepth?: number;       // default 10
  skipDirs?: string[];     // default ['.git', 'node_modules']; replaces, doesn't merge
}

interface TreeValidateResult {
  /** True iff every per-file result.ok is true. crossFileWarnings (warnings,
   *  not errors) NEVER affect this field. v0.3 has no cross-file errors. */
  ok: boolean;
  /** One entry per discovered anatomy, in deterministic lexicographic order
   *  of relPath. relPath uses POSIX "/" separators on every platform. */
  results: Array<{
    relPath: string;
    result: ValidateResult;
  }>;
  /** Tree-level findings. v0.3 emits only `duplicate-fingerprint-in-tree`
   *  (a warning, never an error). */
  crossFileWarnings: Warning[];
}
```

`validateTree` internally:
1. Calls `discoverAllAnatomies(repoRoot, { maxDepth, skipDirs })`.
2. For each discovered file, reads its text and calls `validate(text, { repoRoot, anatomyDir })`. Anatomies that fail to read produce an `anatomy-read-error` in `errors` — the walk does NOT abort.
3. Runs the cross-file pass (only §5.1's duplicate-fingerprint check). Cross-file pass operates over results where `result.ok === true && result.value` is defined; failed-to-parse anatomies don't contribute.
4. Sets `ok = results.every(r => r.result.ok)` and returns.

### 6.3 New checks and codes

| Kind | Code | Severity | Where |
|---|---|---|---|
| Error | `nested-path-escape` | Hard | per-file (gated on `anatomyDir !== undefined`) |
| Error | `anatomy-read-error` | Hard | tree-mode (file unreadable) |
| Warning | `duplicate-fingerprint-in-tree` | Soft | tree-mode (cross-file pass) |

### 6.4 Existing API: signature-compatible

`validate(text, options)` keeps its existing call sites working unchanged. The only addition is the optional `anatomyDir` field. Callers that don't pass it get exactly v0.2 behavior.

### 6.5 Discovery helpers: exported

`findAnatomyForPath` and `discoverAllAnatomies` are exported public helpers. **They operate on filesystem paths supplied by the caller; they never inspect `.anatomy` file contents and are not affected by §2's per-directory path-resolution rule.**

### 6.6 Ecosystem version constant

`@anatomy/validate` exports a string constant identifying the ecosystem version it implements:

```ts
export const ECOSYSTEM_VERSION = "0.3";
```

This is the canonical surface for "this consumer understands cascading."

## 7. Versioning

The per-file schema does **not** change. A `.anatomy` file in a v0.3-aware repository continues to declare `anatomy_version = "0.2"`. There is no new schema, no `spec/0.3/schema.json`, no migration step.

The **ecosystem version** (this document's version) tracks cross-file semantics — cascading, discovery, tree-mode validation. It is advertised by consumer tooling via the `ECOSYSTEM_VERSION` constant; files themselves do NOT carry an ecosystem-version field. File-format version and ecosystem version evolve independently.
