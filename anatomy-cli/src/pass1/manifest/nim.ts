// src/pass1/manifest/nim.ts
// Detects Nim projects via *.nimble at root (one or more — convention is
// one nimble file per package, named after the package). Stack: "nim".
// Form heuristic: `bin = @[...]` declaration in nimble → cli-tool; jester
// or prologue dep → service; else library.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { DetectedManifest } from "../../types.js";

const MAX_MANIFEST_BYTES = 256 * 1024;

interface NimParsed {
  content: string;
  /** Package name derived from the .nimble filename (jester.nimble → "jester"). */
  packageName: string;
}

function findNimble(repoRoot: string): string | null {
  try {
    for (const e of readdirSync(repoRoot, { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith(".nimble")) return join(repoRoot, e.name);
    }
  } catch {}
  return null;
}

export function detectNim(repoRoot: string): DetectedManifest | null {
  const path = findNimble(repoRoot);
  if (!path) return null;
  let content = "";
  try {
    const st = statSync(path);
    if (st.isFile() && st.size <= MAX_MANIFEST_BYTES) {
      content = readFileSync(path, "utf8");
    }
  } catch {}
  const packageName = basename(path).replace(/\.nimble$/, "").toLowerCase();
  return { kind: "nim", path, parsed: { content, packageName } satisfies NimParsed };
}

const NIM_SERVICE_FRAMEWORKS = ["jester", "prologue", "httpbeast", "karax", "happyx"];

export function nimFormSuffix(parsed: unknown): "service" | "cli-tool" | "library" {
  const p = parsed as NimParsed | undefined;
  const c = p?.content ?? "";
  // Self-name disqualifier: a project named jester.nimble IS jester (the
  // web framework), not a service that uses it. Same false-positive class
  // as compojure → service, fixed via self-name lookup.
  if (NIM_SERVICE_FRAMEWORKS.includes(p?.packageName ?? "")) {
    if (/^bin\s*=\s*@\[/m.test(c)) return "cli-tool";
    return "library";
  }
  if (new RegExp(`requires\\s+["'](?:${NIM_SERVICE_FRAMEWORKS.join("|")})`, "i").test(c)) return "service";
  if (/^bin\s*=\s*@\[/m.test(c)) return "cli-tool";
  return "library";
}
