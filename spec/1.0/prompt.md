# Anatomy Generation Prompt Template (v1.0)

**Status:** Normative for `.anatomy` v1.0 generation.

**Format note:** This spec document shows TOML output format for clarity and parity with the `.anatomy` file format. The actual in-source `SYSTEM_PROMPT` constant in `anatomy-cli/src/pass2/index.ts` requests JSON output, which is then parsed and merged into a `Pass1Result` by `applyAiFill` before being emitted as TOML by the renderer. The two representations are content-equivalent — same fields, same caps, same omit-if-no-evidence gate — but the wire format the model produces is JSON. Maintainers updating either side should keep them in sync; see `pass2-prompt-contract.md` for the contract.

This template is consumed verbatim by `anatomy-cli`'s Pass 2 (AI gap-fill). Provider plugins MAY adapt the API call shape but MUST NOT modify the prompt content. Updates require a minor schema bump or above.

The v1.0 base prompt is the v0.14 prompt extended with four new optional top-level array sections for uncapturable institutional knowledge: `[[vocabulary]]`, `[[invariants]]`, `[[anti_patterns]]`, `[[prerequisites]]`. The existing v0.14 RICH MODE block is unchanged — the new sections are emitted by DEFAULT (not gated behind `--rich`) because each captures content the v0.7+ "uncapturable from source" principle targets.

The v1.0 generation flow has TWO modes:

- **Default**: identical Pass 2 emission as v0.13. The new optional fields are emitted only when trivially derivable (e.g., `license` from `package.json`); the model is NOT asked to chase README content for them. This preserves the v0.7 "uncapturable from source" principle.
- **Rich (`--rich` flag)**: anatomy-cli appends the **RICH MODE** block (defined below) to the user prompt. Pass 2 is then asked to fill the new fields aggressively from README/manifest/docs evidence. This is for cold-generation parity with hand-curated `.anatomy` files.

The v0.13 verify-clause rule still applies: Pass 2 MUST NOT emit verify clauses — they are author-written.

Authors choosing between verifier kinds:

- `glob_exists` / `glob_only` — file/path-shape rules. No external dependency.
- `ast_pattern` — TS/JS-family rules using ast-grep (optional npm `@ast-grep/napi`).
- `semgrep` with inline `pattern` + `lang` — non-JS-family languages
  (`py`, `go`, `java`, `rb`, `c`, `cpp`, `rs`) ast-grep's napi build doesn't
  cover. Requires `semgrep` CLI on PATH.
- `semgrep` with `rule_file` — any language. Use when the rule needs pattern
  combinators (`pattern-not`, `pattern-inside`), taint mode, or metavariable
  constraints inline patterns can't express. Rule file must live inside the
  repo and end in `.yml` or `.yaml`.

Identity, `[[rules]]`, `[[flows]]`, `[[decisions]]`, the optional `[operation]`, `[structure]`, `[environment]` sections, and the rest of v0.12's output surface are unchanged.

---

## Template

The prompt is constructed by concatenating the FRAME below with a TOML serialization of the repo summary object produced by Pass 1.

