import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPass1 } from "../src/pass1/index.js";
import { renderToml, renderAnatomyArtifact } from "../src/render/toml.js";
import { validate } from "@anatomy/validate";

const PINNED = "2026-05-06T13:30:00.000Z";

beforeEach(() => { process.env.ANATOMY_GENERATED_AT = PINNED; });
afterEach(() => { delete process.env.ANATOMY_GENERATED_AT; });

describe("renderToml", () => {
  it("emits the Appendix-A example for a typescript library", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-r-"));
    writeFileSync(join(root, "package.json"), JSON.stringify({
      name: "my-tiny-lib",
      description: "A tiny utility library.",
      main: "./dist/index.js",
      exports: { ".": "./dist/index.js" },
      scripts: { build: "tsc", test: "vitest" },
      engines: { node: ">=20" },
      dependencies: { "lodash-es": "^4" },
    }));
    writeFileSync(join(root, "tsconfig.json"), "{}");
    writeFileSync(join(root, "README.md"), "# my-tiny-lib\n\nA tiny utility library that does X.\n");
    mkdirSync(join(root, "src"));
    mkdirSync(join(root, "tests"));

    const result = runPass1(root);
    const toml = renderToml(result);

    expect(toml).toContain('anatomy_version = "1.0"');
    expect(toml).toContain('tagline = "A tiny utility library that does X."');
    expect(toml).toContain('stack = "typescript"');
    expect(toml).toContain('form = "typescript-library"');
    expect(toml).toContain('domain = "todo-domain"');
    expect(toml).toContain('# TODO: replace with real domain');
    expect(toml).toContain('build = "tsc"');
    // v0.9 removed [[substance.key_dependencies]] — no `why = "todo-why"` line.
    expect(toml).not.toContain('[[substance');
    expect(toml).not.toContain('why = "todo-why"');
    expect(toml).toMatch(/at = 2026-05-06T13:30:00\.000Z/);
    expect(toml).toMatch(/by = "@anatomy\/cli@\d+\.\d+\.\d+"/);
  });

  it("output validation gate: every Pass 1 → render → validate must succeed", async () => {
    const root = mkdtempSync(join(tmpdir(), "anat-r-"));
    writeFileSync(join(root, "package.json"), JSON.stringify({
      name: "my-tiny-lib",
      description: "A tiny utility library.",
      main: "./dist/index.js",
      scripts: { build: "tsc" },
      engines: { node: ">=20" },
    }));
    mkdirSync(join(root, "src"));

    const toml = renderToml(runPass1(root));
    const r = await validate(toml, { repoRoot: root, anatomyDir: "" });
    if (!r.ok) console.log("validate errors:", r.errors);
    expect(r.ok).toBe(true);
  });

  it("handles no-manifest case (all placeholders)", async () => {
    const root = mkdtempSync(join(tmpdir(), "anat-r-"));
    writeFileSync(join(root, "README.md"), "# bare repo\n\nDoes a thing.\n");
    const toml = renderToml(runPass1(root));
    const r = await validate(toml, { repoRoot: root, anatomyDir: "" });
    if (!r.ok) console.log("validate errors:", r.errors);
    expect(r.ok).toBe(true);
  });

  it("does not emit [code_profile.*], [[interface.*]], [[substance.*]], or [domain_model.*] (v0.8 + v0.9 cleanups)", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-r-"));
    writeFileSync(join(root, "package.json"), JSON.stringify({
      name: "my-cli",
      description: "A CLI tool.",
      bin: { "my-cli": "./dist/index.js" },
      scripts: { build: "tsc" },
    }));
    mkdirSync(join(root, "src"));
    mkdirSync(join(root, "src", "commands"));
    writeFileSync(join(root, "src", "commands", "init.ts"), "export function init() {}");
    writeFileSync(join(root, "src", "commands", "build.ts"), "export function build() {}");
    writeFileSync(join(root, "src", "commands", "deploy.ts"), "export function deploy() {}");

    const toml = renderToml(runPass1(root));
    expect(toml).not.toContain("[code_profile");
    expect(toml).not.toContain("[[interface.");
    expect(toml).not.toContain("[interface]");
    expect(toml).not.toContain("[[substance.");
    expect(toml).not.toContain("[substance]");
    expect(toml).not.toContain("[[domain_model.");
    expect(toml).not.toContain("[domain_model]");
  });

  it("emits commit field when present in Pass1Result", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-r-"));
    writeFileSync(join(root, "package.json"), JSON.stringify({
      name: "test-pkg", description: "Test.", main: "./index.js",
    }));
    const result = runPass1(root);
    const resultWithCommit = { ...result, commit: "abc1234" };
    const toml = renderToml(resultWithCommit);
    expect(toml).toContain('commit = "abc1234"');
    // commit must appear in [generated] section, after 'at' and before 'by'
    const atIdx = toml.indexOf("at = ");
    const commitIdx = toml.indexOf('commit = "abc1234"');
    const byIdx = toml.indexOf("by = ");
    expect(atIdx).toBeLessThan(commitIdx);
    expect(commitIdx).toBeLessThan(byIdx);
  });

  it("omits commit field when undefined", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-r-"));
    writeFileSync(join(root, "package.json"), JSON.stringify({
      name: "test-pkg", description: "Test.", main: "./index.js",
    }));
    const toml = renderToml(runPass1(root));
    expect(toml).not.toContain("commit =");
  });

  it("does not emit [[architecture.invariants]]", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-r-"));
    writeFileSync(join(root, "package.json"), JSON.stringify({
      name: "test-pkg", description: "Test.", main: "./index.js",
    }));
    const toml = renderToml(runPass1(root));
    expect(toml).not.toContain("[[architecture");
  });

  it("emits convention field on structure entries when present", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-r-"));
    writeFileSync(join(root, "package.json"), JSON.stringify({
      name: "test-pkg", description: "Test.", main: "./index.js",
    }));
    mkdirSync(join(root, "src"));
    const result = runPass1(root);
    const entries = result.structure.entries.map((e, i) =>
      i === 0 ? { ...e, convention: "each file exports one function" } : e
    );
    const resultWithConvention = { ...result, structure: { entries } };
    const toml = renderToml(resultWithConvention);
    expect(toml).toContain('convention = "each file exports one function"');
    // convention must appear after kind in the same entry
    const kindIdx = toml.indexOf('kind = "source"');
    const convIdx = toml.indexOf('convention = "each file exports one function"');
    expect(kindIdx).toBeLessThan(convIdx);
  });

  it("renders no [[interface.*]] block in v0.9 even when Pass 1 result has interface.entries (renderer drops it)", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-r-"));
    writeFileSync(join(root, "package.json"), JSON.stringify({
      name: "test-pkg",
      description: "A tiny lib.",
      exports: { ".": "./index.js" },
    }));
    const result = runPass1(root);
    // Force-attach a synthetic interface block; v0.9 renderer must omit it.
    const resultWithIface = {
      ...result,
      interface: {
        variant: "exports" as const,
        entries: [{ symbol: "main", kind: "function" as const, summary: "entry", isPlaceholder: false, signature: "(opts: Opts) => Result" }],
      },
    };
    const toml = renderToml(resultWithIface);
    expect(toml).not.toContain('signature = "(opts: Opts) => Result"');
    expect(toml).not.toContain("[[interface.");
  });

  it("does not emit [[insights]]", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-r-noins-"));
    writeFileSync(join(root, "package.json"), JSON.stringify({
      name: "my-service",
      scripts: {},
      dependencies: {},
    }));
    writeFileSync(join(root, "README.md"), "# my-service\n\nA service.\n");

    const result = runPass1(root);
    // insights not set
    const toml = renderToml(result);
    expect(toml).not.toContain('[[insights]]');
  });
});

