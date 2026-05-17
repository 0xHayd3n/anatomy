// Tests for the extension-dominance polyglot fallback in manifest/index.ts.
// This is the generic tie-breaker that fires when two primary manifests
// survive AND no pairwise polyglot rule disambiguated. It covers the
// recurring shape (Alamofire-as-ruby, Kong-as-cpp) without requiring a new
// pairwise rule per discovered pair.

import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectManifest } from "../src/pass1/manifest/index.js";

function mkRoot(): string {
  return mkdtempSync(join(tmpdir(), "anat-extdom-"));
}

function writeFiles(root: string, dir: string, baseName: string, ext: string, count: number): void {
  mkdirSync(join(root, dir), { recursive: true });
  for (let i = 0; i < count; i++) {
    writeFileSync(join(root, dir, `${baseName}${i}${ext}`), `// content ${i}\n`);
  }
}

describe("detectManifest — extension-dominance fallback", () => {
  it("Alamofire-shape: Gemfile (real gem) + Package.swift + many .swift files → swift", () => {
    // Sister-fix to the tooling-only Gemfile demotion. Even when the Gemfile
    // contains a "real" gem (so isPrimary stays true), the .swift extension
    // count under Source/ wins decisively over zero .rb files.
    const root = mkRoot();
    writeFileSync(join(root, "Gemfile"), `gem "rails"\ngem "fastlane"\n`);
    writeFileSync(join(root, "Package.swift"), `// swift-tools-version: 5.9\n`);
    writeFiles(root, "Source", "File", ".swift", 12);
    expect(detectManifest(root)?.kind).toBe("swift");
  });

  it("Kong-shape: real CMakeLists (with add_library) + many .lua files → lua", () => {
    // CMakeLists declares targets so isStubCMakeLists keeps it primary. The
    // extension-dominance fallback then tips the balance because .lua files
    // are >> .cpp files.
    const root = mkRoot();
    writeFileSync(join(root, "CMakeLists.txt"),
      "project(kong-native LANGUAGES C)\nadd_library(kong_native STATIC src/native.c)\n");
    writeFileSync(join(root, "kong-3.0.0-0.rockspec"),
      `package = "kong"\nversion = "3.0.0-0"\nbuild = { type = "builtin", modules = {} }\n`);
    writeFiles(root, "kong", "module", ".lua", 18);
    writeFiles(root, "kong/plugins", "plugin", ".lua", 14);
    expect(detectManifest(root)?.kind).toBe("lua");
  });

  it("close-call: 3 .swift files vs 2 .rb files → falls back to detect-order (ruby wins)", () => {
    // Threshold guard: under 5 dominant files OR less than 2x runner-up, we
    // do NOT flip the result. Detect-order (ruby before swift) wins.
    const root = mkRoot();
    writeFileSync(join(root, "Gemfile"), `gem "rails"\n`);
    writeFileSync(join(root, "Package.swift"), `// swift\n`);
    writeFiles(root, "src", "x", ".swift", 3);
    writeFiles(root, "src", "y", ".rb", 2);
    expect(detectManifest(root)?.kind).toBe("ruby");
  });

  it("near-empty repo with both manifests: detect-order (npm wins over cargo)", () => {
    // No source files in either ext set → score=0 for both → fallback to
    // detect-order (npm comes before cargo).
    const root = mkRoot();
    writeFileSync(join(root, "package.json"), `{"name":"x","main":"./index.js"}`);
    writeFileSync(join(root, "Cargo.toml"), `[package]\nname = "x"\nversion = "0.1.0"\n`);
    // No source files written.
    expect(detectManifest(root)?.kind).toBe("npm");
  });

  it("EXCLUDE_DIRS: .swift files inside node_modules/ do NOT count toward dominance", () => {
    // Counter would otherwise be polluted by vendored sources.
    const root = mkRoot();
    writeFileSync(join(root, "Gemfile"), `gem "rails"\n`);
    writeFileSync(join(root, "Package.swift"), `// swift\n`);
    writeFiles(root, "node_modules/some-pkg", "x", ".swift", 50);
    writeFiles(root, "src", "real", ".rb", 8);
    // Only 0 .swift counted (all in node_modules) vs 8 .rb → ruby wins.
    expect(detectManifest(root)?.kind).toBe("ruby");
  });

  it("EXCLUDE_DIRS: doc-build dirs (site/, _build/) are skipped", () => {
    // Mirrors the source-cross-check excludes. .swift inside site/ shouldn't
    // tip the count.
    const root = mkRoot();
    writeFileSync(join(root, "Gemfile"), `gem "rails"\n`);
    writeFileSync(join(root, "Package.swift"), `// swift\n`);
    writeFiles(root, "site", "noise", ".swift", 50);
    writeFiles(root, "_build", "more", ".swift", 50);
    writeFiles(root, "src", "real", ".rb", 8);
    expect(detectManifest(root)?.kind).toBe("ruby");
  });

  it("does NOT override a pairwise polyglot rule when one fires", () => {
    // cpp+swift with C/CXX project lang → existing pairwise rule picks cpp.
    // Even with a swift-file majority the pairwise rule wins (it runs first).
    const root = mkRoot();
    writeFileSync(join(root, "CMakeLists.txt"),
      "project(json LANGUAGES C CXX)\nadd_library(json INTERFACE)\n");
    writeFileSync(join(root, "Package.swift"), `// swift\n`);
    writeFiles(root, "wrappers", "x", ".swift", 30);
    writeFiles(root, "src", "y", ".cpp", 3);
    expect(detectManifest(root)?.kind).toBe("cpp");
  });
});
