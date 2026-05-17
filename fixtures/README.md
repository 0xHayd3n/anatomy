# Conformance fixtures

This directory is the conformance test set for the Anatomy schema. It is consumed both by `anatomy-spec`'s own CI (to verify the schema's behavior) and by validator implementations (`anatomy-validate` in TypeScript and Rust) as their conformance suite.

`.anatomy` files are TOML 1.0 (see `docs/specs/2026-05-05-anatomy-standard-design.md` Section 2). The fixture file extension is `.anatomy` (the standard's filename convention regardless of underlying format).

## Structure

- `valid/<NN-name>/input.anatomy` — must parse as TOML cleanly AND validate against `spec/0.1/schema.json` cleanly. Every pillar `hash` field MUST equal the locally-computed canonical hash of its `id`.
- `valid-with-warnings/<NN-name>/input.anatomy` — must parse cleanly AND validate against the schema cleanly. The validator package (not the schema) is expected to emit specific warnings; `expected.json` lists them.
- `invalid/<NN-name>/input.anatomy` — must FAIL to validate against `spec/0.1/schema.json` (or, for fixtures marked `schema_can_detect: false`, must parse cleanly AND validate against the schema cleanly but be rejected by the full validator's content checks).
- `invalid/<NN-name>/expected.json` — describes which schema error(s) MUST surface for the input, OR documents the validator-side rule for boundary cases.

## `expected.json` formats

For invalid fixtures the schema CAN detect:

```json
{
  "errors": [
    { "instancePath": "/identity", "rule": "required" }
  ]
}
```

For invalid fixtures the schema CANNOT detect (cross-field constraints):

```json
{
  "errors": [],
  "schema_can_detect": false,
  "validator_code": "fingerprint-mismatch",
  "validator_must_detect": "fingerprint != stack.hash + form.hash + domain.hash + function.hash",
  "comment": "Documents the boundary between schema and full validator. validator_code names the ErrorCode the validator must surface."
}
```

For `valid-with-warnings/`:

```json
{
  "warnings": [
    { "code": "description-too-long", "field": "description" }
  ]
}
```

## Adding a new fixture

1. Pick the next free `NN` (zero-padded two digits within the directory).
2. Write `input.anatomy` as TOML. For `valid/*` and `valid-with-warnings/*` fixtures, use placeholder hashes (`"00000"` and a 20-char placeholder fingerprint) initially.
3. For invalid/warning fixtures, write `expected.json`.
4. Run `npm run fix:hashes` to populate real canonical hashes (only for `valid/*` and `valid-with-warnings/*`; invalid fixtures are left as-is, since their hashes may be intentionally wrong).
5. Run `npm run validate`. The harness picks new fixtures up automatically.
6. Commit fixture(s) together with any harness or schema changes.
