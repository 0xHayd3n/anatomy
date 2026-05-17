// src/pass1/manifest/dart.ts
// Detects Dart/Flutter projects via pubspec.yaml. Stack: "dart". Form
// heuristic: `executables:` section → cli-tool; `flutter:` section → desktop-
// app (Flutter targets desktop + mobile + web; "desktop-app" is the closest
// existing form slug to "GUI app"); else library. No YAML parser dependency
// — plain text match on the raw pubspec.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { DetectedManifest } from "../../types.js";

const MAX_MANIFEST_BYTES = 256 * 1024;

interface DartParsed {
  content: string;
}

export function detectDart(repoRoot: string): DetectedManifest | null {
  const path = join(repoRoot, "pubspec.yaml");
  if (!existsSync(path)) return null;
  let content = "";
  try {
    const st = statSync(path);
    if (st.isFile() && st.size <= MAX_MANIFEST_BYTES) {
      content = readFileSync(path, "utf8");
    }
  } catch {}
  return { kind: "dart", path, parsed: { content } satisfies DartParsed };
}

export function dartFormSuffix(parsed: unknown): "desktop-app" | "cli-tool" | "library" {
  const c = (parsed as DartParsed | undefined)?.content ?? "";
  // Flutter apps: GUI app shape.
  if (/^flutter\s*:/m.test(c)) return "desktop-app";
  // Pure-Dart CLI tools: executables: block.
  if (/^executables\s*:/m.test(c)) return "cli-tool";
  return "library";
}
