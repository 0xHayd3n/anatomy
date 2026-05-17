// src/pass1/manifest/ocaml.ts
// Detects OCaml projects via dune-project (the modern build-system marker;
// older opam-only projects also exist but dune is overwhelmingly dominant).
// Stack: "ocaml". Form heuristic: parsing dune files for executable vs
// library targets is non-trivial across the recursive layout — default
// to library. Future work could walk subdirs for `(executable (name ...))`
// stanzas to upgrade to cli-tool.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { DetectedManifest } from "../../types.js";

const MAX_MANIFEST_BYTES = 256 * 1024;

interface OcamlParsed {
  duneProjectContent: string;
}

export function detectOcaml(repoRoot: string): DetectedManifest | null {
  const path = join(repoRoot, "dune-project");
  if (!existsSync(path)) return null;
  let content = "";
  try {
    const st = statSync(path);
    if (st.isFile() && st.size <= MAX_MANIFEST_BYTES) {
      content = readFileSync(path, "utf8");
    }
  } catch {}
  return { kind: "ocaml", path, parsed: { duneProjectContent: content } satisfies OcamlParsed };
}

export function ocamlFormSuffix(_parsed: unknown): "library" {
  return "library";
}
