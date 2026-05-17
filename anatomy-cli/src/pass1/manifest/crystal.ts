// src/pass1/manifest/crystal.ts
// Detects Crystal projects via shard.yml. Stack: "crystal". Form heuristic:
// `targets:` declares one or more binaries → cli-tool; web framework deps
// (kemal, lucky, athena) → service; else library. shard.yml is a small
// YAML — plain text match suffices for these signals.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { DetectedManifest } from "../../types.js";

const MAX_MANIFEST_BYTES = 256 * 1024;

interface CrystalParsed {
  content: string;
}

export function detectCrystal(repoRoot: string): DetectedManifest | null {
  const path = join(repoRoot, "shard.yml");
  if (!existsSync(path)) return null;
  let content = "";
  try {
    const st = statSync(path);
    if (st.isFile() && st.size <= MAX_MANIFEST_BYTES) {
      content = readFileSync(path, "utf8");
    }
  } catch {}
  return { kind: "crystal", path, parsed: { content } satisfies CrystalParsed };
}

const CRYSTAL_SERVICE_FRAMEWORKS = ["kemal", "lucky", "athena", "amber", "grip"];

export function crystalFormSuffix(parsed: unknown): "service" | "cli-tool" | "library" {
  const c = (parsed as CrystalParsed | undefined)?.content ?? "";
  // Self-name disqualifier: shard.yml has `name: NAME` at top. If NAME is
  // one of the listed web frameworks, the package IS the framework, not
  // a service that uses it (same as compojure → library fix).
  const selfMatch = /^name\s*:\s*([a-zA-Z0-9_-]+)/m.exec(c);
  const selfName = selfMatch?.[1]?.toLowerCase() ?? "";
  if (CRYSTAL_SERVICE_FRAMEWORKS.includes(selfName)) {
    if (/^targets\s*:/m.test(c)) return "cli-tool";
    return "library";
  }
  if (new RegExp(`\\b(?:${CRYSTAL_SERVICE_FRAMEWORKS.join("|")})\\b`).test(c)) return "service";
  if (/^targets\s*:/m.test(c)) return "cli-tool";
  return "library";
}