```
You are filling in fields of a structured metadata file describing a software repository. Your output MUST be a single TOML block conforming to the format below — no preamble, no explanation, no markdown fences other than the TOML block itself.

The repository's Stack (technology) has already been determined deterministically by static analysis and is provided in the REPOSITORY SUMMARY below. You are filling in the remaining identity fields plus optional operation/structure/environment fields where evidence supports them, plus the high-value rules/flows/decisions fields that capture knowledge a reader cannot infer from source code alone.

REQUIRED OUTPUT FIELDS:

- form: the architectural shape of this repository.
  Common values: library, framework, cli-tool, service, sdk, plugin, app, extension, monorepo.
  Novel values are permitted; prefer the conventional list when applicable.

- domain: the problem space this repository operates in (NOT the technology used).
  Examples: web-publishing, fintech, machine-learning, devops, gaming, scientific, security.

- function: a concise, action-oriented identifier of what this repository specifically does.
  Examples: markdown-to-static-html, distributed-key-value-store, graphql-api-server.

- tagline: a single-line summary of the repository, <= 120 characters, no newlines.
  This is what an aggregator displays when listing many repos.

HIGH-VALUE FIELDS (the v0.7 additions, retained — emit when evidence supports them):

- rules: 1-20 project-specific guardrails that would surprise a contributor and CANNOT be derived from
  reading the code structure alone. Each is { rule: string <= 300 chars, why?: string <= 200 chars }.
  The rule should be directive ("do X" / "don't Y" / "always Z"); the why should explain the reason
  (often a past incident or strong preference). Examples:
    - rule = "spawnSync calls to git or external CLIs must pass shell: true on Windows for .cmd shim resolution"
      why = "memory entry t9ykw3em — npm-installed CLIs don't resolve as plain executables on Windows"
    - rule = "Hand-roll TOML output when section order matters; do not use smol-toml.stringify"
      why = "smol-toml does not preserve insertion order; section order is normative per spec section 5"
  Do NOT restate things obvious from the source ("uses TypeScript", "follows REST conventions").

- flows: 1-15 end-to-end workflows that span multiple subsystems and would require reading 4+ files
  to reconstruct. Each is { name: slug <= 40 chars, summary: single-line <= 300 chars }. The summary
  should describe the data/control flow as a sequence connected by arrows ("→") or commas. Examples:
    - name = "validate-pipeline"
      summary = "TOML parse → version-routed schema → fingerprint check → path checks → return errors+warnings"
    - name = "request-handling"
      summary = "middleware chain → router match → controller → repository.fetch → serializer → response"

- decisions: 1-15 architectural rationales — the WHY behind a choice, not the WHAT. Each is
  { topic: string <= 120 chars, reason: string <= 400 chars }. Draw from CONTRIBUTING files, design
  docs, prominent commit messages, and inline comments tagged with "decision:" / "trade-off:" /
  "we chose X because". Examples:
    - topic = "Hand-rolled TOML renderer in anatomy-cli"
      reason = "smol-toml.stringify does not preserve insertion order; section order is normative per spec section 5 and load-bearing for human readability."
    - topic = "v0.3 is an ecosystem release, not a wire version"
      reason = "v0.3 added cascading discovery + merge semantics for multi-.anatomy repos but did not change the per-file format. Files in v0.3 cascades declare anatomy_version = '0.2'. There is no '0.3' wire version."

- vocabulary: 1-30 project-coined or load-bearing terms that an external reader will encounter in the codebase and could MISINTERPRET if applied with their conventional meaning. Each is { term: string <= 80 chars, meaning: string <= 300 chars, aliases?: string[], contrast?: string[] }. Use `aliases` for alternative casings or recognized synonyms. Use `contrast` for "not to be confused with X" — most term confusions are "X vs Y in this codebase" and stating the contrast directly is uncapturable from source. Bar: only *contested*, *invented*, or *load-bearing-for-conversation* terms. Do NOT list every public class. Examples:
    - term = "Layer"
      meaning = "A node in the router stack pairing a path pattern with a middleware fn."
      contrast = ["not Middleware (which is the fn the Layer carries)"]

- invariants: 1-15 cross-file conditions — "when you change X, also update Y and Z" — that no single file states. Each is { invariant: string <= 300, triggered_by?: string[] (≤5 globs, each <= 200), affected_paths?: string[] (≤5 path strings, each <= 200), why?: string <= 200 }. The `triggered_by` globs MUST come from Pass 1's structure-survey hints — no hallucinated paths. Examples:
    - invariant = "Adding a new HTTP method requires updates in router/methods.js, lib/application.js, AND test/app.router.js."
      triggered_by = ["lib/application.js", "router/methods.js"]
      affected_paths = ["test/app.router.js"]

- anti_patterns: 1-12 approaches that were tried and rejected, OR class-of-approaches the maintainers explicitly avoid. Each is { pattern: string <= 300, reason: string <= 400, instead?: string <= 300, keywords?: string[] (≤5 lowercase strings, each ≤60) }. The `keywords` field aids agent-side detection when a query describes the rejected approach. Lowest expected hit rate; many repos won't have any — that's fine; omit. Examples:
    - pattern = "Wrapping req/res in subclass objects"
      instead = "Mutate prototype on app.request / app.response via Object.create"
      reason = "Prototype chains preserve instanceof and allow per-app isolation; wrappers force per-request allocation."
      keywords = ["wrapper", "subclass", "extend request"]

- prerequisites: 1-10 domain or library concepts the codebase ASSUMES the reader is familiar with — Node streams, HTTP semantics, gRPC, monad transformers, etc. Each is { topic: string <= 120, why: string <= 200, link?: string URL <= 300 }. Distinct from [[decisions]] (the repo's design choices) and [substance] (dependency facts). Sourced from README "Background" / "Prerequisites" / "Before contributing" sections, or dependency README links. Examples:
    - topic = "Node.js streams"
      why = "res.sendFile and pipeline middleware assume reader familiarity with Readable/Writable backpressure."
      link = "https://nodejs.org/api/stream.html"

Omit any of rules/flows/decisions/vocabulary/invariants/anti_patterns/prerequisites entirely if you cannot find at least one item that meets the
"uncapturable from source" bar. Do not pad with derivable observations to hit a count.

OPTIONAL OUTPUT FIELDS (fill only when evidence in the REPOSITORY SUMMARY supports them):

- description: a longer free-form summary, multi-line allowed, <= 2000 characters. Used when the consumer has selected this repo and wants more than the tagline.

- entry_points: 1-5 entries; each { path, role, purpose? }. Paths MUST be from Pass 1's structure-survey hints (no hallucinated paths). Roles SHOULD use well-known values (cli, library-root, service-main, test-main, worker, script) when applicable. The 'purpose' field is a one-line phrase, <= 80 characters.

- commands: keys SHOULD use well-known names (install, build, test, lint, format, run, dev) when applicable. v0.2+ permits one level of dotted namespacing (e.g., test.unit, test.integration). Values are exact shell commands drawn from manifest scripts / Makefile / justfile.

- conventions: keys SHOULD use well-known names (style, commits, branch, versioning) when applicable.

- structure: 1-25 entries of { path, purpose, kind } describing top-level directories. 'kind' MUST be one of: source, tests, docs, config, build, scripts, examples, generated, other. The 'purpose' is a single-line phrase (<= 120 chars). Prefer fewer entries with informative purposes over many shallow ones. Paths MUST come from Pass 1's structure-survey hints.

- environment: declare ONLY the sub-fields whose evidence is present in the REPOSITORY SUMMARY. Available sub-fields:
  * language_version: free-form constraint (e.g., ">=20", "^1.75", "3.11.*")
  * runtime: canonical-form id (e.g., node, bun, deno, cpython, jvm)
  * os: array of one or more of [linux, macos, windows, freebsd] — OR the singleton ["any"]
  * required_services: 1-10 entries of { name, why } — only services whose absence prevents the repo from running
  * required_env: 1-25 entries of { name, why } — only environment variables whose absence breaks something. Names MUST match POSIX env-var regex.

- structure.entries[].convention: for entries where the directory has a clear, consistent
  file organisation pattern, add a one-line description (max 200 chars). Omit if the
  pattern is not evident from the file listing.

CONSTRAINTS:

- All pillar IDs (form, domain, function), all role/key strings in operation.entry_points / operation.commands / operation.conventions, and all flow names MUST match: ^[a-z0-9]+(-[a-z0-9]+)*$
- operation.commands keys may additionally include one dot for namespacing: ^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)?$
- environment.language_version is NOT subject to the slug regex — emit verbatim.
- environment.required_env[].name MUST match POSIX env-var regex: ^[A-Za-z_][A-Za-z0-9_]*$
- environment.os and structure.entries[].kind are closed enums — values outside the enum are rejected.
- tagline, description, conventions values, commands values, structure.entries[].purpose, rules[].rule, rules[].why, flows[].summary, decisions[].topic, decisions[].reason, vocabulary[].term, vocabulary[].meaning, vocabulary[].aliases, vocabulary[].contrast, invariants[].invariant, invariants[].why, anti_patterns[].pattern, anti_patterns[].instead, anti_patterns[].reason, anti_patterns[].keywords, prerequisites[].topic, prerequisites[].why, prerequisites[].link all have explicit max-length caps documented in the schema; respect them.
- rules[].rule, decisions[].reason, description, vocabulary[].meaning, invariants[].invariant, invariants[].why, anti_patterns[].pattern, anti_patterns[].instead, anti_patterns[].reason, prerequisites[].why support multi-line content; everything else is single-line (no newlines).
- The fingerprint field is computed by the CLI from the four pillars and MUST NOT be emitted by the model.

If you cannot confidently determine a value for any field, OMIT that field rather than guess. The CLI surfaces missing required fields as validation errors; absent optional fields are fine.

OUTPUT FORMAT (TOML, exactly the field set requested above; emit nothing else):

```
form = "<id-string>"
domain = "<id-string>"
function = "<id-string>"
tagline = "<single-line summary <= 120 chars>"

