# javascript library · demo · comprehensive

> **Regenerated from `.anatomy` at commit `def5678` by `anatomy-cli@0.13.0`.**
> DO NOT EDIT — changes will be overwritten on next `anatomy render`.
> Edit `.anatomy` instead, then run `anatomy render`.
> If your HEAD ≠ `def5678`, this file may be stale — re-run `anatomy render`.

Comprehensive v0.10 example — all optional sections populated

Comprehensive AGENTS.md fixture exercising commands, structure, rules, flows, and decisions within the default token budget.

## Commands
```sh
# build
tsc
# test
vitest run
# lint
eslint .
```

## Project structure
- `src/` — Source code root
- `tests/` — Test suites
- `docs/` — Documentation

## Rules
- All tests live in tests/ and are named *.test.ts
  *Why:* Established convention; vitest globs depend on it
- Hand-roll TOML when section order matters
  *Why:* smol-toml does not preserve insertion order

## Flows
- **build-pipeline** — tsc compilation followed by vitest run
- **release** — Bump version then publish to npm

## Key decisions
- **TypeScript over JavaScript** — Type safety catches a class of bugs earlier in the cycle
- **vitest over jest** — Faster watch mode and native ESM support

---

*Fingerprint: `kh3ybxthmht0yvvskye3` · Schema: `https://anatomy.dev/spec/0.10/schema.json`*
*Machine-readable source: [`.anatomy`](.anatomy) · Memory log: [`.anatomy-memory`](.anatomy-memory)*
