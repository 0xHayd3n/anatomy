# Pass 2 Prompt Contract — v0.8

**Status:** Normative for `anatomy_version = "0.8"` Pass 2 generation.

This document fixes the LLM-call contract for the optional Pass 2 stage of
`anatomy generate --ai`. Any provider plugin (built-in or third-party) that
satisfies the input/output schema below produces output that the CLI can
merge into a v0.8 `.anatomy` file. Providers MAY adapt API call shape (chat
vs completion, function-calling, tool-use, vision) but MUST NOT modify the
prompt content or the response schema.

The reference implementation lives at
[`anatomy-cli/src/pass2/index.ts`](../../anatomy-cli/src/pass2/index.ts) and the
default provider at
[`anatomy-cli/src/pass2/providers/claude-cli.ts`](../../anatomy-cli/src/pass2/providers/claude-cli.ts).

---

## 1. Inputs

A provider receives one of each:

### 1.1 System prompt (frozen per schema version)

The exact string the runtime calls `SYSTEM_PROMPT` in
[`anatomy-cli/src/pass2/index.ts`](../../anatomy-cli/src/pass2/index.ts). The
content is byte-stable for a given schema version. Reproduced verbatim:

```
You are filling in missing fields in a .anatomy file — a machine-readable description of a software repository.

Rules:
- Only fill fields marked # TODO
- Be concise: structure purposes ≤120 chars, dependency whys ≤80 chars, interface summaries ≤120 chars
- identity_domain and identity_function must be lowercase hyphenated (e.g. "developer-tools", "static-site-generator")
- Do not invent details not supported by the provided context

Also emit rules, flows, and decisions — these are the highest-value sections:

rules: 2–5 non-obvious constraints or invariants that govern this codebase. These must be things that
  would surprise a contributor and CANNOT be derived from reading the code structure alone — implicit
  conventions, things that must never change, subtle constraints. Each { rule: string (≤300 chars), why?: string (≤200 chars) }.
  "why" is optional but powerful: include it when the reason is non-obvious.
  Omit the rules array entirely if fewer than 2 genuinely non-obvious rules exist.

flows: 1–4 cross-module data or control flows that a developer needs to understand to work in this codebase.
  Each { name: lowercase-hyphenated slug ≤40 chars, summary: one-line description of the flow path ≤300 chars }.
  Good flows describe HOW things move through the system, not WHAT exists.
  Omit if the codebase is too simple to have meaningful flows.

decisions: 1–4 architectural decisions with rationale — the WHY behind non-obvious choices.
  Each { topic: string ≤120 chars, reason: string ≤400 chars }.
  Only include decisions where the reason is non-obvious from the code; skip obvious ones.
  Omit if no meaningful decisions are evident.

Respond with ONLY a JSON object — no prose, no markdown fences. Schema:
{
  "identity_domain": "string (optional)",
  "identity_function": "string (optional)",
  "structure_purposes": { "<path>": "<purpose>" },
  "dependency_whys": { "<name>": "<why>" },
  "interface_summaries": { "<name or symbol>": "<summary>" },
  "rules": [{ "rule": "...", "why": "..." }],
  "flows": [{ "name": "...", "summary": "..." }],
  "decisions": [{ "topic": "...", "reason": "..." }]
}
```

A provider MUST send this string verbatim. Truncating, paraphrasing, or
adding instructions changes the contract; resulting `.anatomy` content
cannot be guaranteed v0.8-conformant.

### 1.2 User prompt (dynamic per repo)

Built by `buildContext()` in [`pass2/index.ts`](../../anatomy-cli/src/pass2/index.ts).
Concatenates, in order:

1. `## Fields to fill` — explicit list of TODO fields the model should produce.
2. `## Already known` — stack + form + tagline so the model has context.
3. `## README.md` (or `.rst`/`.txt`) — first ~8000 chars, badge/HTML noise stripped.
4. `## Repository config files` — names of significant top-level configs (tsconfig, dockerfile, vite, eslint, …).
5. `## Entry point: <path>` — first 15 lines of `src/index.ts` / `main.ts` / equivalent.
6. `## CI/CD` — `.github/workflows/*.yml` filenames + first 25 lines of up to 3.
7. `## Repository structure` — per-directory summary of immediate children (dirs + first 8 files).
8. `## Recent commits` — `git log` first ~30 commits, oneline form.
9. `## Test sample` — first ~30 lines of a test file under the entry point.
10. `## Imports sample` — head of the entry-point file's imports.

Sections are independently elidable; if Pass 1 finds no manifest, no README,
no `.git` directory, etc., the corresponding section is omitted and the
prompt remains parseable. Total length is uncapped but typically 2–10 KB.

### 1.3 Optional knobs

| Field | Default | Notes |
|---|---|---|
| `temperature` | `0` | Deterministic generation preferred. Providers MAY ignore if their API doesn't support it. |
| `maxOutputTokens` | `8000` | Generous to fit the JSON response with rules/flows/decisions. |
| `model` | provider-specific | Per-provider default; `claude-cli` inherits Claude Code's session model. |
| `seed` | unset | Honored when the provider supports it. Deterministic runs SHOULD set this. |

---

## 2. Output

A provider returns a single string. The CLI extracts JSON from that string
using one of three strategies (in order):

1. **Bare JSON.** The whole response is `JSON.parse`-able.
2. **Fenced JSON.** A `` ```json ... ``` `` block (or unlabeled fence) within
   the response.
3. **Embedded JSON.** The first `{...}` substring within the response.

Providers SHOULD return bare JSON for cleanliness, but the CLI tolerates all
three forms. There is no penalty for preamble/postamble — the extractor
strips it.