# All other top-level groups OPTIONAL — emit only when supported by evidence.

description = """
<longer free-form description>
"""

[[operation.entry_points]]
path = "..."
role = "..."
purpose = "..."

[operation.commands]
install = "..."
"test.unit" = "..."

[operation.conventions]
style = "..."

[[structure.entries]]
path = "src/"
purpose = "..."
kind = "source"
convention = "..."    # optional — omit if pattern not evident

[environment]
language_version = "..."
runtime = "..."
os = ["linux", "macos"]

[[environment.required_services]]
name = "..."
why = "..."

[[environment.required_env]]
name = "..."
why = "..."

# High-value v0.7+ sections — emit when evidence supports them.

[[rules]]
rule = "..."
why = "..."    # optional — explain the reason (past incident, strong preference)

[[flows]]
name = "..."
summary = "..."

[[decisions]]
topic = "..."
reason = "..."

[[vocabulary]]
term = "..."
meaning = "..."
aliases = ["..."]    # optional
contrast = ["..."]   # optional

[[invariants]]
invariant = "..."
triggered_by = ["..."]    # optional glob array
affected_paths = ["..."]  # optional
why = "..."               # optional

[[anti_patterns]]
pattern = "..."
reason = "..."
instead = "..."   # optional
keywords = ["..."]  # optional

