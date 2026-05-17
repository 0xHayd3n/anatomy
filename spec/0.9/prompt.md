# Anatomy Generation Prompt Template (v0.9)

**Status:** Normative for `.anatomy` v0.9 generation.

This template is consumed verbatim by `anatomy-cli`'s Pass 2 (AI gap-fill). Provider plugins MAY adapt the API call shape but MUST NOT modify the prompt content. Updates require a minor schema bump or above.

The v0.9 prompt differs from v0.8 in three deletions:
- `[[interface.*]]` variants (exports / endpoints / subcommands) — **removed**. The 2026-05-09 cross-repo N=3 eval cited `[interface]` in 0 of 27 treatment trials. Form-conditional emit logic gone with it.
- `[[domain_model.entities]]` — **removed**. Same eval, 0 of 27 cites. Entity nouns are derivable from README + type definitions on every read.
- `[[substance.key_dependencies]]` — **removed**. Same eval, 1 of 27 cites (within ±15% noise floor). Direct deps are derivable from the manifest top-level on every read.

Identity, `[[rules]]`, `[[flows]]`, `[[decisions]]`, the optional `[operation]`, `[structure]`, `[environment]` sections, and the rest of v0.8's surface are unchanged.

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

Omit any of rules/flows/decisions entirely if you cannot find at least one item that meets the
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
- tagline, description, conventions values, commands values, structure.entries[].purpose, rules[].rule, rules[].why, flows[].summary, decisions[].topic, decisions[].reason all have explicit max-length caps documented in the schema; respect them.
- rules[].rule, decisions[].reason, and description support multi-line content; everything else is single-line (no newlines).
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
```

REPOSITORY SUMMARY:

<repo summary TOML inserted here>

Now produce the TOML output.
```

---

## Versioning

This prompt template is published at `https://anatomy.dev/spec/0.9/prompt.md` and is part of the v0.9 schema contract. Any change to the prompt requires bumping `anatomy_version` to `0.10` (additive) or `1.0` (breaking).

## Why this shape

- **Stack already resolved** — wasted tokens removed.
- **Optional fields gated on evidence** — preserves data quality at scale.
- **No chain-of-thought / preamble** — the CLI parses with a TOML parser; free-form prose breaks parsing.
- **Constraints inline** — every constraint the validator enforces is also stated in the prompt.
- **Path provenance** — entry_points and structure paths must match Pass 1 hints, eliminating hallucinated paths.
- **Rules / flows / decisions are gated on the "uncapturable from source" bar** — this is the v0.7 reorientation, retained. The model is explicitly told not to pad with derivable observations to hit a count, because that's what `[[insights]]` failed at in v0.6, what `[code_profile]` and `substance.capabilities`/`limitations` failed at in v0.7, and what `[interface]`/`[domain_model]`/`[substance.key_dependencies]` failed at in the 2026-05-09 cross-repo N=3 eval (0/27, 0/27, 1/27 cites).
- **Fingerprint is CLI-computed** — the model must not emit it; the CLI derives it deterministically from the four pillar strings via `fingerprintFromPillars`.