### 2.1 Output JSON schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "identity_domain":     { "type": "string", "pattern": "^[a-z0-9]+(-[a-z0-9]+)*$", "maxLength": 40 },
    "identity_function":   { "type": "string", "pattern": "^[a-z0-9]+(-[a-z0-9]+)*$", "maxLength": 40 },
    "structure_purposes":  { "type": "object", "additionalProperties": { "type": "string", "maxLength": 120 } },
    "dependency_whys":     { "type": "object", "additionalProperties": { "type": "string", "maxLength": 80 } },
    "interface_summaries": { "type": "object", "additionalProperties": { "type": "string", "maxLength": 120 } },
    "rules":     { "type": "array", "minItems": 2, "maxItems": 5,  "items": { "type": "object", "required": ["rule"], "properties": { "rule": { "type": "string", "maxLength": 300 }, "why":  { "type": "string", "maxLength": 200 } } } },
    "flows":     { "type": "array", "minItems": 1, "maxItems": 4,  "items": { "type": "object", "required": ["name", "summary"], "properties": { "name": { "type": "string", "pattern": "^[a-z0-9]+(-[a-z0-9]+)*$", "maxLength": 40 }, "summary": { "type": "string", "maxLength": 300 } } } },
    "decisions": { "type": "array", "minItems": 1, "maxItems": 4,  "items": { "type": "object", "required": ["topic", "reason"], "properties": { "topic": { "type": "string", "maxLength": 120 }, "reason": { "type": "string", "maxLength": 400 } } } }
  }
}
```

All top-level fields are optional. The CLI applies fills selectively:
fields not present in the response leave their Pass 1 placeholders intact.

### 2.2 Robustness rules

- The CLI's `extractJson` helper is the only normative parser. Providers
  don't need to know about extraction strategies.
- The CLI strips dangerous JSON.parse keys (`__proto__`, `constructor`,
  `prototype`) from the response before merging. Providers don't need to.
- Type mismatches (e.g. `rules` returned as a string) are silently dropped,
  not errored — the CLI continues with the well-typed subset.

---

## 3. Failure modes — categorical error codes

A provider plugin signals failure by throwing `ProviderError` with one of:

| Code | Trigger |
|---|---|
| `pass2-provider-network` | Network failure, transport error, non-2xx HTTP |
| `pass2-provider-auth` | Authentication missing/invalid (401, 403, OAuth, etc.) |
| `pass2-provider-quota` | Rate-limit, billing cap, daily quota exceeded |
| `pass2-provider-parse` | Provider returned a response the CLI's `extractJson` cannot parse |
| `pass2-provider-schema` | Provider returned valid JSON but it failed the §2.1 schema |
| `pass2-provider-not-available` | The provider is registered but cannot run in this environment (binary missing, API key unset, network unreachable). Used by `available()`. |

The CLI surfaces these uniformly: `anatomy generate --ai` prints the error
code + message to stderr and exits 1. The user sees the same shape
regardless of which provider failed.

---

## 4. Reference implementation behavior

The default `claude-cli` provider:

- Concatenates `${systemPrompt}\n\n${userPrompt}` and pipes the result to
  `claude --print` via stdin (cross-platform; uses `shell: true` for
  Windows `.cmd` shim resolution).
- Times out at 120 s.
- Caps stdout buffer at 10 MB.
- Throws `pass2-provider-not-available` if the binary is missing.
- Throws `pass2-provider-network` for non-zero exit codes.
- Returns Claude Code's stdout verbatim — extraction happens in the
  orchestrator.

A third-party provider that produces equivalent JSON output is a drop-in
replacement.

---

## 5. Conformance checklist for a new provider

A provider implementation is conformant if it:

- [ ] Exports an object satisfying the `Pass2Provider` interface in
      [`anatomy-cli/src/pass2/providers/types.ts`](../../anatomy-cli/src/pass2/providers/types.ts).
- [ ] `available()` returns a boolean without throwing.
- [ ] `generate(input)` sends `input.systemPrompt` byte-identical to §1.1
      (no truncation, no paraphrase, no added system-style preamble).
- [ ] `generate(input)` returns a string that the CLI's `extractJson`
      strategy hierarchy can parse, OR throws `pass2-provider-parse`.
- [ ] Throws `pass2-provider-schema` if the parsed JSON fails §2.1
      (the CLI also re-checks).
- [ ] Throws the appropriate categorical error code from §3 on failure
      rather than a bare `Error` (the CLI accepts bare errors but loses
      the categorical signal).
- [ ] Honors `temperature` and `seed` when the underlying API supports
      them (best-effort).

A test scaffold for self-verifying providers is tracked in
[`docs/superpowers/specs/2026-05-08-pass2-portability-design.md`](../../docs/superpowers/specs/2026-05-08-pass2-portability-design.md) §7
(open question 4: ship `--print-prompt` for plugin authors — implemented
in v0.10.x as `anatomy generate --print-prompt`).

---

## 6. Versioning

This contract is part of v0.8's normative scope. It changes only when:

- The `SYSTEM_PROMPT` constant in `pass2/index.ts` changes content
  (whitespace and grammar fixes that don't change the asks are exempt;
  asks are normative).
- The `AiFillResponse` shape in `pass2/index.ts` adds, removes, or
  re-types a field.
- The error-code taxonomy adds, removes, or renames a category.

Any of these requires bumping `anatomy_version` per the additive vs
breaking rules in [`spec/0.2/versioning-policy.md`](../0.2/versioning-policy.md).

The contract for the next schema version (e.g. v0.9 if and when it ships)
will live at `spec/0.9/pass2-prompt-contract.md`. v0.8 plugins are not
guaranteed to produce v0.9-conformant output without re-reading that file.
