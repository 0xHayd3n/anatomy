import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectCpp, cppFormSuffix } from "../src/pass1/manifest/cpp.js";
import { detectManifest } from "../src/pass1/manifest/index.js";

describe("detectCpp", () => {
  it("returns null without any C/C++ build file", () => {
    expect(detectCpp(mkdtempSync(join(tmpdir(), "anat-cpp-")))).toBeNull();
  });

  it("detects CMakeLists.txt", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-cpp-"));
    writeFileSync(join(root, "CMakeLists.txt"), 'project(myapp CXX)\nadd_library(myapp STATIC src/main.cpp)');
    const r = detectCpp(root);
    expect(r?.kind).toBe("cpp");
    expect((r?.parsed as { buildSystem: string }).buildSystem).toBe("cmake");
  });

  it("detects Bazel via MODULE.bazel", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-cpp-"));
    writeFileSync(join(root, "MODULE.bazel"), 'module(name = "myapp")');
    expect(detectCpp(root)?.kind).toBe("cpp");
  });

  it("detects Meson via meson.build", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-cpp-"));
    writeFileSync(join(root, "meson.build"), "project('myapp', 'cpp')");
    expect(detectCpp(root)?.kind).toBe("cpp");
  });
});

describe("detectCpp — stub CMakeLists demotion (isPrimary=false)", () => {
  it("CMakeLists with no add_executable / add_library / project(LANGUAGES ...) is non-primary", () => {
    // Helper-only CMakeLists pattern (ships in Lua/Python/etc. projects to
    // build a small native bit). Demoted so polyglot fallback picks the real
    // primary manifest.
    const root = mkdtempSync(join(tmpdir(), "anat-cpp-"));
    writeFileSync(join(root, "CMakeLists.txt"),
      "cmake_minimum_required(VERSION 3.10)\nproject(helper)\ninclude(FindLua)\n");
    const r = detectCpp(root);
    expect(r?.kind).toBe("cpp");
    expect(r?.isPrimary).toBe(false);
  });

  it("CMakeLists with add_executable stays primary", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-cpp-"));
    writeFileSync(join(root, "CMakeLists.txt"),
      "project(myapp)\nadd_executable(myapp src/main.cpp)\n");
    const r = detectCpp(root);
    expect(r?.isPrimary).toBeUndefined();
  });

  it("CMakeLists with add_library stays primary", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-cpp-"));
    writeFileSync(join(root, "CMakeLists.txt"),
      "project(mylib)\nadd_library(mylib STATIC src/x.cpp)\n");
    const r = detectCpp(root);
    expect(r?.isPrimary).toBeUndefined();
  });

  it("CMakeLists with project(... LANGUAGES CXX) stays primary even without a target", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-cpp-"));
    writeFileSync(join(root, "CMakeLists.txt"),
      "project(myapp LANGUAGES CXX)\n# targets configured elsewhere\n");
    const r = detectCpp(root);
    expect(r?.isPrimary).toBeUndefined();
  });

  it("empty CMakeLists is non-primary", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-cpp-"));
    writeFileSync(join(root, "CMakeLists.txt"), "");
    const r = detectCpp(root);
    expect(r?.isPrimary).toBe(false);
  });
});

describe("cppFormSuffix", () => {
  it("CMake add_executable → cli-tool", () => {
    expect(cppFormSuffix({ buildSystem: "cmake", content: "add_executable(myapp src/main.cpp)" })).toBe("cli-tool");
  });

  it("CMake add_library only → library", () => {
    expect(cppFormSuffix({ buildSystem: "cmake", content: "add_library(myapp STATIC src/main.cpp)" })).toBe("library");
  });

  it("Meson executable() → cli-tool", () => {
    expect(cppFormSuffix({ buildSystem: "meson", content: "executable('myapp', 'main.cpp')" })).toBe("cli-tool");
  });

  it("Bazel default → library", () => {
    expect(cppFormSuffix({ buildSystem: "bazel", content: "module(name = 'x')" })).toBe("library");
  });
});

describe("detectManifest polyglot: C++ wins over Swift bindings", () => {
  it("nlohmann/json-shape: CMakeLists.txt + Package.swift → cpp", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-cpp-"));
    writeFileSync(join(root, "CMakeLists.txt"), "project(json CXX)\nadd_library(json INTERFACE)");
    writeFileSync(join(root, "Package.swift"), "// swift-tools-version: 5.9\nimport PackageDescription");
    expect(detectManifest(root)?.kind).toBe("cpp");
  });
});
