// src/pass1/manifest/gleam.ts
// Detects Gleam projects via gleam.toml. Stack: "gleam". Form heuristic:
// gleam_http or wisp dep → service; gleam build supports both BEAM (Erlang)
// and JavaScript targets — the targets affect behavior but not form
// classification at this level.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import type { DetectedManifest } from "../../types.js";

const MAX_MANIFEST_BYTES = 256 * 1024;

interface GleamParsed {
  parsed: Record<string, unknown>;
}

export function detectGleam(repoRoot: string): DetectedManifest | null {
  const path = join(repoRoot, "gleam.toml");
  if (!existsSync(path)) return null;
  let parsed: Record<string, unknown> = {};
  try {
    const st = statSync(path);
    if (!st.isFile() || st.size > MAX_MANIFEST_BYTES) return null;
    const content = readFileSync(path, "utf8");
    try {
      parsed = parseToml(content) as Record<string, unknown>;
    } catch { /* malformed; carry empty parsed */ }
  } catch { return null; }
  return { kind: "gleam", path, parsed: { parsed } satisfies GleamParsed };
}

export function gleamFormSuffix(parsed: unknown): "service" | "library" {
  const p = (parsed as GleamParsed | undefined)?.parsed ?? {};
  const deps = (p.dependencies ?? {}) as Record<string, unknown>;
  for (const k of Object.keys(deps)) {
    if (k === "gleam_http" || k === "wisp" || k === "mist" || k === "lustre") return "service";
  }
  return "library";
}