describe("renderToml [generate] passthrough", () => {
  it("emits [generate] when present", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-gen-"));
    writeFileSync(join(root, "package.json"), JSON.stringify({
      name: "demo", scripts: { build: "tsc" }, engines: { node: ">=20" },
    }));
    mkdirSync(join(root, "src"));
    const r = runPass1(root) as any;
    r.generate = { agents_md: true, agents_md_budget: 1800, agents_md_memory_count: 12 };
    const out = renderToml(r);
    expect(out).toMatch(/\[generate\]/);
    expect(out).toMatch(/agents_md = true/);
    expect(out).toMatch(/agents_md_budget = 1800/);
    expect(out).toMatch(/agents_md_memory_count = 12/);
  });

  it("omits [generate] when absent", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-gen-"));
    writeFileSync(join(root, "package.json"), JSON.stringify({
      name: "demo", scripts: { build: "tsc" }, engines: { node: ">=20" },
    }));
    mkdirSync(join(root, "src"));
    const out = renderToml(runPass1(root));
    expect(out).not.toMatch(/\[generate\]/);
  });
});

describe("renderAnatomyArtifact", () => {
  it("produces a RenderArtifact with path '.anatomy'", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-r-art-"));
    writeFileSync(join(root, "package.json"), JSON.stringify({
      name: "my-tiny-lib",
      description: "A tiny utility library.",
      scripts: { build: "tsc" },
      engines: { node: ">=20" },
    }));
    mkdirSync(join(root, "src"));

    const result = runPass1(root);
    const artifact = renderAnatomyArtifact(result);

    expect(artifact.path).toBe(".anatomy");
    expect(artifact.content).toContain('anatomy_version = "');
    expect(artifact.content).toContain('[identity]');
  });
});
