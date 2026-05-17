# Anatomy v0.10 Pass 2 Prompt Contract

> Extends the [v0.9 contract](../0.9/pass2-prompt-contract.md). Only the additions and changes from v0.9 are listed here; everything else is inherited.

## New input: `EXISTING_AGENTS_MD`

If the target repository contains an `AGENTS.md` file at its root **and** that file is NOT anatomy-generated (no `Regenerated from \`.anatomy\`` banner in the first 5 lines), `anatomy generate` reads it and includes the content in the Pass 2 prompt under the `EXISTING_AGENTS_MD` label.

Anatomy-generated AGENTS.md files are deliberately excluded: feeding them back into Pass 2 would be a circular dependency where the output influences itself across regenerations.

### Format in the prompt

```
EXISTING_AGENTS_MD (optional, present only if the repository has a hand-written AGENTS.md at its root; truncated to 3000 chars):

<existing AGENTS.md content inserted here, or this section is omitted>
```

If the file is longer than 3000 chars, the content is truncated and a marker is appended:

```
...
[...truncated at 3000 chars; see AGENTS.md.bak after first generate for full content]
```

### Field-influence rules

Pass 2 may use `EXISTING_AGENTS_MD` to inform the following output fields:

| Field | Influence | Notes |
|---|---|---|
| `[[rules]]` | **High** | Adopt existing rules verbatim where they fit anatomy's rule shape (`rule` + `why`). |
| `[[flows]]` | Medium | Extract named workflows; preserve hand-written summaries. |
| `[[decisions]]` | Medium | Preserve hand-written rationales; do not invent new decisions. |
| `[[structure.entries]]` | Medium | Match `path` → `purpose` mappings if present. |
| `[operation.commands]` | High | Adopt build/test commands verbatim. |
| `[generate]` | **Never** | Render preferences are not derivable from prose. Always leave absent. |
| Identity pillars | **Never** | Pillars derive from manifest + README + dir walker, not AGENTS.md. |

### Reconciliation rules (when sources disagree)

- **Commands:** manifest (`package.json#scripts` etc.) wins.
- **Description / tagline:** README wins; AGENTS.md is fallback.
- **Rules, conventions, glob-scoped guidance:** existing AGENTS.md wins.
- **Identity pillars:** manifest + dir walker wins; AGENTS.md is ignored.

### Output shape

No change from v0.9. Pass 2 still returns the same `AiFillResponse` shape with `tagline`, `description`, identity fields, and the optional rules/flows/decisions arrays. The contract change is purely additive at the input boundary.
