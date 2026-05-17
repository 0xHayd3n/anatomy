import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectJulia, juliaFormSuffix } from "../src/pass1/manifest/julia.js";

describe("detectJulia", () => {
  it("returns null without Project.toml", () => {
    expect(detectJulia(mkdtempSync(join(tmpdir(), "anat-jl-")))).toBeNull();
  });

  it("detects Project.toml with name + uuid", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-jl-"));
    writeFileSync(join(root, "Project.toml"), 'name = "DataFrames"\nuuid = "a93c6f00-e57d-5684-b7b6-d8193f3e46c0"\n');
    expect(detectJulia(root)?.kind).toBe("julia");
  });

  it("returns null when Project.toml lacks name AND uuid (could be other tooling)", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-jl-"));
    writeFileSync(join(root, "Project.toml"), '[some_tool]\nfoo = "bar"\n');
    expect(detectJulia(root)).toBeNull();
  });
});

describe("juliaFormSuffix", () => {
  it("Genie in deps → service", () => {
    expect(juliaFormSuffix({ parsed: { name: "x", deps: { Genie: "abc" } } })).toBe("service");
  });

  it("plain → library", () => {
    expect(juliaFormSuffix({ parsed: { name: "DataFrames", deps: { CSV: "abc" } } })).toBe("library");
  });
});
