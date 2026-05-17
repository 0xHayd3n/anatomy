// src/pass1/substance.ts
// key_dependencies extraction per spec §4.2 step 6.
// Top 5 from manifest's first-party deps. Each "why" is a placeholder.
// capabilities/limitations always omitted (need narrative input).

import type { DetectedManifest, Pass1Result } from "../types.js";

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? v as Record<string, unknown> : {};
}

const MAX_DEPS = 5;

function placeholder(names: string[]): Pass1Result["substance"]["keyDependencies"] {
  return names.slice(0, MAX_DEPS).map(name => ({ name, why: "todo-why", isPlaceholder: true }));
}

function npmDeps(parsed: Record<string, unknown>): string[] {
  return Object.keys(asObj(parsed.dependencies));
}

function cargoDeps(parsed: Record<string, unknown>): string[] {
  return Object.keys(asObj(parsed.dependencies));
}

function pyprojectDeps(parsed: Record<string, unknown>): string[] {
  const project = asObj(parsed.project);
  const list = project.dependencies;
  if (!Array.isArray(list)) return [];
  // PEP 508 strings: "name [extras] (version)" — extract leading name token
  return list
    .filter((s): s is string => typeof s === "string")
    .map(s => s.split(/[\s\[<>=!~;]/)[0])
    .filter(Boolean);
}

function goDeps(parsed: Record<string, unknown>): string[] {
  const deps = parsed.deps;
  if (!Array.isArray(deps)) return [];
  return deps.filter((d): d is string => typeof d === "string");
}

export function deriveSubstance(manifest: DetectedManifest | null): Pass1Result["substance"] {
  if (!manifest) return { keyDependencies: [] };
  const parsed = asObj(manifest.parsed);
  switch (manifest.kind) {
    case "npm":      return { keyDependencies: placeholder(npmDeps(parsed)) };
    case "cargo":    return { keyDependencies: placeholder(cargoDeps(parsed)) };
    case "pyproject": return { keyDependencies: placeholder(pyprojectDeps(parsed)) };
    case "go":       return { keyDependencies: placeholder(goDeps(parsed)) };
    case "dotnet":   return { keyDependencies: [] };
    case "java":     return { keyDependencies: [] };
    case "ruby":     return { keyDependencies: [] };
    case "php":      return { keyDependencies: [] };
    case "swift":    return { keyDependencies: [] };
    case "elixir":   return { keyDependencies: [] };
    case "zig":      return { keyDependencies: [] };
    case "dart":     return { keyDependencies: [] };
    case "haskell":  return { keyDependencies: [] };
    case "ocaml":    return { keyDependencies: [] };
    case "clojure":  return { keyDependencies: [] };
    case "crystal":  return { keyDependencies: [] };
    case "nim":      return { keyDependencies: [] };
    case "r":        return { keyDependencies: [] };
    case "julia":    return { keyDependencies: [] };
    case "erlang":   return { keyDependencies: [] };
    case "lua":      return { keyDependencies: [] };
    case "scala":    return { keyDependencies: [] };
    case "perl":     return { keyDependencies: [] };
    case "deno":     return { keyDependencies: [] };
    case "solidity": return { keyDependencies: [] };
    case "gleam":    return { keyDependencies: [] };
    case "cpp":      return { keyDependencies: [] };
    case "v":        return { keyDependencies: [] };
    case "terraform": return { keyDependencies: [] };
    case "helm":     return { keyDependencies: [] };
    case "godot":    return { keyDependencies: [] };
    case "github-action": return { keyDependencies: [] };
  }
}
