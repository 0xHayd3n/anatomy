// src/pass1/manifest/haskell.ts
// Detects Haskell projects via *.cabal at root (one or more) or stack.yaml.
// Stack: "haskell". Form heuristic: cabal `executable NAME` block → cli-tool;
// `library` block only → library; both → cli-tool (the binary is usually
// the user-facing product). Plain text match on raw .cabal contents.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { DetectedManifest } from "../../types.js";

const MAX_MANIFEST_BYTES = 256 * 1024;

interface HaskellParsed {
  cabalContent: string;
  hasStackYaml: boolean;
}

function findCabal(repoRoot: string): string | null {
  try {
    for (const e of readdirSync(repoRoot, { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith(".cabal")) return join(repoRoot, e.name);
    }
  } catch {}
  return null;
}

export function detectHaskell(repoRoot: string): DetectedManifest | null {
  const cabalPath = findCabal(repoRoot);
  const stackPath = join(repoRoot, "stack.yaml");
  const cabalProjectPath = join(repoRoot, "cabal.project");
  const hasStackYaml = existsSync(stackPath);
  const hasCabalProject = existsSync(cabalProjectPath);
  if (!cabalPath && !hasStackYaml && !hasCabalProject) return null;

  let cabalContent = "";
  if (cabalPath) {
    try {
      const st = statSync(cabalPath);
      if (st.isFile() && st.size <= MAX_MANIFEST_BYTES) {
        cabalContent = readFileSync(cabalPath, "utf8");
      }
    } catch {}
  }

  return {
    kind: "haskell",
    path: cabalPath ?? stackPath ?? cabalProjectPath,
    parsed: { cabalContent, hasStackYaml } satisfies HaskellParsed,
  };
}

export function haskellFormSuffix(parsed: unknown): "cli-tool" | "library" {
  const c = (parsed as HaskellParsed | undefined)?.cabalContent ?? "";
  // .cabal stanzas at column 0; `executable` declares a binary.
  if (/^executable\s+\S+/im.test(c)) return "cli-tool";
  return "library";
}
