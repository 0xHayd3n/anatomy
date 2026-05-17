// src/pass1/manifest/index.ts
import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { DetectedManifest } from "../../types.js";
import { detectNpm } from "./npm.js";
import { detectCargo } from "./cargo.js";
import { detectPython } from "./python.js";
import { detectGo } from "./go.js";
import { detectDotnet } from "./dotnet.js";
import { detectJava } from "./java.js";
import { detectRuby } from "./ruby.js";
import { detectPhp } from "./php.js";
import { detectSwift } from "./swift.js";
import { detectElixir } from "./elixir.js";
import { detectZig } from "./zig.js";
import { detectDart } from "./dart.js";
import { detectHaskell } from "./haskell.js";
import { detectOcaml } from "./ocaml.js";
import { detectClojure } from "./clojure.js";
import { detectCrystal } from "./crystal.js";
import { detectNim } from "./nim.js";
import { detectR } from "./r.js";
import { detectJulia } from "./julia.js";
import { detectErlang } from "./erlang.js";
import { detectLua } from "./lua.js";
import { detectScala } from "./scala.js";
import { detectPerl } from "./perl.js";
import { detectDeno } from "./deno.js";
import { detectSolidity } from "./solidity.js";
import { detectGleam } from "./gleam.js";
import { detectCpp } from "./cpp.js";
import { detectV } from "./v.js";
import { detectTerraform } from "./terraform.js";
import { detectHelm } from "./helm.js";
import { detectGodot } from "./godot.js";
import { detectGithubAction } from "./github-action.js";
import { debug } from "../../log.js";

// Count files with the given extensions directly in repoRoot (non-recursive).
function countRootFiles(repoRoot: string, exts: string[]): number {
  try {
    return readdirSync(repoRoot, { withFileTypes: true })
      .filter(e => e.isFile() && exts.some(x => e.name.endsWith(x)))
      .length;
  } catch {
    return 0;
  }
}

// When both npm and python manifest signals exist, decide the primary language
// by counting .py vs .ts/.js files at the repo root. This handles the common
// case of A1111-style WebUI forks (and similar) that carry a stub package.json
// even though the project is fundamentally Python.
function preferPython(repoRoot: string, python: { parsed: unknown } | null): boolean {
  // pyproject.toml with a [project] table declaring a name is the strongest
  // signal: this package is publishable to PyPI and the project considers
  // itself a Python package. Catches dual-published shapes like
  // mkdocs-material (real on both PyPI and npm).
  if (python) {
    const parsed = python.parsed as Record<string, unknown> | null | undefined;
    const projectTable = parsed?.project;
    if (projectTable && typeof projectTable === "object") {
      const project = projectTable as Record<string, unknown>;
      if (typeof project.name === "string") {
        debug(`manifest: npm+python — pyproject [project].name=${project.name}, preferring python`);
        return true;
      }
    }
  }
  // Fallback: file-count heuristic for older Python repos using setup.py
  // or no [project] declaration.
  const pyCount = countRootFiles(repoRoot, [".py"]);
  const jsCount = countRootFiles(repoRoot, [".ts", ".js", ".mjs", ".cjs"]);
  debug(`manifest: npm+python — root .py=${pyCount} vs .ts/.js=${jsCount}`);
  return pyCount > jsCount;
}

/** Treat the manifest as primary unless explicitly flagged false. The
 *  contract is default-true: detectors that don't set isPrimary are always
 *  primary (the typical case for foundry.toml, mix.exs, gleam.toml, etc.
 *  — single-usage formats). Dual-usage formats (npm package.json,
 *  pyproject.toml, Cargo.toml) set isPrimary=false on tooling-stub shapes
 *  via format-specific checks in their own detectors. */
function isPrimary(m: DetectedManifest | null): m is DetectedManifest {
  return m !== null && m.isPrimary !== false;
}

/** Source-file extensions associated with each detector kind. Used by the
 *  extension-dominance fallback to pick a winner among competing primary
 *  manifests when no pairwise polyglot rule fires.
 *
 *  Only kinds that appeared as a recurring polyglot ambiguity are listed —
 *  the fallback is a tie-breaker, not a primary detector, so kinds without
 *  realistic polyglot conflicts are intentionally absent. The fallback
 *  silently skips kinds it doesn't know. */
