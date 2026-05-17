// src/pass1/manifest/v.ts
// Detects V-language projects via v.mod (the V package manifest). Stack:
// "v". Form heuristic: V is mostly used for tools/CLIs and small
// libraries; without parsing v.mod's complex syntax, default to library.
// vweb in deps → service.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { DetectedManifest } from "../../types.js";

const MAX_MANIFEST_BYTES = 256 * 1024;

interface VParsed {
  content: string;
}

export function detectV(repoRoot: string): DetectedManifest | null {
  const path = join(repoRoot, "v.mod");
  if (!existsSync(path)) return null;
  let content = "";
  try {
    const st = statSync(path);
    if (st.isFile() && st.size <= MAX_MANIFEST_BYTES) {
      content = readFileSync(path, "utf8");
    }
  } catch {}
  return { kind: "v", path, parsed: { content } satisfies VParsed };
}

export function vFormSuffix(parsed: unknown): "service" | "library" {
  const c = (parsed as VParsed | undefined)?.content ?? "";
  // vweb is the V web framework.
  if (/\bvweb\b/.test(c)) return "service";
  return "library";
}
