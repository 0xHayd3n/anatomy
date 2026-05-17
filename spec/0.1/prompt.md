# Anatomy Generation Prompt Template (v0.1)

**Status:** Normative for `.anatomy` v0.1 generation.

This template is consumed verbatim by `anatomy-cli`'s Pass 2 (AI gap-fill). Provider plugins MAY adapt the API call shape but MUST NOT modify the prompt content. Updates require a minor schema bump or above.

---

## Template

The prompt is constructed by concatenating the FRAME below with a TOML serialization of the repo summary object produced by Pass 1.

```
You are filling in fields of a structured metadata file describing a software repository. Your output MUST be a single TOML block conforming to the format below — no preamble, no explanation, no markdown fences other than the TOML block itself.

The repository's Stack (technology) has already been determined deterministically by static analysis and is provided in the REPOSITORY SUMMARY below. You are filling in the remaining identity fields plus optional operation/substance fields where evidence supports them.

REQUIRED OUTPUT FIELDS:

- form: the architectural shape of this repository.
  Common values: library, framework, cli-tool, service, sdk, plugin, app, extension.
  Novel values are permitted; prefer the conventional list when applicable.

- domain: the problem space this repository operates in (NOT the technology used).
  Examples: web-publishing, fintech, machine-learning, devops, gaming, scientific, security.

- function: a concise, action-oriented identifier of what this repository specifically does.
  Examples: markdown-to-static-html, distributed-key-value-store, graphql-api-server.

- description: a 1-3 sentence plain-text summary. No marketing language. No bullet points. <= 500 characters.

OPTIONAL OUTPUT FIELDS (fill only when evidence in the REPOSITORY SUMMARY supports them):

- entry_points: 1-5 entries; each { path, role, description? }. Paths MUST be from Pass 1's structure-survey hints (no hallucinated paths). Roles SHOULD use well-known values (cli, library-root, service-main, test-main, worker, script) when applicable.

- commands: keys SHOULD use well-known names (install, build, test, lint, format, run, dev) when applicable. Values are exact shell commands drawn from manifest scripts / Makefile / justfile.

- conventions: keys SHOULD use well-known names (style, commits, branch, versioning) when applicable.

- key_dependencies: 3-7 architecture-shaping deps drawn from the manifest top-level. Each { name, why }. The 'why' is a one-phrase architectural-role annotation.

- capabilities: 3-7 short plain-English claims of what the repo CAN do, drawn from README features sections, examples directory, and exported API surface. Each { phrase, source? } where source is an optional path-with-fragment pointer to where the capability is evidenced. v0.1 makes 'source' optional; populate it manually if you can identify a clear source location.

- limitations: short plain-English claims of what the repo CANNOT do or deliberately does NOT support, drawn primarily from README "Limitations" / "Non-goals" sections plus manifest constraints (engines, [target]). Each { phrase, source? }.

CONSTRAINTS:

- All pillar IDs (form, domain, function) and all role/key strings in operation.entry_points / operation.commands / operation.conventions MUST match: ^[a-z0-9]+(-[a-z0-9]+)*$
- key_dependencies[].name is NOT subject to that regex — emit verbatim as in the manifest.
- description, capabilities[].phrase, limitations[].phrase, conventions values, commands values, key_dependencies[].why all have explicit max-length caps documented in the schema; respect them.

If you cannot confidently determine a value for any field, OMIT that field rather than guess. The CLI surfaces missing required fields as validation errors; absent optional fields are fine.

OUTPUT FORMAT (TOML, exactly the field set requested above; emit nothing else):

```
form = "<id-string>"
domain = "<id-string>"
function = "<id-string>"
description = """
<1-3 sentence plain-text description>
"""

# operation and substance optional; emit only when supported by evidence

[[operation.entry_points]]
path = "..."
role = "..."

[operation.commands]
install = "..."

[operation.conventions]
style = "..."

[[substance.key_dependencies]]
name = "..."
why = "..."

[[substance.capabilities]]
phrase = "..."

[[substance.limitations]]
phrase = "..."
```

REPOSITORY SUMMARY:

<repo summary TOML inserted here>

Now produce the TOML output.
```

---

## Versioning

This prompt template is published at `https://anatomy.dev/spec/0.1/prompt.md` and is part of the v0.1 schema contract. Any change to the prompt requires bumping `anatomy_version` to `0.2` (additive) or `1.0` (breaking).

## Why this shape

- **Stack already resolved** — wasted tokens removed.
- **Optional fields gated on evidence** — preserves data quality at scale.
- **No chain-of-thought / preamble** — the CLI parses with a TOML parser; free-form prose breaks parsing.
- **Constraints inline** — every constraint the validator enforces is also stated in the prompt.
- **Path provenance** — entry_points must match Pass 1 hints, eliminating hallucinated paths.
