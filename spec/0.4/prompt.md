# Anatomy Generation Prompt Template (v0.4)

**Status:** Normative for `.anatomy` v0.4 generation.

This template is consumed verbatim by `anatomy-cli`'s Pass 2 (AI gap-fill). Provider plugins MAY adapt the API call shape but MUST NOT modify the prompt content. Updates require a minor schema bump or above.

---

## Template

The prompt is constructed by concatenating the FRAME below with a TOML serialization of the repo summary object produced by Pass 1.

```
You are filling in fields of a structured metadata file describing a software repository. Your output MUST be a single TOML block conforming to the format below — no preamble, no explanation, no markdown fences other than the TOML block itself.

The repository's Stack (technology) has already been determined deterministically by static analysis and is provided in the REPOSITORY SUMMARY below. You are filling in the remaining identity fields plus optional operation/substance/structure/environment/interface/domain_model/code_profile fields where evidence supports them.

REQUIRED OUTPUT FIELDS:

- form: the architectural shape of this repository.
  Common values: library, framework, cli-tool, service, sdk, plugin, app, extension.
  Novel values are permitted; prefer the conventional list when applicable.

- domain: the problem space this repository operates in (NOT the technology used).
  Examples: web-publishing, fintech, machine-learning, devops, gaming, scientific, security.

- function: a concise, action-oriented identifier of what this repository specifically does.
  Examples: markdown-to-static-html, distributed-key-value-store, graphql-api-server.

- tagline: a single-line summary of the repository, <= 120 characters, no newlines.
  This is what an aggregator displays when listing many repos.

OPTIONAL OUTPUT FIELDS (fill only when evidence in the REPOSITORY SUMMARY supports them):

- description: a longer free-form summary, multi-line allowed, <= 2000 characters. Used when the consumer has selected this repo and wants more than the tagline.

- entry_points: 1-5 entries; each { path, role, purpose? }. Paths MUST be from Pass 1's structure-survey hints (no hallucinated paths). Roles SHOULD use well-known values (cli, library-root, service-main, test-main, worker, script) when applicable. The 'purpose' field replaces v0.1's 'description' (a one-line phrase, <= 80 characters).

- commands: keys SHOULD use well-known names (install, build, test, lint, format, run, dev) when applicable. v0.2 additionally permits one level of dotted namespacing (e.g., test.unit, test.integration). Values are exact shell commands drawn from manifest scripts / Makefile / justfile.

- conventions: keys SHOULD use well-known names (style, commits, branch, versioning) when applicable.

- key_dependencies: 3-7 architecture-shaping deps drawn from the manifest top-level. Each { name, why }. The 'why' is a one-phrase architectural-role annotation.

- capabilities: 3-7 short plain-English claims of what the repo CAN do, drawn from README features sections, examples directory, and exported API surface. Each { phrase, source? }. The 'source' may be either the v0.1 string form ("path#fragment") or the v0.2 structured form ({ path, symbol }). Prefer the structured form when emitting new content.

- limitations: short plain-English claims of what the repo CANNOT do or deliberately does NOT support, drawn primarily from README "Limitations" / "Non-goals" sections plus manifest constraints (engines, [target]). Same { phrase, source? } shape as capabilities.

- structure: 1-25 entries of { path, purpose, kind } describing top-level directories. 'kind' MUST be one of: source, tests, docs, config, build, scripts, examples, generated, other. The 'purpose' is a single-line phrase (<= 120 chars). Prefer fewer entries with informative purposes over many shallow ones. Paths MUST come from Pass 1's structure-survey hints.

- environment: declare ONLY the sub-fields whose evidence is present in the REPOSITORY SUMMARY. Available sub-fields:
  * language_version: free-form constraint (e.g., ">=20", "^1.75", "3.11.*")
  * runtime: canonical-form id (e.g., node, bun, deno, cpython, jvm)
  * os: array of one or more of [linux, macos, windows, freebsd] — OR the singleton ["any"]
  * required_services: 1-10 entries of { name, why } — only services whose absence prevents the repo from running
  * required_env: 1-25 entries of { name, why } — only environment variables whose absence breaks something. Names MUST match POSIX env-var regex.

- interface: emit EXACTLY ONE variant matching the repo's form (per the form↔variant matrix in spec section 7.2):
  * form id contains 'cli' → emit interface.subcommands ([{ name, summary }])
  * form id contains 'api' → emit interface.endpoints ([{ method, path, summary }])
  * form id contains 'service' → emit interface.endpoints
  * form id contains 'library' → emit interface.exports ([{ symbol, kind, summary }])
  * anything else → OMIT [interface] entirely
  Tiebreak: top-to-bottom, first match wins. A form id like 'cli-library' matches 'cli' first.

- domain_model: 1-25 entries of { name, summary } naming the repository's central entities (e.g., for a CRM: Account, Contact, Deal). The 'summary' is a 1-2 sentence definition (<= 200 chars). Names are emitted verbatim — case and language-specific punctuation matter.

- code_profile: emit EXACTLY ONE variant (per the form-to-variant dispatch table
  below). Omit entirely if variant is "none" or signals block is absent.

  DISPATCH TABLE (first match wins):
  1. form id contains 'cli'                                     → [code_profile.commands]
  2. form id contains 'api' or 'service'                        → [code_profile.endpoints]
  3. form id contains 'library' AND stack id in UI_FRAMEWORK_LIST  → [code_profile.components]
  4. form id contains 'library', 'sdk', or 'framework'          → [code_profile.exports]
  none of the above                                             → OMIT [code_profile]

  UI_FRAMEWORK_LIST: react, vue, svelte, angular, solid, qwik, preact, lit,
                     ember, next, nuxt

CONSTRAINTS for code_profile:
- count MUST equal code_profile_signals.count from the repo summary. Never estimate.
- sample entries MUST come from code_profile_signals.raw_names. Never hallucinate names.
- styling MUST match ^[a-z0-9]+(-[a-z0-9]+)*$; use detected_styling if present, else omit.
- auth_scheme MUST match ^[a-z0-9]+(-[a-z0-9]+)*$; use detected_auth if present, else omit.
- max_depth: emit only if code_profile_signals.max_depth is present (value >= 2). Do not emit max_depth = 1.
- sample: omit the key entirely when raw_names is empty or absent. Do not emit sample = [].
- endpoints sample strings MUST follow "METHOD /path" format.

CONSTRAINTS:

- All pillar IDs (form, domain, function) and all role/key strings in operation.entry_points / operation.commands / operation.conventions MUST match: ^[a-z0-9]+(-[a-z0-9]+)*$
- operation.commands keys may additionally include one dot for namespacing: ^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)?$
- key_dependencies[].name, interface.exports[].symbol, interface.endpoints[].path, domain_model.entities[].name, environment.language_version are NOT subject to that regex — emit verbatim.
- environment.required_env[].name MUST match POSIX env-var regex: ^[A-Za-z_][A-Za-z0-9_]*$
- interface.exports[].kind, interface.endpoints[].method, environment.os, structure.entries[].kind are closed enums — values outside the enum are rejected.
- tagline, description, capabilities[].phrase, limitations[].phrase, conventions values, commands values, key_dependencies[].why, structure.entries[].purpose, interface.*.summary, domain_model.entities[].summary all have explicit max-length caps documented in the schema; respect them.

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

[[substance.key_dependencies]]
name = "..."
why = "..."

[[substance.capabilities]]
phrase = "..."
source = { path = "...", symbol = "..." }

[[substance.limitations]]
phrase = "..."

[[structure.entries]]
path = "src/"
purpose = "..."
kind = "source"

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

# Pick exactly ONE [interface] variant matching the form.
[[interface.exports]]
symbol = "..."
kind = "function"
summary = "..."

[[interface.endpoints]]
method = "POST"
path = "/..."
summary = "..."

[[interface.subcommands]]
name = "..."
summary = "..."

[[domain_model.entities]]
name = "..."
summary = "..."

# Emit exactly ONE [code_profile.*] variant based on the dispatch table.
# Omit entirely if no variant matches or signals block is absent.
[code_profile.commands]
count = <integer from signals>
max_depth = <integer >= 2, omit if absent>
sample = ["<command-name>", ...]

[code_profile.components]
count = <integer from signals>
styling = "<canonical-form string, omit if absent>"
sample = ["<ComponentName>", ...]

[code_profile.endpoints]
count = <integer from signals>
auth_scheme = "<canonical-form string, omit if absent>"
sample = ["METHOD /path", ...]

[code_profile.exports]
count = <integer from signals>
sample = ["<exportName>", ...]
```

REPOSITORY SUMMARY:

<repo summary TOML inserted here>

Now produce the TOML output.
```

---

## Versioning

This prompt template is published at `https://anatomy.dev/spec/0.4/prompt.md` and is part of the v0.4 schema contract. Any change to the prompt requires bumping `anatomy_version` to `0.5` (additive) or `1.0` (breaking).

## Why this shape

- **Stack already resolved** — wasted tokens removed.
- **Optional fields gated on evidence** — preserves data quality at scale.
- **No chain-of-thought / preamble** — the CLI parses with a TOML parser; free-form prose breaks parsing.
- **Constraints inline** — every constraint the validator enforces is also stated in the prompt.
- **Path provenance** — entry_points and structure paths must match Pass 1 hints, eliminating hallucinated paths.
- **Form-conditional [interface]** — the model is told the matching rule explicitly to avoid emitting the wrong variant.
- **Form-conditional [code_profile]** — the dispatch table is verbatim so the model emits exactly the right variant; count and sample names are sourced from signals to prevent hallucination.
