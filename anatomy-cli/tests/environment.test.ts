import { describe, it, expect } from "vitest";
import { deriveEnvironment } from "../src/pass1/environment.js";
import type { DetectedManifest } from "../src/types.js";

const npm = (parsed: object): DetectedManifest => ({ kind: "npm", path: "", parsed });

describe("deriveEnvironment", () => {
  it("npm with engines.node", () => {
    expect(deriveEnvironment(npm({ engines: { node: ">=20" } }))).toEqual({ languageVersion: ">=20", runtime: "node" });
  });

  it("npm without engines emits runtime only", () => {
    expect(deriveEnvironment(npm({}))).toEqual({ languageVersion: undefined, runtime: "node" });
  });

  it("cargo with package.rust-version", () => {
    const m: DetectedManifest = { kind: "cargo", path: "", parsed: { package: { "rust-version": "1.75" } } };
    expect(deriveEnvironment(m)).toEqual({ languageVersion: "1.75", runtime: "rust" });
  });

  it("pyproject with requires-python", () => {
    const m: DetectedManifest = { kind: "pyproject", path: "", parsed: { project: { "requires-python": ">=3.11" } } };
    expect(deriveEnvironment(m)).toEqual({ languageVersion: ">=3.11", runtime: "cpython" });
  });

  it("go with goVersion", () => {
    const m: DetectedManifest = { kind: "go", path: "", parsed: { module: "x", goVersion: "1.22" } };
    expect(deriveEnvironment(m)).toEqual({ languageVersion: "1.22", runtime: "go" });
  });

  it("returns undefined when no manifest", () => {
    expect(deriveEnvironment(null)).toBeUndefined();
  });
});
