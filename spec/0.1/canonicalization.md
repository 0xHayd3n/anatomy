# Canonicalization Rules

**Status:** Normative for `.anatomy` v0.1.

The `id` field of every pillar (Stack, Form, Domain, Function) is human-readable. So are role/key strings throughout `[operation]` and `[substance]`. Before hashing or comparison, every such string is reduced to a **canonical form** by applying these rules in order.

**Exempt from canonicalization:** `key_dependencies[].name`. Manifest coordinates carry ecosystem-specific characters (`@`, `/`, `:`, `.`) and round-trip verbatim. See design Section 2 for the rationale.

## Algorithm

Given a UTF-8 input string `s`:

1. **Lowercase.** Map every code point to its lowercase ASCII equivalent. Non-ASCII characters are left as-is at this step (they will be rejected at step 5).
2. **Whitespace and underscore normalization.** Replace every maximal run of whitespace characters (` `, `\t`, `\n`, `\r`) and `_` characters with a single `-`.
3. **Strip outer punctuation.** Remove leading and trailing `-`, `.`, `,`, `:`, `;` characters.
4. **Collapse hyphens.** Replace every maximal run of `-` characters with a single `-`.
5. **Validate alphabet.** If any character outside `[a-z0-9-]` remains, the input is INVALID and canonicalization fails. Implementations MUST surface this as an error.

## Examples

| Input | Canonical form |
|-------|----------------|
| `Rust` | `rust` |
| `rust` | `rust` (unchanged) |
| `Static Site Generator` | `static-site-generator` |
| `static_site_generator` | `static-site-generator` |
| `Static__Site Generator` | `static-site-generator` |
| `  Web Publishing  ` | `web-publishing` |
| `--leading--trailing--` | `leading-trailing` |
| `markdown-to-static-html` | (unchanged) |

## Invalid inputs

| Input | Reason |
|-------|--------|
| `C++` | `+` outside `[a-z0-9-]` after lowercasing |
| `日本語` | Non-ASCII characters survive lowercasing |
| `` (empty) | Canonical form is empty; fails schema's `minLength: 1` |
| `---` | Reduces to empty after step 3 |

## Hash computation

Once an `id` has been reduced to its canonical form `c`, its hash is computed as:

```
hash = lowercase(crockford_base32(SHA-256(utf8_bytes(c))))[0:5]
```

Each pillar's hash is exactly 5 lowercase Crockford-base32 characters. Padding is omitted; only the first 5 characters of the encoded digest are used.

**Crockford-base32 alphabet** (omitting `i`, `l`, `o`, `u` to avoid ambiguity):
```
0123456789abcdefghjkmnpqrstvwxyz
```

The lowercase form is normative. Although Crockford-base32 is case-insensitive on input, stored hashes MUST be lowercase so all conforming implementations produce byte-identical output.

## Why this algorithm

- **Determinism.** Same input → same canonical form → same hash, in every conforming implementation.
- **Idempotence.** Canonicalizing an already-canonical input leaves it unchanged.
- **Auditability.** Each rule is independently testable.
- **No semantic normalization.** This algorithm performs string normalization only — it does NOT fold semantic synonyms (e.g., `rust` and `rust-lang`). Synonym handling is the recommended-stacks file's job (alias lookup, tooling-side); for Form / Domain / Function, see the consumer-side patterns in design Section 6.

## Conformance fixtures

See `fixtures/canonicalization-cases.json` for the exhaustive input → canonical-form pairs (and the matching hashes added in Task 5). All conforming implementations MUST agree on every entry.
