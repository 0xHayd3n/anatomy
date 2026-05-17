import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findAnatomyForPath, discoverAllAnatomies } from "../src/index.js";

function freshTree() {
  return mkdtempSync(join(tmpdir(), "anat-disc-"));
}

describe("findAnatomyForPath", () => {
  it("returns null when no .anatomy exists between queryPath and repoRoot", () => {
    const root = freshTree();
    mkdirSync(join(root, "a", "b"), { recursive: true });
    expect(findAnatomyForPath(root, join(root, "a", "b"))).toBeNull();
  });

  it("returns the root .anatomy when only the root has one", () => {
    const root = freshTree();
    mkdirSync(join(root, "a", "b"), { recursive: true });
    writeFileSync(join(root, ".anatomy"), "");
    expect(findAnatomyForPath(root, join(root, "a", "b"))).toBe(join(root, ".anatomy"));
  });

  it("prefers the nearest ancestor when multiple anatomies exist", () => {
    const root = freshTree();
    mkdirSync(join(root, "a", "b"), { recursive: true });
    writeFileSync(join(root, ".anatomy"), "");
    writeFileSync(join(root, "a", ".anatomy"), "");
    expect(findAnatomyForPath(root, join(root, "a", "b"))).toBe(join(root, "a", ".anatomy"));
  });

  it("treats queryPath == repoRoot as a directory", () => {
    const root = freshTree();
    writeFileSync(join(root, ".anatomy"), "");
    expect(findAnatomyForPath(root, root)).toBe(join(root, ".anatomy"));
  });

  it("accepts non-existent queryPath (treats as a file path)", () => {
    const root = freshTree();
    mkdirSync(join(root, "a"));
    writeFileSync(join(root, ".anatomy"), "");
    expect(findAnatomyForPath(root, join(root, "a", "future-file.ts"))).toBe(join(root, ".anatomy"));
  });

  it("accepts a relative queryPath, resolved against repoRoot", () => {
    const root = freshTree();
    writeFileSync(join(root, ".anatomy"), "");
    expect(findAnatomyForPath(root, "a/b/c")).toBe(join(root, ".anatomy"));
  });

  it("throws RangeError when queryPath is not under repoRoot", () => {
    const root = freshTree();
    expect(() => findAnatomyForPath(root, join(root, "..", "elsewhere"))).toThrow(RangeError);
  });

  it("throws TypeError when repoRoot does not exist", () => {
    expect(() => findAnatomyForPath(join(tmpdir(), "definitely-does-not-exist-" + Math.random()), ".")).toThrow(TypeError);
  });
});

describe("discoverAllAnatomies", () => {
  it("returns [] when no .anatomy files exist", () => {
    const root = freshTree();
    mkdirSync(join(root, "a", "b"), { recursive: true });
    expect(discoverAllAnatomies(root)).toEqual([]);
  });

  it("returns all .anatomy files in lexicographic dirPath order", () => {
    const root = freshTree();
    mkdirSync(join(root, "z"));
    mkdirSync(join(root, "a"));
    writeFileSync(join(root, ".anatomy"), "");
    writeFileSync(join(root, "z", ".anatomy"), "");
    writeFileSync(join(root, "a", ".anatomy"), "");
    const result = discoverAllAnatomies(root);
    expect(result.map(r => r.dirPath)).toEqual([root, join(root, "a"), join(root, "z")]);
  });

  it("skips .git, node_modules, and dot-prefixed dirs", () => {
    const root = freshTree();
    mkdirSync(join(root, ".git"));
    mkdirSync(join(root, "node_modules"));
    mkdirSync(join(root, ".cache"));
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, ".git", ".anatomy"), "");
    writeFileSync(join(root, "node_modules", ".anatomy"), "");
    writeFileSync(join(root, ".cache", ".anatomy"), "");
    writeFileSync(join(root, "src", ".anatomy"), "");
    const result = discoverAllAnatomies(root);
    expect(result.map(r => r.dirPath)).toEqual([join(root, "src")]);
  });

  it("skips build artifact directories (dist, target, build) by default", () => {
    const root = freshTree();
    mkdirSync(join(root, "dist"));
    mkdirSync(join(root, "target"));
    mkdirSync(join(root, "build"));
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "dist", ".anatomy"), "");
    writeFileSync(join(root, "target", ".anatomy"), "");
    writeFileSync(join(root, "build", ".anatomy"), "");
    writeFileSync(join(root, "src", ".anatomy"), "");
    const result = discoverAllAnatomies(root);
    expect(result.map(r => r.dirPath)).toEqual([join(root, "src")]);
  });

  it("respects maxDepth (stops descending past N levels but processes that level)", () => {
    const root = freshTree();
    mkdirSync(join(root, "a", "b", "c", "d"), { recursive: true });
    writeFileSync(join(root, "a", ".anatomy"), "");
    writeFileSync(join(root, "a", "b", ".anatomy"), "");
    writeFileSync(join(root, "a", "b", "c", "d", ".anatomy"), "");
    const result = discoverAllAnatomies(root, { maxDepth: 2 });
    expect(result.map(r => r.dirPath).sort()).toEqual([join(root, "a"), join(root, "a", "b")]);
  });
});
