// src/error-docs.ts
// Documentation for every ErrorCode + WarningCode the validator can emit.
// Surfaced via `anatomy explain <code>`. Hand-maintained — when a new code
// is added in @anatomy/validate, add its entry here too.

export interface ErrorDoc {
  /** Severity. Mirrors the validator's classification. */
  severity: "error" | "warning";
  /** One-line summary. */
  summary: string;
  /** Multi-paragraph explanation: what it means, why it fired, how to fix. */
  body: string;
}

const DOCS: Record<string, ErrorDoc> = {
  "toml-parse-error": {
    severity: "error",
    summary: "The file is not valid TOML.",
    body:
`The file failed to parse as TOML 1.0. Common causes:
  - Unquoted special characters in string values (use \"...\" or '...')
  - Trailing commas in inline tables or arrays
  - Mixed tabs and spaces in indented sub-tables
  - Tabs used as TOML separators (TOML reserves \\t in string contexts)
Run the file through a TOML linter to locate the line. The error 'message'
field carries the parser's location hint when available.`,
  },
  "schema-violation": {
    severity: "error",
    summary: "A field violates the JSON Schema constraint at the indicated pointer.",
    body:
`Schema-violation errors include a JSON Pointer ('/identity/stack/id', etc.)
plus the AJV keyword that failed ('pattern', 'required', 'maxLength',
'enum', etc.). Look at the spec doc for the section describing that field's
constraints. For pillar IDs, the constraint is the canonicalization regex
^[a-z0-9]+(-[a-z0-9]+)*$ — fix by lowercasing and replacing whitespace
with hyphens.`,
  },
  "version-mismatch": {
    severity: "error",
    summary: "The file's anatomy_version does not match expectedVersion option.",
    body:
`The validator was invoked with options.expectedVersion = "X.Y" but the file
declares anatomy_version = "Z.W". This fires only when expectedVersion is
explicitly supplied; without it, schemas are routed by the file's own
declared version.`,
  },
  "hash-content-mismatch": {
    severity: "error",
    summary: "A pillar's hash does not match canonicalHash(id).",
    body:
`Each [identity.<pillar>].hash MUST equal the first 5 chars of the lowercase
Crockford-base32 SHA-256 of the canonicalized id. Fix by recomputing — run
'anatomy generate --force' or use scripts/fix-fixture-hashes.mjs (for
fixtures only). The validator's 'expected' field shows the correct hash.`,
  },
  "fingerprint-mismatch": {
    severity: "error",
    summary: "identity.fingerprint is not the concat of the four pillar hashes.",
    body:
`fingerprint MUST equal stack.hash + form.hash + domain.hash + function.hash
(20 lowercase Crockford-base32 chars total). Fix by recomputing — same fix
as hash-content-mismatch.`,
  },
  "unsupported-anatomy-version": {
    severity: "error",
    summary: "The file's anatomy_version is not one this validator supports.",
    body:
`The validator implements a fixed set of anatomy_version values (currently
0.1 and 0.2). A file declaring anything else cannot be routed to a schema.
Either upgrade the validator (newer @anatomy/validate may know more
versions) or rewrite the file to declare a supported version.`,
  },
  "structure-path-not-found": {
    severity: "error",
    summary: "A [structure].entries[].path does not exist on disk.",
    body:
`The path is interpreted relative to anatomyDir (or repoRoot when
anatomyDir is unset). The validator was invoked with repoRoot set, so it
checked existence and found none. Fix by removing the entry, fixing the
path, or creating the missing directory.`,
  },
  "interface-form-mismatch": {
    severity: "error",
    summary: "The [interface] variant does not match the form id per spec §7.2.",
    body:
`Spec §7.2 maps form-id substrings to interface variants:
  cli      → subcommands
  api      → endpoints
  service  → endpoints
  library  → exports
First-match-wins, top-to-bottom. A form id like 'cli-library' matches 'cli'
first, so only 'subcommands' is valid. Fix by switching to the correct
variant, omitting [interface] entirely, or adjusting the form id.`,
  },
  "source-path-not-found": {
    severity: "error",
    summary: "A structured source.path does not exist on disk.",
    body:
`When [substance.capabilities|limitations].source uses the structured form
({ path, symbol }), validators with repoRoot set check that path exists.
Fix by removing the source field, fixing the path, or switching to the
v0.1 string form ("path#fragment") which only emits a soft warning on
missing paths.`,
  },
  "nested-path-escape": {
    severity: "error",
    summary: "A path-bearing field escapes the .anatomy's directory.",
    body:
`In v0.3 cascading mode (anatomyDir is set), every path in the .anatomy
MUST resolve within that anatomy's containing directory after lexical
normalization. A path like "../escape" or "src/../../sibling" escapes and
is rejected. Fix by removing the offending path, or describe that
content's directory with its own .anatomy file.`,
  },
  "anatomy-read-error": {
    severity: "error",
    summary: "validateTree could not read a discovered .anatomy file.",
    body:
`Discovered the file but failed to read its bytes — typically a race
condition (file deleted between discoverAllAnatomies and readFileSync) or
a permissions issue. Re-run validateTree after the underlying problem is
resolved. The 'actual' field carries the path.`,
  },
  "description-too-long": {
    severity: "warning",
    summary: "v0.1 only: description exceeds the 500-char soft cap.",
    body:
`v0.1 emitted a soft warning when description was longer than 500 chars.
v0.2 split this into a required short tagline (<=120 chars) and an
optional longer description (<=2000 chars hard cap). Migrating to v0.2
silences this warning.`,
  },
  "entry-point-description-deprecated": {
    severity: "warning",
    summary: "v0.2: entry_points still use the legacy 'description' key.",
    body:
`v0.1 used [[operation.entry_points]].description for the per-entry
purpose phrase. v0.2 renamed this to 'purpose'. The validator accepts both
spellings (so v0.1 files re-validate cleanly under v0.2) and emits this
soft warning to nudge maintainers to migrate. Rename the key to silence.`,
  },
  "source-path-soft-not-found": {
    severity: "warning",
    summary: "v0.1 string-form source path doesn't exist (best-effort check).",
    body:
`The v0.1 string form of [substance.capabilities|limitations].source
("path#fragment") was deliberately permissive — its path is not strictly
checked. The validator parses the leading path on a best-effort basis and
emits a soft warning when missing. To get a hard error instead, switch to
the v0.2 structured form { path, symbol }.`,
  },
  "duplicate-fingerprint-in-tree": {
    severity: "warning",
    summary: "Two .anatomy files in the same tree share a fingerprint.",
    body:
`Each .anatomy in a tree should describe a distinct scope, with distinct
identity. Sharing a fingerprint usually means two anatomies were copy-
pasted or one was duplicated by accident. Either differentiate them
(probably by changing form/domain/function in one), delete the duplicate,
or accept the warning if it's intentional (e.g., a vendored copy).`,
  },
  "memory-read-error": {
    severity: "error",
    summary: "The .anatomy-memory file could not be read.",
    body:
`I/O failure (permission denied, file disappeared mid-walk, encoding
error, etc.) when validate tried to load a paired .anatomy-memory.
The 'message' field carries the underlying OS error. Confirm the file
exists, is readable by the current user, and is valid UTF-8.`,
  },
  "missing-anatomy-memory-version": {
    severity: "error",
    summary: "The .anatomy-memory file lacks the anatomy_memory_version header.",
    body:
`Memory files MUST start with two header lines:
  anatomy_memory_version = "0.1"
  repo_fingerprint = "<paired-anatomy fingerprint>"
Without anatomy_memory_version, the validator can't route to a memory
schema. Add the header at the top of the file (before any [[entries]]
blocks). The fingerprint MUST match the paired .anatomy's fingerprint —
'anatomy rehash --update-memory' propagates a new fingerprint.`,
  },
  "unsupported-memory-version": {
    severity: "error",
    summary: "The .anatomy-memory declares a version this validator doesn't support.",
    body:
`validateMemory currently knows only memory v0.1. A file declaring
anatomy_memory_version = "X.Y" for an unsupported X.Y is rejected.
Either downgrade the file's declared version to "0.1" (the format is
backward-compatible within memory v0.x) or upgrade @anatomy/validate
to a version that supports the newer memory format.`,
  },
  "memory-fingerprint-mismatch": {
    severity: "error",
    summary: "repo_fingerprint in .anatomy-memory doesn't match the paired .anatomy.",
    body:
`Memory files pin the .anatomy fingerprint in their header so the two
files stay paired. A mismatch usually means the .anatomy was rehashed
(identity pillars changed → fingerprint changed → memory's pin became
stale). Fix it by running 'anatomy rehash --update-memory' to propagate
the new fingerprint to the memory header. Less commonly: the memory
file was copied across repositories — in that case, update the
fingerprint manually or regenerate the memory file from scratch.`,
  },
  "memory-supersedes-not-found": {
    severity: "error",
    summary: "An entry's supersedes target doesn't exist in this memory file.",
    body:
`When an [[entries]] block sets supersedes = "abc12345", that id MUST
exist as another entry in the same file. The reference here points to
an id that's not present. Common causes:
  - The predecessor was never written (typo in the --supersedes flag
    when running 'anatomy add').
  - The predecessor was manually deleted from the file (memory entries
    are append-only by design — use --supersedes to retire instead).
Run 'anatomy memory list --include-superseded' to see the full id list
and confirm the target.`,
  },
  "memory-supersedes-cycle": {
    severity: "error",
    summary: "Memory entries form a supersession cycle (A → B → A).",
    body:
`Supersession must be a DAG: an entry can supersede an older one, but
the chain MUST NOT loop. A cycle (A supersedes B; B supersedes A) is
almost always the result of a manual edit. To resolve: pick the entry
that's actually current and clear the supersedes field on the other.
The two entries can still coexist independently in the file; supersession
is a typed relationship, not a delete.`,
  },
  "memory-dangling-ref": {
    severity: "warning",
    summary: "A memory entry references a file path that doesn't exist on disk.",
    body:
`Entry refs (set via 'anatomy add ... --refs <path,...>') are
best-effort: validateMemory checks them against the working tree and
warns when a path doesn't resolve. Common reasons:
  - The referenced file was renamed or deleted. Either update the entry
    (write a new one with --supersedes pointing at the stale entry) or
    accept the warning if the historical reference is intentional.
  - The ref points to a generated file not present until build runs.
    Acceptable to leave as a warning.
  - The ref is intentionally external (URL-shaped, or a path in a
    sibling repo). The check is path-based, so external refs always
    warn — accept or omit.`,
  },
  "commands-no-test": {
    severity: "warning",
    summary: "v0.4+: [operation.commands] declared, but no 'test' key.",
    body:
`From v0.4 onward, [operation.commands] is the canonical place to record
how to operate the project; the 'test' key specifically documents how
to run the test suite. The validator skips this check on v0.1/v0.2/v0.3
(where operation.commands wasn't yet a recommended convention).
Match is exact: a key like 'test.unit' alone still triggers the warning.
Fix by adding a plain 'test' command (it can coexist with namespaced
'test.*' keys). Suppress only by removing the [operation.commands]
section entirely, which is rarely the right move.`,
  },
  "memory-verified-by-malformed": {
    severity: "error",
    summary: "memory v0.2: a verified_by entry doesn't match the attribution regex.",
    body:
`Each verified_by item must be a string matching:
  human:<handle>           e.g. human:alice
  claude-session           or claude-session:<model> e.g. claude-session:opus-4-7
  @<handle>                bare GitHub-style handle (hand-edited entries)

Free-form names like "bob" or "Jane Doe" don't match. Run
'anatomy memory verify <id>' so the CLI writes a canonical attribution
based on detectBy() — that's the path most users should take.`,
  },
  "memory-verified-by-too-many": {
    severity: "warning",
    summary: "memory v0.2: verified_by has > 5 entries.",
    body:
`The schema caps verified_by at 5; this warning fires when a v0.1 file
(whose entry-level additionalProperties is relaxed to true) carries an
oversized verified_by array. The next 'anatomy memory verify' on this
entry truncates to the most-recent 5 via LRU. No corrective action is
strictly required; suppression is automatic on next write.`,
  },
  "memory-last-verified-before-at": {
    severity: "warning",
    summary: "memory v0.2: last_verified_at is earlier than the entry's creation timestamp.",
    body:
`An entry can't have been verified before it existed; this almost always
means a typo or clock skew. Fix by either editing last_verified_at to a
plausible timestamp or running 'anatomy memory verify <id>' to set it
to the current time.`,
  },
  "unused-dependency-claim": {
    severity: "warning",
    summary: "A [[substance.key_dependencies]] entry has no usage in scanned source.",
    body:
`The cross-check searches for the dep name as either:
  - A quoted import/require reference (\`'pkg'\`, \`"pkg"\`, or with a
    subpath like \`'pkg/sub/path'\`) in scanned source files, top-level
    config files (vite/webpack/eslint/tsconfig/etc.), or .github/workflows.
  - A bare-command token in package.json scripts (e.g. \`prettier\`
    invoked as \`"prettier --write ."\`, or chained after \`&&\`/\`||\`).
    For \`@scope/name\` deps the conventional bin form \`scope-name\`
    also matches (e.g. \`@electron/rebuild\` published as \`electron-rebuild\`).

The dep-declaration sections of package.json (\`dependencies\`,
\`devDependencies\`, \`peerDependencies\`, \`optionalDependencies\`,
\`bundleDependencies\`) are deliberately stripped from the haystack
before matching — declaring a dep is the manifest claim itself, not
evidence of use.

Common causes:
  - The dep is genuinely unused (orphan from a pivot or refactor).
    Remove the [[substance.key_dependencies]] entry, OR uninstall the
    dep entirely.
  - The dep is invoked from a script via a bin name that doesn't follow
    the \`scope-name\` convention (e.g. \`@swc/cli\` publishes \`swc\`).
    Add the package to the tooling allowlist, or describe the bin
    mapping in the why field.
  - The dep's runtime presence is dynamic (require.resolve with a
    computed string, plugin lookup, etc.). Document the runtime
    mechanic in the why field.

@types/* deps and the husky/lint-staged tooling allowlist are skipped
automatically and never produce this warning. The check is strict by
default in \`anatomy validate\` — exits 1. Use \`--no-strict\` to
keep warnings as warnings during exploratory work.`,
  },
  "literal-not-in-source": {
    severity: "warning",
    summary: "A literal in [[rules]]/[[flows]]/[[decisions]] text doesn't appear in scanned source.",
    body:
`The cross-check extracts three literal classes from claim text:
  - host-port:      localhost:NNNN, 127.0.0.1:NNNN, 0.0.0.0:NNNN
  - scoped-package: @scope/name (e.g. @codemirror/parser)
  - source-path:    src|lib|app|bin|cmd|pkg|internal|test|tests|spec|specs|docs/...
                    with a recognized source extension

For each extracted literal, the cross-check looks for it in the scanned
haystack (substring match for host-port and scoped-package; existsSync
fallback to substring match for source-path). When the literal is
absent everywhere, the claim has likely drifted from source.

Recommended fix: rewrite the claim to reference a stable code anchor
instead of a literal value. Compare:

  BAD:  "AI proxy targets localhost:2022 — do not change."
  GOOD: "The AI proxy URL is in src/ai.js as the CURSOR_PROXY constant.
         That file is the source of truth; do not duplicate the URL here."

The good form references a path the cross-check verifies exists and
shifts authority to the code itself, so a port change in src/ai.js
does not invalidate the rule. This is the eval-author discipline
captured in docs/superpowers/specs/2026-05-09-anatomy-consumer-results-cross-repo-N3.md.

If the literal is intentionally a recommendation (not an assertion that
the value exists in source), reword to remove the literal — e.g.,
"choose any unused port" instead of "use localhost:9999".

This warning is treated as an error by default (\`anatomy validate\`
exits 1). Use \`--no-strict\` to keep it as a warning during
exploratory work.`,
  },
  "source-cross-check-truncated": {
    severity: "warning",
    summary: "source-cross-check stopped indexing at the 8 MB cap; some files were not scanned.",
    body:
`The cross-check loads scanned source files into an in-memory haystack
capped at 8 MB total. When the cap is hit mid-walk, indexing stops and
this warning fires. Drift in unscanned files cannot be detected.

For monorepos and other large repos, the right fix is usually to split
into cascading sub-.anatomy files via the v0.3 ecosystem (see
spec/0.3/cascading.md). Each sub-.anatomy describes its own subtree
and the cross-check scopes to that subtree, which keeps each scan well
under the cap.

If splitting isn't viable and the cap is hurting in practice, file an
issue describing the use case — the cap can be raised, but raising it
universally also slows the check on every validate call. To gate CI on
this warning (e.g., to refuse to ship a config where drift is hidden),
run \`anatomy validate --strict\`.`,
  },
  "verify-glob-empty": {
    severity: "warning",
    summary: "A rule's verify clause expected at least one file to match the given glob, but no files matched.",
    body:
`A rule's verify clause expected at least one file to match the given glob, but no files matched.

Common causes:
  - The convention this rule documents has not been applied yet.
  - The glob pattern is wrong (e.g., wrong directory or extension).
  - The expected files were renamed or moved without updating the .anatomy.

To fix, either correct the rule + verify clause, or add the files the rule promises.`,
  },
  "verify-glob-unexpected-files": {
    severity: "warning",
    summary: "A rule's verify clause with should_not = true expected zero matches, but found files.",
    body:
`A rule's verify clause with should_not = true expected zero matches, but found files.

The named files violate the rule's stated convention. Either remove the files, move
them out of the forbidden glob, or update the rule to acknowledge the exceptions.`,
  },
  "verify-glob-outside-container": {
    severity: "warning",
    summary: "A rule's verify clause asserted that files matching one glob must all live inside another, but some files were found outside the container.",
    body:
`A rule's verify clause asserted that files matching one glob must all live inside
another, but some files were found outside the container.

Either move the offending files into the expected location, or relax the rule's
container glob to admit them.`,
  },
  "verify-pattern-not-matched": {
    severity: "warning",
    summary: "A rule's ast_pattern verify clause expected the pattern to match at least once in the given glob, but found zero occurrences.",
    body:
`A rule's ast_pattern verify clause expected the pattern to match at least once in
the given glob, but found zero occurrences.

Either the convention the rule documents has not been applied, or the pattern is
malformed (check verify-invalid-pattern for parse errors).`,
  },
  "verify-pattern-found-where-forbidden": {
    severity: "warning",
    summary: "A rule's ast_pattern verify clause forbade matches in the given glob, but matches were found at the named locations.",
    body:
`A rule's ast_pattern verify clause forbade matches in the given glob, but matches
were found at the named locations.

Either remove the matching code, move it to an allowed location, or update the rule.`,
  },
  "verify-ast-grep-unavailable": {
    severity: "warning",
    summary: "A rule with verify.kind = \"ast_pattern\" was encountered, but @ast-grep/napi is not installed or not available for this platform.",
    body:
`A rule with verify.kind = "ast_pattern" was encountered, but @ast-grep/napi is not
installed (or the native binary is missing for this platform). The rule was skipped.

To enable: npm install --save-optional @ast-grep/napi
(or remove the verify clause if AST-based verification isn't needed).

This warning is NOT elevated to an error under --strict, since it's an environment
issue, not source drift.`,
  },
  "verify-invalid-pattern": {
    severity: "warning",
    summary: "A rule's ast_pattern verify clause could not be parsed by ast-grep.",
    body:
`A rule's ast_pattern verify clause could not be parsed by ast-grep. The named error
indicates the pattern syntax is malformed.

This is an author bug, not source drift, so it stays as a warning even under --strict.
Fix the verify pattern (see https://ast-grep.github.io/ for pattern syntax).`,
  },
  "verify-source-scan-truncated": {
    severity: "warning",
    summary: "Reserved: the verify check would stop scanning source files if a byte budget were exceeded.",
    body:
`The verify check would stop scanning source files if a byte budget were exceeded.
The current verifier implementation uses a per-file 256 KB cap with silent skipping
and does not emit this warning. The code is reserved for a future cross-file budget
tracking implementation.`,
  },
  // v0.13 semgrep verify codes:
  "verify-semgrep-unavailable": {
    severity: "warning",
    summary: "A rule with verify.kind = \"semgrep\" was encountered, but the semgrep binary is not on PATH (or invocation failed in an unrecognized way).",
    body:
`A rule with verify.kind = "semgrep" tried to run, but the semgrep binary is not on
PATH (or invocation failed: timeout, invalid JSON, exit with unrecognized error).
The rule was skipped rather than failing validation.

To enable: install semgrep ('pip install semgrep' or 'brew install semgrep').
If you don't intend to use semgrep, set the verify field to a different kind
(ast_pattern, glob_exists, glob_only) or remove it.

This warning is NOT elevated to an error under --strict, since it's an environment
issue, not source drift.`,
  },
  "verify-invalid-rule-file": {
    severity: "warning",
    summary: "Semgrep rejected the YAML rule file pointed to by verify.rule_file (parse error, missing required field, etc.).",
    body:
`Semgrep rejected the YAML rule file pointed to by verify.rule_file. The named error
indicates the rule file is malformed or missing required fields.

rule_file content is opaque to anatomy — semgrep validates it on load. To debug:
  semgrep --validate --config path/to/your-rule.yml

See https://semgrep.dev/docs/writing-rules/rule-syntax/ for the YAML schema.

This is an author bug, not source drift, so it stays as a warning even under --strict.`,
  },
  "verify-rule-file-missing": {
    severity: "warning",
    summary: "The verify.rule_file path does not exist or is not readable at the resolved location.",
    body:
`Anatomy resolves rule_file relative to repo root and calls fs.access before invoking
semgrep. The named path didn't exist or wasn't readable.

Confirm the rule_file path is correct (relative to repo root, not relative to the
.anatomy file's location). Use the resolved absolute path in the warning message to
debug. Conventional location: .semgrep/ at repo root.

This is an author bug, not source drift, so it stays as a warning even under --strict.`,
  },
  "verify-rule-file-outside-repo": {
    severity: "error",
    summary: "The verify.rule_file path resolves outside the repo root after normalization.",
    body:
`Anatomy refuses to load rule files from outside the repo. This is the only verify
code that is an ERROR rather than a warning, because:

  - It's not "the rule didn't match the source" — it's "we refused to invoke semgrep
    with this argument at all."
  - It indicates either a misconfigured path (the .anatomy is wrong) or a hostile
    .anatomy attempting to weaponize an external rule file.

Move the rule file inside the repo and update the rule_file path. Conventional
location: .semgrep/ at repo root. The error is the same in both --strict and
--no-strict modes.`,
  },
  "verify-no-files-matched": {
    severity: "warning",
    summary: "A semgrep verify clause's expect_in/forbid_in glob expanded to zero files; the rule was skipped.",
    body:
`The expect_in or forbid_in glob on a kind="semgrep" verify clause matched zero
files in the repo, so semgrep had nothing to scan. The rule was skipped.

Common causes:
  - The glob pattern is wrong (wrong directory or extension).
  - The expected files were renamed or moved without updating the .anatomy.
  - The code the rule applies to has not been written yet.

This warning IS elevated to an error under --strict, since it's the same source-drift
signal as verify-glob-empty: documented rule, no source for it to check against.`,
  },
};

export function explainCode(code: string): ErrorDoc | null {
  return DOCS[code] ?? null;
}

export function listAllCodes(): string[] {
  return Object.keys(DOCS).sort();
}