const STACK_EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
  swift:    [".swift"],
  ruby:     [".rb", ".rake"],
  lua:      [".lua"],
  cpp:      [".cpp", ".cc", ".cxx", ".hpp", ".h"],
  python:   [".py", ".pyi"],
  npm:      [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
  cargo:    [".rs"],
  go:       [".go"],
  java:     [".java", ".kt", ".kts"],
  dotnet:   [".cs", ".fs", ".vb"],
  haskell:  [".hs", ".lhs"],
  elixir:   [".ex", ".exs"],
  erlang:   [".erl", ".hrl"],
  php:      [".php"],
  dart:     [".dart"],
  nim:      [".nim"],
};

const EXT_WALK_SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "target", "out",
  ".next", ".turbo", "__pycache__", ".pytest_cache",
  ".venv", "venv", "coverage", ".cache", "vendor",
  // Documentation build outputs (mirrors anatomy-validate's set).
  "site", "_site", "_build",
]);

/** Count files matching `exts` under `repoRoot`, walking up to depth 2 and
 *  skipping noisy directories. Caps at `maxFiles` because we only need a
 *  tie-breaker, not a precise census. Cheap enough to run on every detect()
 *  call: depth-2 walks are tens of stat() calls on a typical repo. */
function countByExt(repoRoot: string, exts: readonly string[], maxFiles = 200): number {
  if (exts.length === 0) return 0;
  let n = 0;
  function walk(dir: string, depth: number) {
    if (depth > 2 || n >= maxFiles) return;
    let ents;
    try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (n >= maxFiles) return;
      if (e.isDirectory()) {
        if (EXT_WALK_SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
        walk(join(dir, e.name), depth + 1);
      } else if (e.isFile()) {
        for (const x of exts) {
          if (e.name.endsWith(x)) { n++; break; }
        }
      }
    }
  }
  walk(repoRoot, 0);
  return n;
}

/** Tie-breaker for competing primary manifests when no pairwise polyglot
 *  rule covered the pair. Returns the manifest whose stack's source-file
 *  extensions dominate the repo by a clear margin, or null when the result
 *  is too close to call (caller falls back to detect-order). */
function pickByExtensionDominance(
  primaries: readonly DetectedManifest[],
  repoRoot: string,
): DetectedManifest | null {
  if (primaries.length < 2) return null;
  const scored = primaries.map(m => ({
    manifest: m,
    score: countByExt(repoRoot, STACK_EXTENSIONS[m.kind] ?? []),
  }));
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  const runnerUp = scored[1];
  // Require a clear margin: top must be >= 2× runner-up AND have at least
  // 5 files. Otherwise fall back to detect-order — we don't want to flip
  // close calls or near-empty repos.
  if (top.score >= 5 && top.score >= 2 * Math.max(1, runnerUp.score)) {
    return top.manifest;
  }
  return null;
}

/** A CMakeLists.txt that explicitly declares Swift as a project language
 *  (e.g. swift-argument-parser ships one to build Swift on Linux) is
 *  build-support for the Swift package, not a C++ project. The cpp+swift
 *  polyglot rule should NOT fire in that case. */
function cppIsNotSwiftBuildSupport(cpp: DetectedManifest): boolean {
  const parsed = cpp.parsed as { content?: string } | null | undefined;
  const content = parsed?.content ?? "";
  // project(... LANGUAGES Swift) or set_target_properties(... Swift_) etc.
  if (/\bLANGUAGES\s+(?:[A-Za-z]+\s+)*Swift\b/i.test(content)) return false;
  return true;
}

