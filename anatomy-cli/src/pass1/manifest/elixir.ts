// src/pass1/manifest/elixir.ts
// Detects Elixir projects via mix.exs. Stack: "elixir". Form heuristic:
// :phoenix or :plug or :cowboy in deps, or `mod:` in application/0 →
// service; `escript:` → cli-tool; else library. Plain string match on the
// raw .exs source.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { DetectedManifest } from "../../types.js";

const MAX_MANIFEST_BYTES = 256 * 1024;

interface ElixirParsed {
  content: string;
}

export function detectElixir(repoRoot: string): DetectedManifest | null {
  const path = join(repoRoot, "mix.exs");
  if (!existsSync(path)) return null;
  let content = "";
  try {
    const st = statSync(path);
    if (st.isFile() && st.size <= MAX_MANIFEST_BYTES) {
      content = readFileSync(path, "utf8");
    }
  } catch {}
  return { kind: "elixir", path, parsed: { content } satisfies ElixirParsed };
}

export function elixirFormSuffix(parsed: unknown): "service" | "cli-tool" | "library" {
  const c = (parsed as ElixirParsed | undefined)?.content ?? "";
  // Web framework deps are the only reliable service signal. The negative
  // lookahead enforces the atom name boundary — `:phoenix` matches but
  // `:phoenix_pubsub` (the package's own atom in `app: :phoenix_pubsub`)
  // doesn't. Without it, phoenix_pubsub (a library) was misclassified as
  // service in the 2026-05-09 stress test.
  // `mod: {...}` in application/0 is too weak too — gettext ships
  // `mod: {Gettext.Application, []}` purely to expose Application config.
  if (/:(?:phoenix|plug|cowboy|bandit)(?![a-z0-9_])/.test(c)) return "service";
  if (/escript\s*:/.test(c)) return "cli-tool";
  return "library";
}
