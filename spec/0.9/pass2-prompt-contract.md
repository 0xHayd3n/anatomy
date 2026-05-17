# Pass 2 Prompt Contract — v0.9

**Status:** Normative for `anatomy_version = "0.9"` Pass 2 generation.

This document fixes the LLM-call contract for the optional Pass 2 stage of
`anatomy generate --ai`. Any provider plugin (built-in or third-party) that
satisfies the input/output schema below produces output that the CLI can
merge into a v0.9 `.anatomy` file. Providers MAY adapt API call shape (chat
vs completion, function-calling, tool-use, vision) but MUST NOT modify the
prompt content or the response schema.

The reference implementation lives at
[`anatomy-cli/src/pass2/index.ts`](../../anatomy-cli/src/pass2/index.ts) and the
default provider at
[`anatomy-cli/src/pass2/providers/claude-cli.ts`](../../anatomy-cli/src/pass2/providers/claude-cli.ts).

The byte-stable system prompt is exported as `SYSTEM_PROMPT` from
`pass2/index.ts`. Treat the source as authoritative; this doc is the contract
*shape*, the source is the contract *content*.

---

## What changed from v0.8

Two additions to the response schema (both optional):

- `identity_stack`: emitted ONLY when `identity.stack` appears in the
  prompt's "Fields to fill" list — i.e. when Pass 1 detected no manifest.
  Format: lowercase hyphenated slug (`csharp`, `typescript`, `python`, etc.).
  Pass 1's deterministic detection still wins when a manifest existed, so
  providers MUST emit this only when explicitly asked.
- `identity_form`: same conditional; format `<stack>-<shape>` where shape is
  one of `library`, `cli-tool`, `service`, `desktop-app`, `monorepo`.
  Examples: `"csharp-desktop-app"`, `"python-cli-tool"`.

Driven by the 2026-05-09 stress test: Pass 2 was leaving stack/form as
`todo-*` placeholders even when the README clearly identified the stack
(e.g. Clipfarmer's "C# WPF desktop application"). The v0.9 contract closes
that gap by asking the model for those slots when Pass 1 came up empty.

The system prompt now lists those two fields in its rules and includes them
in the response-schema example.

---

## Response schema (v0.9)

```json
{
  "identity_stack": "string (optional — only when stack is in Fields to fill)",
  "identity_form":  "string (optional — only when form is in Fields to fill)",
  "identity_domain":   "string (optional)",
  "identity_function": "string (optional)",
  "structure_purposes":  { "<path>": "<purpose>" },
  "dependency_whys":     { "<name>": "<why>" },
  "interface_summaries": { "<name or symbol>": "<summary>" },
  "rules":     [{ "rule": "...", "why": "..." }],
  "flows":     [{ "name": "...", "summary": "..." }],
  "decisions": [{ "topic": "...", "reason": "..." }]
}
```

The `interface_summaries` and `dependency_whys` slots remain in the schema
to keep the contract compatible with v0.7/v0.8 documents that still have
`[interface]` / `[substance.key_dependencies]`. v0.9 documents do not have
those sections, so v0.9 generation simply leaves the corresponding
"Fields to fill" entries off the prompt and the model emits empty objects
or omits the keys.

---

## Other constraints (unchanged from v0.8)

- Length caps: structure purposes ≤120, dependency whys ≤80, interface
  summaries ≤120, rules ≤300, decisions reason ≤400.
- All identity slugs match `^[a-z0-9]+(-[a-z0-9]+)*$`.
- Output is JSON-only (no prose, no markdown fences). The runtime tolerates
  fenced blocks via the `extractJson` recovery path, but providers should
  emit raw JSON.
- The runtime ignores fields not declared in the schema.

See [v0.8 contract](../0.8/pass2-prompt-contract.md) for the prior version's
full text; only the deltas above changed.
