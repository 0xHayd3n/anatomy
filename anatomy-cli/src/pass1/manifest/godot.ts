// src/pass1/manifest/godot.ts
// Detects Godot projects via project.godot at repo root. Stack: "godot"
// (the engine is the stack; GDScript/.NET/C++ is the language and would
// require parsing the project.godot to determine — defer). Form:
// "desktop-app" — Godot games are conventionally desktop-shaped (also
// shipping to mobile/web, but "desktop-app" is the closest existing slug).

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { DetectedManifest } from "../../types.js";

const MAX_MANIFEST_BYTES = 256 * 1024;

interface GodotParsed {
  content: string;
}

export function detectGodot(repoRoot: string): DetectedManifest | null {
  const path = join(repoRoot, "project.godot");
  if (!existsSync(path)) return null;
  let content = "";
  try {
    const st = statSync(path);
    if (st.isFile() && st.size <= MAX_MANIFEST_BYTES) {
      content = readFileSync(path, "utf8");
    }
  } catch {}
  return { kind: "godot", path, parsed: { content } satisfies GodotParsed };
}

export function godotFormSuffix(_parsed: unknown): "desktop-app" {
  return "desktop-app";
}
