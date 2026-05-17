// src/pass1/manifest/lua.ts
// Detects Lua projects via *.rockspec (LuaRocks) at root, in rockspecs/, or
// in rocks/, plus a loose .lua-files-at-root fallback. Stack: "lua". Form
// heuristic: rockspec build.modules dominantly named — library; lapis or
// pegasus or lua-http dep → service; else library.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { DetectedManifest } from "../../types.js";

const MAX_MANIFEST_BYTES = 256 * 1024;
const LOOSE_LUA_THRESHOLD = 2;

interface LuaParsed {
  rockspecPath?: string;
  rockspecContent?: string;
}

function findRockspec(repoRoot: string): string | null {
  // 1. *.rockspec at root.
  try {
    for (const e of readdirSync(repoRoot, { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith(".rockspec")) return join(repoRoot, e.name);
    }
  } catch {}
  // 2. rockspecs/ or rocks/ subdirectory.
  for (const subdir of ["rockspecs", "rocks"]) {
    const p = join(repoRoot, subdir);
    try {
      const st = statSync(p);
      if (!st.isDirectory()) continue;
      for (const e of readdirSync(p, { withFileTypes: true })) {
        if (e.isFile() && e.name.endsWith(".rockspec")) return join(p, e.name);
      }
    } catch {}
  }
  return null;
}

function looseRootLuaFileCount(repoRoot: string): number {
  try {
    return readdirSync(repoRoot, { withFileTypes: true })
      .filter(e => e.isFile() && e.name.endsWith(".lua") && !e.name.startsWith("."))
      .length;
  } catch {
    return 0;
  }
}

export function detectLua(repoRoot: string): DetectedManifest | null {
  const rockspecPath = findRockspec(repoRoot);
  let rockspecContent: string | undefined;
  if (rockspecPath) {
    try {
      const st = statSync(rockspecPath);
      if (st.isFile() && st.size <= MAX_MANIFEST_BYTES) {
        rockspecContent = readFileSync(rockspecPath, "utf8");
      }
    } catch {}
    return { kind: "lua", path: rockspecPath, parsed: { rockspecPath, rockspecContent } satisfies LuaParsed };
  }
  // Loose-Lua fallback.
  if (looseRootLuaFileCount(repoRoot) >= LOOSE_LUA_THRESHOLD) {
    return { kind: "lua", path: repoRoot, parsed: {} satisfies LuaParsed };
  }
  // Single root .lua file alone is also a valid signal — rockspec-less
  // libraries like middleclass ship middleclass.lua at root with rockspecs/
  // already captured by findRockspec. This branch handles the bare case.
  if (looseRootLuaFileCount(repoRoot) >= 1) {
    return { kind: "lua", path: repoRoot, parsed: {} satisfies LuaParsed };
  }
  return null;
}

export function luaFormSuffix(parsed: unknown): "service" | "library" {
  const c = (parsed as LuaParsed | undefined)?.rockspecContent ?? "";
  // Common Lua web frameworks.
  if (/\b(?:lapis|pegasus|openresty|lua-http|sailor)\b/.test(c)) return "service";
  return "library";
}
