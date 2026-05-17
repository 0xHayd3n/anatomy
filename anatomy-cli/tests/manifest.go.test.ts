import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectGo, parseGoRequire } from "../src/pass1/manifest/go.js";

describe("detectGo", () => {
  it("returns null when no go.mod exists", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-go-"));
    expect(detectGo(root)).toBeNull();
  });

  it("parses module and go version from a minimal go.mod", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-go-"));
    writeFileSync(join(root, "go.mod"), `module example.com/x\n\ngo 1.22\n`);
    const result = detectGo(root);
    expect(result?.kind).toBe("go");
    const parsed = result?.parsed as { module: string; goVersion: string };
    expect(parsed.module).toBe("example.com/x");
    expect(parsed.goVersion).toBe("1.22");
  });

  it("handles go.mod without go version line", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-go-"));
    writeFileSync(join(root, "go.mod"), `module example.com/x\n`);
    const parsed = detectGo(root)?.parsed as { module: string; goVersion: string };
    expect(parsed.module).toBe("example.com/x");
    expect(parsed.goVersion).toBe("");
  });

  it("includes deps in parsed output", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-go-"));
    writeFileSync(join(root, "go.mod"), `module example.com/x\n\ngo 1.22\n\nrequire (\n\tgithub.com/foo/bar v1.2.3\n)\n`);
    const parsed = detectGo(root)?.parsed as { module: string; goVersion: string; deps: string[] };
    expect(parsed.deps).toEqual(["github.com/foo/bar"]);
  });
});

describe("parseGoRequire", () => {
  it("returns [] for go.mod with no require block", () => {
    expect(parseGoRequire("module x\n\ngo 1.22\n")).toEqual([]);
  });

  it("extracts direct deps from multi-line require block", () => {
    const text = `module x\n\nrequire (\n\tgithub.com/foo/bar v1.2.3\n\tgithub.com/baz/qux v0.1.0\n)\n`;
    expect(parseGoRequire(text)).toEqual(["github.com/foo/bar", "github.com/baz/qux"]);
  });

  it("excludes indirect deps from multi-line block", () => {
    const text = `require (\n\tgithub.com/direct v1.0.0\n\tgithub.com/indirect v1.0.0 // indirect\n)\n`;
    expect(parseGoRequire(text)).toEqual(["github.com/direct"]);
  });

  it("extracts direct single-line require statements", () => {
    const text = `require github.com/direct v1.0.0\nrequire github.com/other v1.0.0 // indirect\n`;
    expect(parseGoRequire(text)).toEqual(["github.com/direct"]);
  });

  it("handles multiple require blocks", () => {
    const text = `require (\n\tgithub.com/a v1.0.0\n)\n\nrequire (\n\tgithub.com/b v2.0.0\n)\n`;
    expect(parseGoRequire(text)).toEqual(["github.com/a", "github.com/b"]);
  });
});
