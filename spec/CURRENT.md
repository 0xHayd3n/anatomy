# Anatomy spec — version index

This document is the canonical pointer for an outside implementer building
a conforming validator, generator, or downstream consumer. For each version
of the `.anatomy` file format, it states **which documents are normative**
and where to find them.

The current latest format version is **v1.0**.

## Why this index exists

Most version-specific documents (canonicalization rules, versioning policy,
recommended-stacks list) were finalized at v0.2 and have not changed since.
Newer version directories therefore contain only the parts that actually
changed — typically just `schema.json` and a generation `prompt.md`. Without
an index, an implementer reading `spec/0.7/` in isolation has no way to know
that the canonicalization algorithm in `spec/0.2/canonicalization.md` is
still the rule they must implement. This file removes that ambiguity.

## File-format versions

| Version | `anatomy_version` | Schema | Canonicalization | Versioning policy | Recommended stacks | Generation prompt |
|---------|-------------------|--------|------------------|-------------------|---------------------|-------------------|
| 0.1 | `"0.1"` | [`0.1/schema.json`](0.1/schema.json) | [`0.1/canonicalization.md`](0.1/canonicalization.md) | [`0.1/versioning-policy.md`](0.1/versioning-policy.md) | [`0.1/recommended-stacks.json`](0.1/recommended-stacks.json) | [`0.1/prompt.md`](0.1/prompt.md) |
| 0.2 | `"0.2"` | [`0.2/schema.json`](0.2/schema.json) | [`0.2/canonicalization.md`](0.2/canonicalization.md) | [`0.2/versioning-policy.md`](0.2/versioning-policy.md) | [`0.2/recommended-stacks.json`](0.2/recommended-stacks.json) | [`0.2/prompt.md`](0.2/prompt.md) |
| 0.3 | *(not a wire version — see below)* | — | [`0.2/canonicalization.md`](0.2/canonicalization.md) | [`0.2/versioning-policy.md`](0.2/versioning-policy.md) | [`0.2/recommended-stacks.json`](0.2/recommended-stacks.json) | [`0.2/prompt.md`](0.2/prompt.md) |
| 0.4 | `"0.4"` | [`0.4/schema.json`](0.4/schema.json) | [`0.2/canonicalization.md`](0.2/canonicalization.md) | [`0.2/versioning-policy.md`](0.2/versioning-policy.md) | [`0.2/recommended-stacks.json`](0.2/recommended-stacks.json) | [`0.4/prompt.md`](0.4/prompt.md) |
| 0.5 | `"0.5"` | [`0.5/schema.json`](0.5/schema.json) | [`0.2/canonicalization.md`](0.2/canonicalization.md) | [`0.2/versioning-policy.md`](0.2/versioning-policy.md) | [`0.2/recommended-stacks.json`](0.2/recommended-stacks.json) | [`0.5/prompt.md`](0.5/prompt.md) |
| 0.6 | `"0.6"` | [`0.6/schema.json`](0.6/schema.json) | [`0.2/canonicalization.md`](0.2/canonicalization.md) | [`0.2/versioning-policy.md`](0.2/versioning-policy.md) | [`0.2/recommended-stacks.json`](0.2/recommended-stacks.json) | [`0.6/prompt.md`](0.6/prompt.md) |
| 0.7 | `"0.7"` | [`0.7/schema.json`](0.7/schema.json) | [`0.2/canonicalization.md`](0.2/canonicalization.md) | [`0.2/versioning-policy.md`](0.2/versioning-policy.md) | [`0.2/recommended-stacks.json`](0.2/recommended-stacks.json) | [`0.7/prompt.md`](0.7/prompt.md) |
| 0.8 | `"0.8"` | [`0.8/schema.json`](0.8/schema.json) | [`0.2/canonicalization.md`](0.2/canonicalization.md) | [`0.2/versioning-policy.md`](0.2/versioning-policy.md) | [`0.2/recommended-stacks.json`](0.2/recommended-stacks.json) | [`0.8/prompt.md`](0.8/prompt.md) |
| 0.9 | `"0.9"` | [`0.9/schema.json`](0.9/schema.json) | [`0.2/canonicalization.md`](0.2/canonicalization.md) | [`0.2/versioning-policy.md`](0.2/versioning-policy.md) | [`0.2/recommended-stacks.json`](0.2/recommended-stacks.json) | [`0.9/prompt.md`](0.9/prompt.md) |
| 0.10 | `"0.10"` | [`0.10/schema.json`](0.10/schema.json) | [`0.2/canonicalization.md`](0.2/canonicalization.md) | [`0.2/versioning-policy.md`](0.2/versioning-policy.md) | [`0.2/recommended-stacks.json`](0.2/recommended-stacks.json) | [`0.10/prompt.md`](0.10/prompt.md) |
| 0.11 | `"0.11"` | [`0.11/schema.json`](0.11/schema.json) | [`0.2/canonicalization.md`](0.2/canonicalization.md) | [`0.2/versioning-policy.md`](0.2/versioning-policy.md) | [`0.2/recommended-stacks.json`](0.2/recommended-stacks.json) | [`0.11/prompt.md`](0.11/prompt.md) |
| 0.12 | `"0.12"` | [`0.12/schema.json`](0.12/schema.json) | [`0.2/canonicalization.md`](0.2/canonicalization.md) | [`0.2/versioning-policy.md`](0.2/versioning-policy.md) | [`0.2/recommended-stacks.json`](0.2/recommended-stacks.json) | [`0.12/prompt.md`](0.12/prompt.md) |
| 0.13 | `"0.13"` | [`0.13/schema.json`](0.13/schema.json) | [`0.2/canonicalization.md`](0.2/canonicalization.md) | [`0.2/versioning-policy.md`](0.2/versioning-policy.md) | [`0.2/recommended-stacks.json`](0.2/recommended-stacks.json) | [`0.13/prompt.md`](0.13/prompt.md) |
| 0.14 | `"0.14"` | [`0.14/schema.json`](0.14/schema.json) | [`0.2/canonicalization.md`](0.2/canonicalization.md) | [`0.2/versioning-policy.md`](0.2/versioning-policy.md) | [`0.2/recommended-stacks.json`](0.2/recommended-stacks.json) | [`0.14/prompt.md`](0.14/prompt.md) |
| 0.15 | `"0.15"` | [`0.15/schema.json`](0.15/schema.json) | [`0.2/canonicalization.md`](0.2/canonicalization.md) | [`0.2/versioning-policy.md`](0.2/versioning-policy.md) | [`0.2/recommended-stacks.json`](0.2/recommended-stacks.json) | [`0.15/prompt.md`](0.15/prompt.md) |
| **1.0** | `"1.0"` | [`1.0/schema.json`](1.0/schema.json) | [`0.2/canonicalization.md`](0.2/canonicalization.md) | [`0.2/versioning-policy.md`](0.2/versioning-policy.md) | [`0.2/recommended-stacks.json`](0.2/recommended-stacks.json) | [`1.0/prompt.md`](1.0/prompt.md) |

