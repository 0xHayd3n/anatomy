import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveOperation } from "../src/pass1/operation.js";
import type { DetectedManifest } from "../src/types.js";

const npm = (parsed: object): DetectedManifest => ({ kind: "npm", path: "", parsed });

describe("deriveOperation — npm", () => {
  it("extracts string bin", () => {
    const r = deriveOperation(npm({ name: "x", bin: "./cli.js" }), "/tmp");
    expect(r.entryPoints).toEqual([{ path: "cli.js", role: "cli" }]);
  });

  it("extracts object bin", () => {
    const r = deriveOperation(npm({ name: "x", bin: { foo: "./foo.js", bar: "./bar.js" } }), "/tmp");
    expect(r.entryPoints).toHaveLength(2);
    expect(r.entryPoints.every(e => e.role === "cli")).toBe(true);
  });

  it("extracts main as library-root", () => {
    const r = deriveOperation(npm({ name: "x", main: "./index.js" }), "/tmp");
    expect(r.entryPoints).toEqual([{ path: "index.js", role: "library-root" }]);
  });

  it("extracts canonical-form scripts only", () => {
    const r = deriveOperation(npm({ name: "x", scripts: { build: "tsc", "test:unit": "vitest", "BadKey": "x" } }), "/tmp");
    expect(r.commands).toEqual({ build: "tsc" });
    // BadKey skipped (uppercase); "test:unit" skipped (colon not in canonical regex)
  });

  it("accepts dotted command keys", () => {
    const r = deriveOperation(npm({ name: "x", scripts: { build: "tsc", "test.unit": "vitest --run" } }), "/tmp");
    expect(r.commands).toEqual({ build: "tsc", "test.unit": "vitest --run" });
  });

  it("filters scripts to canonical whitelist (drops bespoke names)", () => {
    const r = deriveOperation(
      npm({
        name: "x",
        scripts: {
          build: "tsc",
          test: "vitest",
          lint: "eslint .",
          "build-for-flight-prod": "huge bespoke command",
          "css-prefix-examples-rtl": "another bespoke",
          "download-build-in-codesandbox-ci": "yet another",
        },
      }),
      "/tmp",
    );
    expect(Object.keys(r.commands).sort()).toEqual(["build", "lint", "test"]);
  });

  it("drops canonical scripts whose value exceeds 200 chars", () => {
    const longCmd = "node " + "x".repeat(250);
    const r = deriveOperation(
      npm({ name: "x", scripts: { build: "tsc", test: longCmd } }),
      "/tmp",
    );
    expect(r.commands).toEqual({ build: "tsc" });
  });

  it("keeps dotted canonical variants (test.unit, build.css)", () => {
    const r = deriveOperation(
      npm({ name: "x", scripts: { test: "vitest", "test.unit": "vitest unit", "build.css": "sass" } }),
      "/tmp",
    );
    expect(r.commands).toEqual({ test: "vitest", "test.unit": "vitest unit", "build.css": "sass" });
  });
});

describe("deriveOperation — cargo", () => {
  it("extracts [[bin]] entries", () => {
    const m: DetectedManifest = { kind: "cargo", path: "", parsed: { package: { name: "x" }, bin: [{ name: "x", path: "src/main.rs" }] } };
    const r = deriveOperation(m, "/tmp");
    expect(r.entryPoints).toEqual([{ path: "src/main.rs", role: "cli" }]);
  });

  it("extracts [lib] when present", () => {
    const m: DetectedManifest = { kind: "cargo", path: "", parsed: { package: { name: "x" }, lib: { path: "src/lib.rs" } } };
    const r = deriveOperation(m, "/tmp");
    expect(r.entryPoints).toEqual([{ path: "src/lib.rs", role: "library-root" }]);
  });

  it("commands always empty in v0.1", () => {
    const m: DetectedManifest = { kind: "cargo", path: "", parsed: { package: { name: "x" }, bin: [{ name: "x" }] } };
    const r = deriveOperation(m, "/tmp");
    expect(r.commands).toEqual({});
  });
});

describe("deriveOperation — pyproject", () => {
  it("extracts script entry points", () => {
    const m: DetectedManifest = { kind: "pyproject", path: "", parsed: { project: { scripts: { mycli: "mypkg.cli:main" } } } };
    const r = deriveOperation(m, "/tmp");
    expect(r.entryPoints).toEqual([{ path: "mypkg/cli.py", role: "cli" }]);
  });
});

describe("deriveOperation — go", () => {
  it("walks cmd/* for main.go", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-op-"));
    mkdirSync(join(root, "cmd", "server"), { recursive: true });
    writeFileSync(join(root, "cmd", "server", "main.go"), "package main");
    const m: DetectedManifest = { kind: "go", path: "", parsed: { module: "x", goVersion: "1.22" } };
    const r = deriveOperation(m, root);
    expect(r.entryPoints).toEqual([{ path: "cmd/server/main.go", role: "cli" }]);
  });
});

describe("deriveOperation — null", () => {
  it("returns empty when no manifest", () => {
    expect(deriveOperation(null, "/tmp")).toEqual({ entryPoints: [], commands: {} });
  });
});
