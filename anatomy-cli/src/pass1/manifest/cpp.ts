// src/pass1/manifest/cpp.ts
// Detects C/C++ projects via CMakeLists.txt (CMake), MODULE.bazel/BUILD/
// WORKSPACE (Bazel), or meson.build (Meson). Stack: "cpp" — defaulting
// to C++ since the build-system files don't reliably distinguish C from
// C++ (CMakeLists `project(... C)` vs `project(... CXX)` would tell us
// but parsing CMake DSL is non-trivial). Form heuristic: `add_executable`
// in CMakeLists → cli-tool; `add_library`/`set_target_properties` only
// → library. Bazel/Meson default to library.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { DetectedManifest } from "../../types.js";

const MAX_MANIFEST_BYTES = 256 * 1024;

interface CppParsed {
  buildSystem: "cmake" | "bazel" | "meson";
  content: string;
}

function readCapped(path: string): string {
  try {
    const st = statSync(path);
    if (!st.isFile() || st.size > MAX_MANIFEST_BYTES) return "";
    return readFileSync(path, "utf8");
  } catch { return ""; }
}

// Heuristic: a CMakeLists.txt that defines no `add_executable` AND no
// `add_library` AND no `project(... LANGUAGES ...)` declaration is build-helper
// scaffolding (e.g. a thin wrapper that builds a small native bit for an
// otherwise-non-cpp project). Demote to non-primary so polyglot fallback can
// pick the real primary manifest. Catches the v0.12 50-repo Kong case where
// CMakeLists beat the lua loose-files fallback. Conservative — a real C/C++
// build will always declare at least one of these.
function isStubCMakeLists(content: string): boolean {
  if (!content) return true; // empty / unreadable CMakeLists is not a real cpp signal
  const hasTarget = /\b(?:add_executable|add_library)\s*\(/i.test(content);
  const hasProjectLang = /\bproject\s*\([^)]*\bLANGUAGES\b/i.test(content);
  return !hasTarget && !hasProjectLang;
}

export function detectCpp(repoRoot: string): DetectedManifest | null {
  const cmake = join(repoRoot, "CMakeLists.txt");
  if (existsSync(cmake)) {
    const content = readCapped(cmake);
    const result: DetectedManifest = {
      kind: "cpp",
      path: cmake,
      parsed: { buildSystem: "cmake", content } satisfies CppParsed,
    };
    if (isStubCMakeLists(content)) result.isPrimary = false;
    return result;
  }
  // Bazel: prefer MODULE.bazel (modern Bzlmod) but also accept WORKSPACE
  // or BUILD files at root. BUILD/BUILD.bazel at root is common.
  for (const name of ["MODULE.bazel", "WORKSPACE", "WORKSPACE.bazel", "BUILD", "BUILD.bazel"]) {
    const p = join(repoRoot, name);
    if (existsSync(p)) {
      return { kind: "cpp", path: p, parsed: { buildSystem: "bazel", content: readCapped(p) } satisfies CppParsed };
    }
  }
  const meson = join(repoRoot, "meson.build");
  if (existsSync(meson)) {
    return { kind: "cpp", path: meson, parsed: { buildSystem: "meson", content: readCapped(meson) } satisfies CppParsed };
  }
  return null;
}

export function cppFormSuffix(parsed: unknown): "cli-tool" | "library" {
  const p = parsed as CppParsed | undefined;
  const c = p?.content ?? "";
  // CMake `add_executable(...)` declares a CLI/binary target.
  if (p?.buildSystem === "cmake" && /add_executable\s*\(/i.test(c)) return "cli-tool";
  // Meson `executable(...)` similar.
  if (p?.buildSystem === "meson" && /\bexecutable\s*\(/i.test(c)) return "cli-tool";
  return "library";
}
