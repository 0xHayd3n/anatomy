// src/pass1/operation.ts
// entry_points + commands extraction per spec §4.2 step 5.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { DetectedManifest, Pass1Result } from "../types.js";

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? v as Record<string, unknown> : {};
}

type Operation = Pass1Result["operation"];

function npmEntryPoints(parsed: Record<string, unknown>): Operation["entryPoints"] {
  const out: Operation["entryPoints"] = [];
  // bin
  const bin = parsed.bin;
  if (typeof bin === "string") {
    out.push({ path: bin.replace(/^\.\//, ""), role: "cli" });
  } else if (bin && typeof bin === "object") {
    for (const v of Object.values(bin as Record<string, string>)) {
      if (typeof v === "string") out.push({ path: v.replace(/^\.\//, ""), role: "cli" });
    }
  }
  // main / exports — collect candidates then deduplicate by path+role
  const libraryPaths: string[] = [];
  const main = parsed.main;
  if (typeof main === "string") libraryPaths.push(main.replace(/^\.\//, ""));
  const exports_ = parsed.exports;
  if (typeof exports_ === "string") {
    libraryPaths.push(exports_.replace(/^\.\//, ""));
  } else if (exports_ && typeof exports_ === "object") {
    const dot = (exports_ as Record<string, unknown>)["."];
    if (typeof dot === "string") libraryPaths.push(dot.replace(/^\.\//, ""));
  }
  for (const p of [...new Set(libraryPaths)]) {
    out.push({ path: p, role: "library-root" });
  }
  return out;
}

// Canonical npm script names that AI consumers actually want surfaced.
// Filtering to this set guarantees the schema's maxProperties: 25 cap and
// keeps the section AI-readable (drops bespoke names like
// "build-for-flight-prod" or "css-prefix-examples-rtl" that bloat output
// without informing the consumer).
//
// Rule for matching: the part of the key BEFORE the first dot must be in
// this set. So "test", "test.unit", "test.e2e" all pass; "test-watch" or
// "build-for-flight-prod" don't.
const CANONICAL_NPM_SCRIPTS = new Set([
  // Development
  "dev", "start", "watch", "serve", "preview",
  // Build
  "build", "clean", "prebuild", "postbuild",
  // Test & quality
  "test", "pretest", "posttest", "lint", "format", "check", "typecheck",
  // Lifecycle (npm hooks; schema accepts only lowercase canonical-form keys,
  // so the camelCase `prepublishOnly` is excluded — it can't be emitted anyway)
  "prepare", "prepublish", "postinstall",
  // Docs & release
  "docs", "release",
]);

function isCanonicalNpmScript(key: string): boolean {
  // Existing canonical-form regex stays — gates dotted-namespace shapes.
  if (!/^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)?$/.test(key)) return false;
  // Match the prefix BEFORE the first dot against the whitelist. So
  // "test.unit" passes via "test" but "test-watch" doesn't.
  const root = key.split(".")[0];
  return CANONICAL_NPM_SCRIPTS.has(root);
}

function npmCommands(parsed: Record<string, unknown>): Operation["commands"] {
  const scripts = asObj(parsed.scripts);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(scripts)) {
    if (typeof v !== "string") continue;
    if (!isCanonicalNpmScript(k)) continue;
    if (v.length > 200) continue; // schema caps each value at 200 chars
    out[k] = v;
  }
  return out;
}

function cargoEntryPoints(parsed: Record<string, unknown>): Operation["entryPoints"] {
  const out: Operation["entryPoints"] = [];
  const bins = parsed.bin;
  if (Array.isArray(bins)) {
    for (const b of bins as Array<Record<string, unknown>>) {
      const p = typeof b.path === "string" ? b.path : (typeof b.name === "string" ? `src/bin/${b.name}.rs` : null);
      if (p) out.push({ path: p, role: "cli" });
    }
  }
  if (asObj(parsed.lib).path !== undefined || existsLibTable(parsed)) {
    const libPath = (asObj(parsed.lib).path as string | undefined) ?? "src/lib.rs";
    out.push({ path: libPath, role: "library-root" });
  }
  return out;
}

function existsLibTable(parsed: Record<string, unknown>): boolean {
  return parsed.lib !== undefined;
}

function pyprojectEntryPoints(parsed: Record<string, unknown>): Operation["entryPoints"] {
  const project = asObj(parsed.project);
  const scripts = asObj(project.scripts);
  const out: Operation["entryPoints"] = [];
  for (const v of Object.values(scripts)) {
    // pyproject scripts are "module:function" — the path we record is the module file
    if (typeof v === "string") {
      const modulePart = v.split(":")[0];
      const path = modulePart.replace(/\./g, "/") + ".py";
      out.push({ path, role: "cli" });
    }
  }
  return out;
}

function goEntryPoints(repoRoot: string): Operation["entryPoints"] {
  const cmdDir = join(repoRoot, "cmd");
  if (!existsSync(cmdDir)) return [];
  const out: Operation["entryPoints"] = [];
  try {
    for (const ent of readdirSync(cmdDir, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        const main = join("cmd", ent.name, "main.go").split(/[\\/]/).join("/");
        if (existsSync(join(repoRoot, main))) out.push({ path: main, role: "cli" });
      }
    }
  } catch {}
  return out;
}

export function deriveOperation(manifest: DetectedManifest | null, repoRoot: string): Operation {
  if (!manifest) return { entryPoints: [], commands: {} };
  const parsed = asObj(manifest.parsed);
  switch (manifest.kind) {
    case "npm":      return { entryPoints: npmEntryPoints(parsed), commands: npmCommands(parsed) };
    case "cargo":    return { entryPoints: cargoEntryPoints(parsed), commands: {} };
    case "pyproject": return { entryPoints: pyprojectEntryPoints(parsed), commands: {} };
    case "go":       return { entryPoints: goEntryPoints(repoRoot), commands: {} };
    case "dotnet":   return { entryPoints: [], commands: {} };
    case "java":     return { entryPoints: [], commands: {} };
    case "ruby":     return { entryPoints: [], commands: {} };
    case "php":      return { entryPoints: [], commands: {} };
    case "swift":    return { entryPoints: [], commands: {} };
    case "elixir":   return { entryPoints: [], commands: {} };
    case "zig":      return { entryPoints: [], commands: {} };
    case "dart":     return { entryPoints: [], commands: {} };
    case "haskell":  return { entryPoints: [], commands: {} };
    case "ocaml":    return { entryPoints: [], commands: {} };
    case "clojure":  return { entryPoints: [], commands: {} };
    case "crystal":  return { entryPoints: [], commands: {} };
    case "nim":      return { entryPoints: [], commands: {} };
    case "r":        return { entryPoints: [], commands: {} };
    case "julia":    return { entryPoints: [], commands: {} };
    case "erlang":   return { entryPoints: [], commands: {} };
    case "lua":      return { entryPoints: [], commands: {} };
    case "scala":    return { entryPoints: [], commands: {} };
    case "perl":     return { entryPoints: [], commands: {} };
    case "deno":     return { entryPoints: [], commands: {} };
    case "solidity": return { entryPoints: [], commands: {} };
    case "gleam":    return { entryPoints: [], commands: {} };
    case "cpp":      return { entryPoints: [], commands: {} };
    case "v":        return { entryPoints: [], commands: {} };
    case "terraform": return { entryPoints: [], commands: {} };
    case "helm":     return { entryPoints: [], commands: {} };
    case "godot":    return { entryPoints: [], commands: {} };
    case "github-action": return { entryPoints: [], commands: {} };
  }
}
