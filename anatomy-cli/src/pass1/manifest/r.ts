// src/pass1/manifest/r.ts
// Detects R packages via the DESCRIPTION file (CRAN convention). Stack: "r".
// Form heuristic: shiny dep → service (Shiny apps are web servers), `Type:
// Package` (the default) → library, no good cli signal in CRAN convention.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { DetectedManifest } from "../../types.js";

const MAX_MANIFEST_BYTES = 256 * 1024;

interface RParsed {
  content: string;
}

export function detectR(repoRoot: string): DetectedManifest | null {
  // Capital-D DESCRIPTION (no extension) is the CRAN convention. Some
  // projects lowercase it but those aren't CRAN-conformant.
  const path = join(repoRoot, "DESCRIPTION");
  if (!existsSync(path)) return null;
  let content = "";
  try {
    const st = statSync(path);
    if (st.isFile() && st.size <= MAX_MANIFEST_BYTES) {
      content = readFileSync(path, "utf8");
      // Heuristic disambiguation: a top-level DESCRIPTION typically declares
      // `Package: NAME` on its own line. Without that signal we can't be
      // confident this is an R package (some other tool could ship a
      // file called DESCRIPTION).
      if (!/^Package\s*:/m.test(content)) return null;
    }
  } catch { return null; }
  return { kind: "r", path, parsed: { content } satisfies RParsed };
}

export function rFormSuffix(parsed: unknown): "service" | "library" {
  const c = (parsed as RParsed | undefined)?.content ?? "";
  // Shiny apps are R's web/service layer; the dep landing in Imports/
  // Depends/Suggests is the service signal.
  if (/(?:^|\s|,)shiny(?:\s*\(|\s*$|,)/im.test(c)) return "service";
  return "library";
}
