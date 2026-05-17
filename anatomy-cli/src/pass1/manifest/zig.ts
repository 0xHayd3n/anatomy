// src/pass1/manifest/zig.ts
// Detects Zig projects via build.zig (always present in modern Zig
// projects; build.zig.zon may exist alongside in 0.11+). Stack: "zig".
// Form heuristic: addExecutable in build.zig → cli-tool; else library.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { DetectedManifest } from "../../types.js";

const MAX_MANIFEST_BYTES = 256 * 1024;

interface ZigParsed {
  content: string;
  hasZon: boolean;
}

export function detectZig(repoRoot: string): DetectedManifest | null {
  const buildZig = join(repoRoot, "build.zig");
  const buildZon = join(repoRoot, "build.zig.zon");
  if (!existsSync(buildZig) && !existsSync(buildZon)) return null;
  let content = "";
  if (existsSync(buildZig)) {
    try {
      const st = statSync(buildZig);
      if (st.isFile() && st.size <= MAX_MANIFEST_BYTES) {
        content = readFileSync(buildZig, "utf8");
      }
    } catch {}
  }
  return {
    kind: "zig",
    path: existsSync(buildZig) ? buildZig : buildZon,
    parsed: { content, hasZon: existsSync(buildZon) } satisfies ZigParsed,
  };
}

export function zigFormSuffix(parsed: unknown): "cli-tool" | "library" {
  const c = (parsed as ZigParsed | undefined)?.content ?? "";
  if (/addExecutable\s*\(/.test(c)) return "cli-tool";
  return "library";
}