[[prerequisites]]
topic = "..."
why = "..."
link = "..."    # optional
```

REPOSITORY SUMMARY:

<repo summary TOML inserted here>

EXISTING_AGENTS_MD (optional, present only if the repository has a hand-written AGENTS.md at its root; truncated to 3000 chars):

<existing AGENTS.md content inserted here, or this section is omitted>

When EXISTING_AGENTS_MD is present, treat it as authoritative for commands, structure summaries, and rules that align with the anatomy schema. Reconcile against the manifest + README when they disagree — manifest wins on commands; README wins on description; existing AGENTS.md wins on rules, conventions, vocabulary, invariants, anti_patterns, prerequisites, and any glob-scoped guidance. Do not invent values for the optional `[generate]` block — leave it absent.

Now produce the TOML output.
```

---

## RICH MODE block

When the CLI invokes Pass 2 with `--rich`, anatomy-cli appends the following block to the user prompt. Default Pass 2 omits it entirely; the block exists as a discrete addendum so the v0.7 "uncapturable from source" principle still governs default generation.

```
## RICH MODE

When this block is present, ADDITIONAL output is required where evidence supports it (omit otherwise).

REQUIRED RICH FIELDS:

- description: 200-500 word free-form summary lifted from README intro voice
- author: maintainer name or org (string, ≤200 chars) — from README "by …", package.json author, LICENSE attribution
- license: SPDX identifier or descriptive string (≤100 chars) — from LICENSE/package.json/README badge
- docs_url: documentation site URL (≤300 chars) — from README "Documentation:" or package.json "homepage"
- repository_url: source repository URL (≤300 chars) — from package.json "repository.url"

operation.commands MUST include "install" if obvious from README. operation.commands SHOULD include "dev" or "quickstart" if README has a clear first-run.

substance.key_dependencies MUST include the top 3-7 runtime deps, each { name, version (verbatim from manifest), why (≤80 chars from README context) }.

OUTPUT ADDITIONS (rich mode only):

\`\`\`
author = "..."
license = "..."
docs_url = "..."
repository_url = "..."

[[substance.key_dependencies]]
name = "..."
version = "..."
why = "..."
\`\`\`

Omit any field with no clear evidence rather than guess.
```

The CLI keeps the canonical RICH MODE block string in source (`anatomy-cli/src/pass2/index.ts` constant `RICH_MODE_BLOCK`) so the binary works without the spec/ tree alongside. This document is the normative reference for what that constant must contain.

---

## Versioning

This prompt template is published at `https://anatomy.dev/spec/1.0/prompt.md` and is part of the v1.0 schema contract. Any change to the prompt requires bumping `anatomy_version` to `1.1` (additive) or `2.0` (breaking).

## Why this shape

- **Stack already resolved** — wasted tokens removed.
- **Optional fields gated on evidence** — preserves data quality at scale.
- **No chain-of-thought / preamble** — the CLI parses with a TOML parser; free-form prose breaks parsing.
- **Constraints inline** — every constraint the validator enforces is also stated in the prompt.
- **Path provenance** — entry_points and structure paths must match Pass 1 hints, eliminating hallucinated paths.
- **Rules / flows / decisions are gated on the "uncapturable from source" bar** — this is the v0.7 reorientation, retained. The model is explicitly told not to pad with derivable observations to hit a count, because that's what `[[insights]]` failed at in v0.6, what `[code_profile]` and `substance.capabilities`/`limitations` failed at in v0.7, and what `[interface]`/`[domain_model]`/`[substance.key_dependencies]` failed at in the 2026-05-09 cross-repo N=3 eval (0/27, 0/27, 1/27 cites).
- **Fingerprint is CLI-computed** — the model must not emit it; the CLI derives it deterministically from the four pillar strings via `fingerprintFromPillars`.
- **Rich mode is opt-in** — by default, Pass 2 emits only the v0.7-principled "uncapturable from source" shape. The RICH MODE block above is appended by the CLI ONLY when `--rich` is passed, allowing aggressive emission of README-derivable quick-reference fields (author, license, docs URL, install command, key dependencies with versions) for cold-generation parity with hand-curated `.anatomy` files. The principle holds for default mode; rich mode is a deliberate carve-out for stable identifying facts (license, author, docs URL) that don't rot with the code.
