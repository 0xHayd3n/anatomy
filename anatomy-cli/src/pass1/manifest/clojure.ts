// src/pass1/manifest/clojure.ts
// Detects Clojure projects via project.clj (Leiningen) or deps.edn
// (tools.deps). Stack: "clojure". Form heuristic: `:main` key in
// project.clj → cli-tool; web framework deps (compojure, ring, reitit,
// pedestal) → service; else library. No EDN parser — plain text match.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { DetectedManifest } from "../../types.js";

const MAX_MANIFEST_BYTES = 256 * 1024;

interface ClojureParsed {
  projectClj?: string;
  depsEdn?: string;
}

function readCapped(path: string): string | null {
  try {
    const st = statSync(path);
    if (!st.isFile() || st.size > MAX_MANIFEST_BYTES) return null;
    return readFileSync(path, "utf8");
  } catch { return null; }
}

export function detectClojure(repoRoot: string): DetectedManifest | null {
  const projPath = join(repoRoot, "project.clj");
  const depsPath = join(repoRoot, "deps.edn");
  const hasProj = existsSync(projPath);
  const hasDeps = existsSync(depsPath);
  if (!hasProj && !hasDeps) return null;

  return {
    kind: "clojure",
    path: hasProj ? projPath : depsPath,
    parsed: {
      projectClj: hasProj ? readCapped(projPath) ?? undefined : undefined,
      depsEdn: hasDeps ? readCapped(depsPath) ?? undefined : undefined,
    } satisfies ClojureParsed,
  };
}

const CLOJURE_SERVICE_FRAMEWORKS = ["compojure", "ring", "reitit", "pedestal", "kit", "luminus"];

export function clojureFormSuffix(parsed: unknown): "service" | "cli-tool" | "library" {
  const p = parsed as ClojureParsed | undefined;
  const proj = p?.projectClj ?? "";
  const deps = p?.depsEdn ?? "";
  const all = `${proj}\n${deps}`;

  // Self-name disqualifier: if the project IS one of the listed web
  // frameworks, it's the library itself, not a service that uses it.
  // Same false-positive class as Phoenix.PubSub in elixir.ts before its
  // word-boundary fix; here we read `(defproject NAME ...)` directly.
  const selfMatch = /\(defproject\s+([a-zA-Z0-9_-]+)/.exec(proj);
  const selfName = selfMatch?.[1]?.toLowerCase() ?? "";
  if (CLOJURE_SERVICE_FRAMEWORKS.includes(selfName)) return "library";

  if (/\b(?:compojure|ring|reitit|pedestal|kit|luminus)\b/.test(all)) return "service";
  if (/:main\s+\S/.test(all)) return "cli-tool";
  return "library";
}
