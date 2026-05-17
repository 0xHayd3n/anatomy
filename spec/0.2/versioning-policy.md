# Versioning Policy

**Status:** Normative for the Anatomy standard (all versions).

The `anatomy_version` field uses a simplified semver. This document defines what counts as breaking vs. additive so implementers and consumers can reason about compatibility.

## Major bump (`X.y` → `(X+1).0`)

Breaking changes require a major bump. A change is breaking if any of the following is true:

- A previously-required field is removed or renamed.
- A previously-optional field becomes required.
- A field's type changes.
- A canonicalization rule changes such that an `id` valid under the previous version is rejected under the new version, or vice versa.
- The hash algorithm, encoding, length, or case changes.
- The fingerprint construction changes.
- A new required field is added.
- Group structure is reorganized (e.g., a sub-field moves between `[operation]` and `[substance]`).

Older parsers MUST reject newer-major files explicitly.

## Minor bump (`X.y` → `X.(y+1)`)

Additive changes require only a minor bump. A change is additive if all of the following are true:

- Existing required fields are unchanged in name, type, and semantics.
- New fields, if any, are optional.
- Canonicalization rules unchanged.
- Hash algorithm and fingerprint construction unchanged.
- Group containers may gain new optional sub-fields.
- The recommended-stacks file may grow (entries may be marked deprecated but not removed within a major).

## Forward compatibility — v0.1 specifically

**v0.1 schema rejects unknown fields** (`additionalProperties: false`). This catches typos and accidental field name drift in early adopters' tooling. A v0.1 parser will refuse to parse a v0.2 file produced by newer tooling.

**v0.2 introduces forward-compatibility tolerance.** Starting with v0.2, the schema relaxes to allow unknown fields, and validators are expected to ignore unrecognized optional fields with a warning rather than rejecting outright. This lets older parsers gracefully accept newer-minor files.

The v0.1 strictness is intentional: there is no "earlier version to be backwards compatible with" yet, so the cost of strictness is zero, and the benefit (catching tooling drift early) is real.

## Forward-compatible fields shipped in v0.1

Two fields in v0.1 carry a forward-compatible optional sub-field that v0.2 will populate automatically:

- `substance.capabilities[].source`
- `substance.limitations[].source`

In v0.1, `source` is a maintainer-authored pointer (e.g., `"README.md#features"` or `"src/lib.rs#stream_rows"`) that anchors the capability/limitation claim. The validator does not resolve or check it. v0.2 introduces an auto-derivation pipeline that populates `source` from Pass 1 signals; v0.1 files with manual or absent `source` values stay valid in v0.2.

## Recommended-stacks file versioning

The recommended-stacks file (`recommended-stacks.json`) versions independently from the schema:

- **Adding a new entry** — does not bump the file's `version`.
- **Adding aliases to an existing entry** — does not bump the file's `version`.
- **Renaming an entry** — bumps the file's major version.
- **Removing an entry** — only permitted at a schema major bump.

The file MUST include a `version` field declaring its own version separate from the schema's `anatomy_version`.

The recommended-stacks file is **non-normative** (see design Section 3); changes to it never require an `anatomy_version` bump.

## Prompt template versioning

The prompt template (`prompt.md`) versions with the schema. Any change to the prompt requires at least a minor schema bump.

## Communication

When a new schema version is published:

- A migration note is added to `docs/migrations/<from>-to-<to>.md`.
- Validator implementations SHOULD warn when they encounter a file at the highest version they support, alerting the user that newer versions exist.


## Ecosystem version (added in v0.3)

v0.3 introduces the concept of an **ecosystem version**, tracked separately from the per-file `anatomy_version`. The ecosystem version describes which cross-file semantics (cascading, discovery, tree-mode validation) a consumer implements. Consumer tooling advertises its ecosystem version via a constant (e.g., `@anatomy/validate` exports `ECOSYSTEM_VERSION`); files themselves do NOT carry an ecosystem-version field. See [`spec/0.3/cascading.md`](../0.3/cascading.md).
