import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectNpm } from "../src/pass1/manifest/npm.js";

function makeRepo(pkg: object): string {
  const root = mkdtempSync(join(tmpdir(), "anat-npm-"));
  writeFileSync(join(root, "package.json"), JSON.stringify(pkg, null, 2));
  return root;
}

describe("detectNpm", () => {
  it("returns null when no package.json exists", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-npm-"));
    expect(detectNpm(root)).toBeNull();
  });

  it("returns DetectedManifest when package.json exists", () => {
    const root = makeRepo({ name: "x", version: "1.0.0" });
    const result = detectNpm(root);
    expect(result?.kind).toBe("npm");
    expect(result?.path).toBe(join(root, "package.json"));
    expect((result?.parsed as { name: string }).name).toBe("x");
  });

  it("throws on invalid JSON", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-npm-"));
    writeFileSync(join(root, "package.json"), "{ not json");
    expect(() => detectNpm(root)).toThrow();
  });
});
