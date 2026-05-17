import { describe, it, expect } from "vitest";
import { deriveSubstance } from "../src/pass1/substance.js";
import type { DetectedManifest } from "../src/types.js";

const npm = (parsed: object): DetectedManifest => ({ kind: "npm", path: "", parsed });

describe("deriveSubstance", () => {
  it("returns top 5 npm deps with placeholder why", () => {
    const r = deriveSubstance(npm({ name: "x", dependencies: { a: "1", b: "1", c: "1", d: "1", e: "1", f: "1" } }));
    expect(r.keyDependencies).toHaveLength(5);
    expect(r.keyDependencies[0].name).toBe("a");
    expect(r.keyDependencies[0].why).toBe("todo-why");
    expect(r.keyDependencies[0].isPlaceholder).toBe(true);
  });

  it("extracts cargo dependency keys", () => {
    const m: DetectedManifest = { kind: "cargo", path: "", parsed: { dependencies: { tokio: "1", serde: "1" } } };
    const r = deriveSubstance(m);
    expect(r.keyDependencies.map(d => d.name)).toEqual(["tokio", "serde"]);
  });

  it("extracts pyproject deps from PEP 508 strings", () => {
    const m: DetectedManifest = {
      kind: "pyproject", path: "",
      parsed: { project: { dependencies: ["requests>=2.0", "fastapi[standard]==0.100", "pydantic"] } },
    };
    const r = deriveSubstance(m);
    expect(r.keyDependencies.map(d => d.name)).toEqual(["requests", "fastapi", "pydantic"]);
  });

  it("extracts go deps from parsed.deps", () => {
    const m: DetectedManifest = { kind: "go", path: "", parsed: { module: "x", goVersion: "1.22", deps: ["github.com/foo/bar", "github.com/baz/qux"] } };
    const r = deriveSubstance(m);
    expect(r.keyDependencies.map(d => d.name)).toEqual(["github.com/foo/bar", "github.com/baz/qux"]);
    expect(r.keyDependencies[0].isPlaceholder).toBe(true);
  });

  it("returns [] for go with no deps", () => {
    const m: DetectedManifest = { kind: "go", path: "", parsed: { module: "x", goVersion: "1.22", deps: [] } };
    expect(deriveSubstance(m).keyDependencies).toEqual([]);
  });

  it("returns [] when no manifest", () => {
    expect(deriveSubstance(null).keyDependencies).toEqual([]);
  });

  it("returns [] when npm has no dependencies", () => {
    expect(deriveSubstance(npm({ name: "x" })).keyDependencies).toEqual([]);
  });
});