**Wire-version note:** `anatomy_version` is the value declared inside the
file. Valid values are `"0.1"`, `"0.2"`, `"0.4"`, `"0.5"`, `"0.6"`, `"0.7"`,
`"0.8"`, `"0.9"`, `"0.10"`, `"0.11"`, `"0.12"`, `"0.13"`, `"0.14"`, `"0.15"`, `"1.0"` — matching `supportedVersions` in [`anatomy-validate`](../anatomy-validate/src/schema.ts).
There is **no** `"0.3"` wire version.

**Cross-version note:** The per-version schemas in this index use
`"additionalProperties": false` at the root. This means a consumer running
`validate()` from `@anatomy/validate` against a v0.15 file correctly routes
to the v0.15 schema and accepts it. However, a consumer that bypasses
version routing and validates a v0.15 file directly against the v0.14
schema (e.g., by manually compiling `spec/0.14/schema.json`) will reject
the file due to the unknown top-level sections. The additive-within-major
guarantee is preserved by routing, not by schema-level field tolerance.

## v1.0 — stabilization, not a breaking change

v1.0 is the stabilization milestone for the `.anatomy` file format. It is
**structurally byte-identical to v0.15**: the only differences between a
v0.15 file and a v1.0 file are the `anatomy_version` string and the
`[generated].schema` URL. No field was added, removed, renamed, or retyped;
canonicalization, the hash algorithm, and fingerprint construction are
unchanged.

