import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectManifest, isNpmStub } from "../src/pass1/manifest/index.js";

describe("detectManifest", () => {
  it("returns null when no manifest exists", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-det-"));
    expect(detectManifest(root)).toBeNull();
  });

  it("priority: real npm (with main) wins over cargo", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-det-"));
    writeFileSync(join(root, "package.json"), `{"name":"x","version":"1","main":"./index.js"}`);
    writeFileSync(join(root, "Cargo.toml"), `[package]\nname="x"\nversion="1"\n`);
    expect(detectManifest(root)?.kind).toBe("npm");
  });

  it("polyglot: stub-npm + cargo prefers cargo (mdBook regression)", () => {
    // mdBook ships a Cargo.toml workspace + a dev-tooling package.json
    // (eslint + browser-ui-test, no main/module/bin/exports). The Rust
    // workspace is the primary; the package.json is supporting infra.
    const root = mkdtempSync(join(tmpdir(), "anat-det-"));
    writeFileSync(join(root, "package.json"), `{"scripts":{"lint":"eslint ."},"devDependencies":{"eslint":"^9"}}`);
    writeFileSync(join(root, "Cargo.toml"), `[workspace]\nmembers=["crates/*"]\n`);
    expect(detectManifest(root)?.kind).toBe("cargo");
  });

  it("stub-only repo: returns the stub manifest (with isPrimary:false)", () => {
    // After the isPrimary refactor: a stub-only repo (e.g., docs site
    // with only a lint-only package.json, or nodejs/node with a
    // ruff-config pyproject.toml) still returns the stub from
    // detectManifest so other Pass 1 derivers (tagline, description) can
    // use any useful fields. The stack-deriver in identity.ts checks
    // isPrimary and emits todo-stack — that's where stub-vs-primary
    // discrimination happens for stack classification.
    const root = mkdtempSync(join(tmpdir(), "anat-det-"));
    writeFileSync(join(root, "package.json"), `{"scripts":{"lint":"eslint ."}}`);
    const r = detectManifest(root);
    expect(r?.kind).toBe("npm");
    expect(r?.isPrimary).toBe(false);
  });

  it("stub manifest filtered when a primary manifest co-exists (mdBook regression)", () => {
    // The previously-explicit `npm && cargo && isNpmStub` polyglot rule
    // collapsed into the isPrimary contract: the stub npm is filtered
    // automatically and cargo wins via the default chain.
    const root = mkdtempSync(join(tmpdir(), "anat-det-"));
    writeFileSync(join(root, "package.json"), `{"scripts":{"lint":"eslint ."}}`);
    writeFileSync(join(root, "Cargo.toml"), `[workspace]\nmembers=["crates/*"]\n`);
    expect(detectManifest(root)?.kind).toBe("cargo");
  });

  it("stub pyproject.toml: returned as stub (nodejs/node regression — Ruff-only pyproject)", () => {
    // nodejs/node's pyproject.toml has only [tool.ruff]. detectManifest
    // returns it (so tagline can still read), but isPrimary=false so
    // identity.ts emits todo-stack rather than python-library.
    const root = mkdtempSync(join(tmpdir(), "anat-det-"));
    writeFileSync(join(root, "pyproject.toml"), `[tool.ruff]\nline-length = 172\n`);
    const r = detectManifest(root);
    expect(r?.kind).toBe("pyproject");
    expect(r?.isPrimary).toBe(false);
  });

  it("real pyproject (with [project]) IS primary, returns python", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-det-"));
    writeFileSync(join(root, "pyproject.toml"), `[project]\nname = "myapp"\nversion = "1.0"\n`);
    const r = detectManifest(root);
    expect(r?.kind).toBe("pyproject");
    expect(r?.isPrimary).not.toBe(false);
  });

  it("real pyproject (with [build-system]) IS primary, returns python", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-det-"));
    writeFileSync(join(root, "pyproject.toml"), `[build-system]\nrequires = ["setuptools"]\n`);
    const r = detectManifest(root);
    expect(r?.kind).toBe("pyproject");
    expect(r?.isPrimary).not.toBe(false);
  });

  it("polyglot: pyproject + cargo → pyproject (PyO3/maturin shape)", () => {
    // Pre-pyo3-priority-fix this returned cargo. The new rule: pydantic-
    // core et al. are Python packages with Rust extension modules; pyproject
    // is the primary manifest. The previous expectation "cargo wins" didn't
    // reflect the dominant real-world shape.
    const root = mkdtempSync(join(tmpdir(), "anat-det-"));
    writeFileSync(join(root, "Cargo.toml"), `[package]\nname="x"\nversion="1"\n`);
    writeFileSync(join(root, "pyproject.toml"), `[project]\nname="x"\nversion="1"\n`);
    expect(detectManifest(root)?.kind).toBe("pyproject");
  });

  it("priority: pyproject over go when no npm/cargo", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-det-"));
    writeFileSync(join(root, "pyproject.toml"), `[project]\nname="x"\nversion="1"\n`);
    writeFileSync(join(root, "go.mod"), `module example.com/x\n`);
    expect(detectManifest(root)?.kind).toBe("pyproject");
  });

  it("falls through to go when present alone", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-det-"));
    writeFileSync(join(root, "go.mod"), `module example.com/x\n`);
    expect(detectManifest(root)?.kind).toBe("go");
  });
});

describe("isNpmStub", () => {
  it("treats package.json with NO project markers as a stub (mdBook shape)", () => {
    // mdBook's package.json: only deps + scripts for ESLint. No name,
    // main, module, bin, exports, workspaces, or private. → stub.
    expect(isNpmStub({ scripts: { lint: "eslint ." }, devDependencies: { eslint: "^9" } })).toBe(true);
  });

  it("not a stub when name is present (webext-mdn / astro-starlight shape)", () => {
    // webext-mdn has name + description + devDependencies, no main. The
    // examples-collection IS a real npm package; pre-fix it regressed
    // to todo-stack under a stricter rule.
    expect(isNpmStub({ name: "webextensions-examples", description: "x" })).toBe(false);
  });

  it("not a stub when main is present", () => {
    expect(isNpmStub({ main: "./index.js" })).toBe(false);
  });

  it("not a stub when module is present", () => {
    expect(isNpmStub({ module: "./esm/index.js" })).toBe(false);
  });

  it("not a stub when exports map is present", () => {
    expect(isNpmStub({ exports: { ".": "./index.js" } })).toBe(false);
  });

  it("not a stub when bin is present", () => {
    expect(isNpmStub({ bin: "./cli.js" })).toBe(false);
    expect(isNpmStub({ bin: { foo: "./cli.js" } })).toBe(false);
  });

  it("not a stub when workspaces is present (monorepo root)", () => {
    expect(isNpmStub({ workspaces: ["packages/*"] })).toBe(false);
  });

  it("not a stub when private:true is set (app/workspace root)", () => {
    expect(isNpmStub({ private: true })).toBe(false);
  });

  it("treats null/non-object input as a stub (defensive)", () => {
    expect(isNpmStub(null)).toBe(true);
    expect(isNpmStub(undefined)).toBe(true);
    expect(isNpmStub("not-an-object")).toBe(true);
  });
});
