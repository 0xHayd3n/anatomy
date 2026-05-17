// src/pass1/manifest/julia.ts
// Detects Julia projects via Project.toml (capital P — distinct from
// Python's pyproject.toml). Stack: "julia". Default form: library. Julia
// CLI tooling is rare; service is essentially never primary. Future
// refinement could check for `Genie` (web framework) → service.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import type { DetectedManifest } from "../../types.js";

const MAX_MANIFEST_BYTES = 256 * 1024;

interface JuliaParsed {
  parsed: Record<string, unknown>;
}

export function detectJulia(repoRoot: string): DetectedManifest | null {
  // Capital-P Project.toml only. Lowercase project.toml is not Julia.
  const path = join(repoRoot, "Project.toml");
  if (!existsSync(path)) return null;
  let parsed: Record<string, unknown> = {};
  try {
    const st = statSync(path);
    if (!st.isFile() || st.size > MAX_MANIFEST_BYTES) return null;
    const content = readFileSync(path, "utf8");
    try {
      parsed = parseToml(content) as Record<string, unknown>;
    } catch { /* malformed; carry empty parsed */ }
    // Disambiguation: Julia Project.toml has a top-level `name` and `uuid`.
    // If neither is present, this might be some other tool's Project.toml.
    if (parsed.name === undefined && parsed.uuid === undefined) return null;
  } catch { return null; }
  return { kind: "julia", path, parsed: { parsed } satisfies JuliaParsed };
}

export function juliaFormSuffix(parsed: unknown): "service" | "library" {
  const p = (parsed as JuliaParsed | undefined)?.parsed ?? {};
  const deps = (p.deps ?? {}) as Record<string, unknown>;
  // Genie is the dominant Julia web framework.
  if (Object.keys(deps).includes("Genie")) return "service";
  return "library";
}