This is the **single sanctioned exception** to the rule in
`0.2/versioning-policy.md` that a major bump (`X.y → (X+1).0`) implies a
breaking change. The 0→1 bump records a stability commitment — the format is
now considered stable — rather than an incompatibility. Accordingly:

- A v0.x consumer MAY accept a v1.0 file as if it were v0.15. The normative
  `versioning-policy.md` instruction that "older parsers MUST reject
  newer-major files explicitly" does **not** apply to the 0.15→1.0
  transition specifically.
- All v0.1–v0.15 files remain valid and continue to be routed by
  `@anatomy/validate`. v1.0 adds a version; it removes nothing.
- Future `1.x` minor versions follow the existing additive-minor policy
  unchanged. The next *breaking* change would be v2.0 under the standard
  major-bump rules.

## v0.3 is an ecosystem release, not a wire version

v0.3 is a validator/tooling release that adds **cascading semantics** for
repositories with multiple `.anatomy` files. The per-file format is
identical to v0.2 — files participating in v0.3 cascading still declare
`anatomy_version = "0.2"`. See [`0.3/cascading.md`](0.3/cascading.md) for
the normative cascading rules and [`0.3/README.md`](0.3/README.md) for the
release framing.

A consumer is "v0.3-aware" when it implements:

- everything required by the v0.2 file format, *and*
- the cascading discovery and merge semantics in [`0.3/cascading.md`](0.3/cascading.md).

The current ecosystem version exposed by [`@anatomy/validate`](../anatomy-validate/src/index.ts)
is `"0.3"`.

## `.anatomy-memory`

The lived-experience memory layer is versioned independently:

| Version | Schema |
|---------|--------|
| memory 0.1 | [`memory/0.1/schema.json`](memory/0.1/schema.json) |
| **memory 0.2** | [`memory/0.2/schema.json`](memory/0.2/schema.json) |

Memory files declare `anatomy_memory_version = "0.1"` or `"0.2"` and require a
`repo_fingerprint` matching the paired `.anatomy` file's fingerprint.
ID generation, attribution, and supersession rules are documented in the
[memory plan](../docs/superpowers/plans/2026-05-08-anatomy-memory.md).

**v0.1 → v0.2:** v0.2 adds two optional entry fields, `last_verified_at`
and `verified_by`, for tracking decay (how recently an entry was confirmed
to still be relevant). v0.1 entries remain valid v0.2 — a v0.2 consumer
treats missing `last_verified_at` as "untouched" and falls back to the
entry's `at` timestamp as the verification proxy. The v0.1 schema's
`$defs.entry.additionalProperties` was relaxed from `false` to `true` in
the same release so a v0.1 consumer reading a v0.2 file silently tolerates
the new fields rather than rejecting them. Design doc:
[`memory-v0.2-decay-design.md`](../docs/superpowers/specs/2026-05-08-memory-v0.2-decay-design.md).

## Stability commitments

- **v0.2 docs are frozen.** `0.2/canonicalization.md`, `0.2/versioning-policy.md`,
  and `0.2/recommended-stacks.json` are normative for every later version
  in this index until a future version explicitly supersedes them with a
  same-named file in its own directory. The v1.0 graduation does NOT edit
  these frozen files; the 0→1 reconciliation lives in the "v1.0 —
  stabilization" section above.
- **`schema.json` per version is the single source of truth** for that
  version's structural validity. The repository ships a per-version copy
  in [`anatomy-validate/src/schema-{ver}.json`](../anatomy-validate/src/);
  these are regenerated from `spec/{ver}/schema.json` by
  [`prebuild.mjs`](../anatomy-validate/scripts/prebuild.mjs).
- **Adding a new file format version** means: add a new `spec/{ver}/`
  directory containing at least `schema.json`; add the version to
  `supportedVersions` in `anatomy-validate/src/schema.ts`; add the version
  to `VERSIONS` in `anatomy-validate/scripts/prebuild.mjs`; add a row to
  the table above pointing at whichever earlier-version docs remain
  normative.
