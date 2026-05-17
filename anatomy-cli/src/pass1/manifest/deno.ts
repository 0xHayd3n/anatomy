// src/pass1/manifest/deno.ts
// Detects Deno projects via deno.json or deno.jsonc at root. Stack:
// "typescript" (Deno-specific stack id reserved as "deno" — but Deno IS
// TypeScript, so we re-use the existing slug for ergonomics; the manifest
// kind tracks the runtime separately for form heuristics). Form: oak / hono
// / fresh / aleph dep → service; tasks with `deno run` for an entry script
// → cli-tool; default library.
//
// Known limitation: workspace-style Deno repos like denoland/deno_std ship
// per-subdir deno.json without a root manifest; the loose-.ts fallback
// would conflict with TypeScript-via-npm detection so it's not added.
// Users with workspace-style Deno repos can author the .anatomy by hand.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { DetectedManifest } from "../../types.js";

const MAX_MANIFEST_BYTES = 256 * 1024;

interface DenoParsed {
  parsed: Record<string, unknown>;
}

/** Strip block comments and line comments from JSONC text so JSON.parse
 *  can consume it. Tolerant — bails on string-content comment chars. */
function stripJsoncComments(text: string): string {
  // Conservative: strip /*...*/ blocks and // line comments outside of strings.
  // Quick implementation; not a full parser.
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'\\])\/\/[^\n]*/g, "$1");
}

export function detectDeno(repoRoot: string): DetectedManifest | null {
  for (const name of ["deno.json", "deno.jsonc"]) {
    const path = join(repoRoot, name);
    if (!existsSync(path)) continue;
    let parsed: Record<string, unknown> = {};
    try {
      const st = statSync(path);
      if (!st.isFile() || st.size > MAX_MANIFEST_BYTES) continue;
      const raw = readFileSync(path, "utf8");
      const text = name.endsWith(".jsonc") ? stripJsoncComments(raw) : raw;
      try { parsed = JSON.parse(text); } catch { /* malformed; carry empty */ }
    } catch { continue; }
    return { kind: "deno", path, parsed: { parsed } satisfies DenoParsed };
  }
  return null;
}

const DENO_SERVICE_FRAMEWORKS = ["oak", "hono", "fresh", "aleph", "ultra", "cheetah"];

export function denoFormSuffix(parsed: unknown): "service" | "cli-tool" | "library" {
  const p = (parsed as DenoParsed | undefined)?.parsed ?? {};
  const imports = (p.imports ?? {}) as Record<string, unknown>;
  const importVals = Object.values(imports).filter((v): v is string => typeof v === "string").join("\n");

  if (new RegExp(`\\b(?:${DENO_SERVICE_FRAMEWORKS.join("|")})\\b`).test(importVals)) return "service";
  // Deno package with a `bin` field publishes a CLI binary. Without it,
  // `deno run` invocations in the tasks block are too weak to flip form —
  // workspaces like deno-std use them for build helpers and lint commands
  // while themselves being library-shaped (or workspace-only).
  if (p.bin !== undefined) return "cli-tool";
  return "library";
}
