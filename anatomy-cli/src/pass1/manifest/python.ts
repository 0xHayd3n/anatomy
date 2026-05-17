// src/pass1/manifest/python.ts
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import type { DetectedManifest } from "../../types.js";
import { readManifest } from "../../io.js";

// Ecosystem files that indicate a Python project even without pyproject.toml.
// Ordered by richness of information they carry.
const PYTHON_ECOSYSTEM_FILES = ["setup.py", "requirements.txt", "Pipfile", "cog.yaml"] as const;

/** Last-resort fallback: 2+ loose .py files at repo root with no other
 *  manifest. Catches script-collection projects (data-pipeline, automation,
 *  one-off analyses) like the Star-Wars-Interactive-Galaxy-Map repo
 *  surfaced in the 2026-05-09 stress test. Only fires when no other
 *  Python-ecosystem file exists, so it doesn't override richer signals. */
const LOOSE_PY_THRESHOLD = 2;

function looseRootPyFileCount(repoRoot: string): number {
  try {
    return readdirSync(repoRoot, { withFileTypes: true })
      .filter(e => e.isFile() && e.name.endsWith(".py") && !e.name.startsWith("."))
      .length;
  } catch {
    return 0;
  }
}

// Project names ending in one of these suffixes are sidecar packages —
// helper scripts, FFI bindings, build tooling that ships alongside a
// real project in another stack. They shouldn't claim the repo as a
// Python project. llama.cpp ("llama-cpp-scripts" pyproject alongside
// CMakeLists.txt) was the motivating case in the 2026-05-09 GitHub
// stress test.
const SIDECAR_NAME_SUFFIXES = ["-scripts", "-tools", "-helpers", "-utils", "-bindings", "-build"];

function hasSidecarSuffix(name: string): boolean {
  return SIDECAR_NAME_SUFFIXES.some(suf => name.endsWith(suf));
}

/** A pyproject.toml is a primary product manifest when it declares a
 *  Python package — i.e. it has a [project] table OR a [build-system]
 *  table OR a [tool.poetry]/[tool.setuptools]/[tool.flit] section that
 *  carries package metadata. A pyproject.toml that only contains
 *  [tool.X] sections for linter/formatter/type-checker config (ruff,
 *  black, mypy, etc.) is a tooling sidecar — it doesn't make this
 *  repo a Python project. The Node.js runtime repo (a C++ project)
 *  ships such a pyproject.toml for its Ruff linter; pre-fix it
 *  classified as python-library.
 *
 *  Even when [project] is present, the package may be a sidecar to a
 *  real project in another stack — flagged via project.name suffix
 *  (-scripts, -tools, -bindings, etc.). */
function isPyprojectPrimary(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== "object") return false;
  const p = parsed as Record<string, unknown>;
  const project = p.project as Record<string, unknown> | undefined;
  if (project && typeof project === "object") {
    const name = project.name;
    if (typeof name === "string" && hasSidecarSuffix(name)) return false;
    return true;
  }
  if (p["build-system"] && typeof p["build-system"] === "object") return true;
  const tool = p.tool as Record<string, unknown> | undefined;
  if (tool && typeof tool === "object") {
    // Package-metadata tools (carry the actual package def).
    if (tool.poetry || tool.setuptools || tool.flit || tool.hatch || tool.pdm) return true;
  }
  return false;
}

export function detectPython(repoRoot: string): DetectedManifest | null {
  // Primary: pyproject.toml — richest, parseable
  const pyprojectPath = join(repoRoot, "pyproject.toml");
  if (existsSync(pyprojectPath)) {
    const text = readManifest(pyprojectPath);
    let parsed: unknown;
    try {
      parsed = parseToml(text);
    } catch (err) {
      throw new Error(`pyproject.toml at ${pyprojectPath} is not valid TOML: ${err instanceof Error ? err.message : String(err)}`);
    }
    return { kind: "pyproject", path: pyprojectPath, parsed, isPrimary: isPyprojectPrimary(parsed) };
  }

  // Fallback: presence of any other Python ecosystem file. setup.py /
  // requirements.txt / Pipfile / cog.yaml are themselves package or
  // env-spec files — primary by their nature.
  for (const name of PYTHON_ECOSYSTEM_FILES) {
    const p = join(repoRoot, name);
    if (existsSync(p)) return { kind: "pyproject", path: p, parsed: {}, isPrimary: true };
  }

  // Last-resort: loose .py files at repo root. Loose scripts are by
  // definition primary — there's no other manifest to compete with.
  if (looseRootPyFileCount(repoRoot) >= LOOSE_PY_THRESHOLD) {
    return { kind: "pyproject", path: repoRoot, parsed: {}, isPrimary: true };
  }

  return null;
}