export function detectManifest(repoRoot: string): DetectedManifest | null {
  // Run every detector once. Order matters for the default fallback: the
  // first primary detector wins, with niche/last-resort detectors (lua's
  // loose-.lua-files fallback) at the tail so they don't false-match
  // when something stronger is present.
  const detected: DetectedManifest[] = [];
  for (const d of [
    detectNpm, detectCargo, detectPython, detectGo, detectDotnet,
    detectJava, detectRuby, detectPhp, detectSwift, detectElixir, detectZig,
    detectDart, detectHaskell, detectOcaml, detectClojure, detectCrystal, detectNim,
    detectR, detectJulia, detectErlang, detectScala, detectPerl, detectDeno,
    detectSolidity, detectGleam, detectV, detectCpp,
    detectTerraform, detectHelm, detectGodot, detectGithubAction,
    detectLua,  // last — has a loose-.lua-files fallback
  ]) {
    const r = d(repoRoot);
    if (r) detected.push(r);
  }

  // Index by kind for polyglot rules.
  const byKind = new Map<string, DetectedManifest>();
  for (const m of detected) byKind.set(m.kind, m);
  const get = (kind: string) => byKind.get(kind) ?? null;

  // Polyglot priority rules — applied only when BOTH manifests are
  // primary (genuine competing-primary cases that need explicit
  // precedence). Stub-vs-primary cases (mdBook's eslint-only package.json
  // alongside cargo, nodejs/node's ruff-only pyproject.toml) collapse
  // into the default fallback below: stubs are filtered out via isPrimary,
  // so the surviving real primary wins. No special rule needed for those.
  const cpp = get("cpp"), swift = get("swift");
  const npm = get("npm"), cargo = get("cargo"), pyproject = get("pyproject");
  const elixir = get("elixir"), solidity = get("solidity");

  let chosen: DetectedManifest | null = null;
  if (isPrimary(cpp) && isPrimary(swift) && cppIsNotSwiftBuildSupport(cpp)) {
    // Only fire the cpp-over-swift rule when the CMake/Bazel/Meson build
    // declares C/C++. swift-argument-parser ships a CMakeLists.txt to
    // build *Swift* on Linux (set(... LANGUAGES Swift)) — that's not a
    // C++ project with Swift bindings, it's a Swift project with a
    // cross-platform build. Pre-fix this regressed swift-spm to cpp.
    debug(`manifest: preferring cpp (${cpp.path}) over swift bindings (${swift.path})`);
    chosen = cpp;
  } else if (isPrimary(npm) && isPrimary(solidity)) {
    debug(`manifest: preferring solidity (${solidity.path}) over npm (${npm.path}) — OpenZeppelin shape`);
    chosen = solidity;
  } else if (isPrimary(pyproject) && isPrimary(cargo)) {
    debug(`manifest: preferring python (${pyproject.path}) over cargo (PyO3 shape)`);
    chosen = pyproject;
  } else if (isPrimary(npm) && isPrimary(elixir)) {
    debug(`manifest: preferring elixir (${elixir.path}) over npm (${npm.path}) — phoenix_html shape`);
    chosen = elixir;
  } else if (isPrimary(npm) && isPrimary(pyproject) && preferPython(repoRoot, pyproject)) {
    debug(`manifest: preferring python (${pyproject.path}) over npm (${npm.path})`);
    chosen = pyproject;
  } else {
    // Default branch: no pairwise polyglot rule fired. When 2+ primary
    // manifests survive, try extension-dominance as a generic tie-breaker
    // before falling back to detect-order. This catches polyglot pairs the
    // pairwise rules don't cover (e.g. Ruby-vs-Swift Alamofire-shape if the
    // Gemfile-tooling check missed it; cpp-vs-Lua Kong-shape if CMakeLists
    // declared targets) without requiring a new pairwise rule per shape.
    const primaries = detected.filter(isPrimary);
    if (primaries.length >= 2) {
      const dominant = pickByExtensionDominance(primaries, repoRoot);
      if (dominant) {
        debug(`manifest: extension-dominance picked ${dominant.kind} (${dominant.path}) over ${primaries.filter(p => p !== dominant).map(p => p.kind).join("+")}`);
        chosen = dominant;
      } else {
        // Result was too close to call; preserve detect-order behavior.
        chosen = primaries[0];
      }
    } else {
      // 0 or 1 primary. If NO primary manifests detected (only tooling stubs —
      // e.g., nodejs/node has only a ruff-config pyproject.toml, or a docs
      // repo has only a lint-only package.json), still return the first stub.
      // The stack-deriver in identity.ts checks isPrimary explicitly and emits
      // todo-stack when the only manifest is a stub; other Pass 1 derivers
      // (tagline, description) continue to use the stub for any useful fields
      // it happens to carry.
      chosen = primaries[0] ?? detected[0] ?? null;
    }
  }

  if (chosen) {
    const stubNote = chosen.isPrimary === false
      ? " (stub — caller should treat as no-primary-stack)"
      : "";
    debug(`manifest: detected ${chosen.kind} at ${chosen.path}${stubNote}`);
  } else {
    debug(`manifest: none detected in ${repoRoot}`);
  }
  return chosen;
}

export { isNpmStub } from "./npm.js";
