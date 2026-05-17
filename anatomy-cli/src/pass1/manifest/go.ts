// src/pass1/manifest/go.ts
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { DetectedManifest } from "../../types.js";
import { readManifest } from "../../io.js";

export function parseGoRequire(text: string): string[] {
  const deps: string[] = [];
  // Multi-line require blocks: require ( ... )
  const blockRe = /\brequire\s*\(([^)]*)\)/gs;
  for (const m of text.matchAll(blockRe)) {
    for (const line of m[1].split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("//")) continue;
      if (trimmed.includes("// indirect")) continue;
      const mod = trimmed.split(/\s+/)[0];
      if (mod) deps.push(mod);
    }
  }
  // Single-line require: require module/path v1.2.3 [// indirect]
  // Negative lookahead excludes block-form openers like `require (`
  const singleRe = /^require\s+(?!\()(\S+)\s+\S+/gm;
  for (const m of text.matchAll(singleRe)) {
    const lineEnd = text.indexOf("\n", m.index);
    const fullLine = text.slice(m.index, lineEnd === -1 ? undefined : lineEnd);
    if (fullLine.includes("// indirect")) continue;
    deps.push(m[1]);
  }
  return deps;
}

export function detectGo(repoRoot: string): DetectedManifest | null {
  const path = join(repoRoot, "go.mod");
  if (!existsSync(path)) return null;
  const text = readManifest(path);
  const moduleMatch = text.match(/^\s*module\s+(\S+)/m);
  const goMatch = text.match(/^\s*go\s+(\S+)/m);
  return {
    kind: "go",
    path,
    parsed: {
      module: moduleMatch?.[1] ?? "",
      goVersion: goMatch?.[1] ?? "",
      deps: parseGoRequire(text),
    },
  };
}
