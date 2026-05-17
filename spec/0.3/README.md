# Anatomy spec v0.3

v0.3 is a **docs + validator release**. The per-file format is unchanged from v0.2.

- Per-file schema, canonicalization, prompt template, recommended-stacks, versioning policy: see [`spec/0.2/`](../0.2/).
- New in v0.3: cascading semantics for repositories with multiple `.anatomy` files. See [`cascading.md`](cascading.md).

Files declaring `anatomy_version = "0.2"` participate in v0.3 cascading naturally; no migration is required.
