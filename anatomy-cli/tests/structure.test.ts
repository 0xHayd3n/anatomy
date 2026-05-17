import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveStructure } from "../src/pass1/structure.js";

describe("deriveStructure", () => {
  it("classifies known top-level dir names", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-st-"));
    mkdirSync(join(root, "src"));
    mkdirSync(join(root, "tests"));
    mkdirSync(join(root, "docs"));
    mkdirSync(join(root, "scripts"));
    writeFileSync(join(root, "README.md"), ""); // file, should be skipped
    const r = deriveStructure(root);
    expect(r.entries.map(e => ({ path: e.path, kind: e.kind }))).toEqual([
      { path: "docs/", kind: "docs" },
      { path: "scripts/", kind: "scripts" },
      { path: "src/", kind: "source" },
      { path: "tests/", kind: "tests" },
    ]);
  });

  it("falls through to 'other' for unknown names", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-st-"));
    mkdirSync(join(root, "weird-thing"));
    const r = deriveStructure(root);
    expect(r.entries[0].kind).toBe("other");
  });

  it("exact-basename: src-utils does NOT match src", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-st-"));
    mkdirSync(join(root, "src-utils"));
    const r = deriveStructure(root);
    expect(r.entries[0].kind).toBe("other");
  });

  it("case-insensitive: SRC matches source", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-st-"));
    mkdirSync(join(root, "SRC"));
    const r = deriveStructure(root);
    expect(r.entries[0].kind).toBe("source");
  });

  it("skips .git, node_modules, target, dist, build, dotdirs", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-st-"));
    mkdirSync(join(root, ".git"));
    mkdirSync(join(root, "node_modules"));
    mkdirSync(join(root, "target"));
    mkdirSync(join(root, "dist"));
    mkdirSync(join(root, "build"));
    mkdirSync(join(root, ".cache"));
    mkdirSync(join(root, "src"));
    const r = deriveStructure(root);
    expect(r.entries.map(e => e.path)).toEqual(["src/"]);
  });

  it("falls back to placeholder when no subdir metadata", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-st-"));
    mkdirSync(join(root, "src"));
    const r = deriveStructure(root);
    expect(r.entries[0].purpose).toBe("TODO describe purpose");
    expect(r.entries[0].isPlaceholder).toBe(true);
  });

  it("uses package.json description as purpose when present", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-st-"));
    mkdirSync(join(root, "packages"));
    writeFileSync(
      join(root, "packages", "package.json"),
      JSON.stringify({ name: "my-pkg", description: "Shared utility helpers." })
    );
    const r = deriveStructure(root);
    const entry = r.entries.find(e => e.path === "packages/")!;
    expect(entry.purpose).toBe("Shared utility helpers.");
    expect(entry.isPlaceholder).toBe(false);
  });

  it("uses README first paragraph as purpose when no package.json description", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-st-"));
    mkdirSync(join(root, "src"));
    writeFileSync(
      join(root, "src", "README.md"),
      "# src\n\nCore application source code for the runtime.\n"
    );
    const r = deriveStructure(root);
    const entry = r.entries.find(e => e.path === "src/")!;
    expect(entry.purpose).toBe("Core application source code for the runtime.");
    expect(entry.isPlaceholder).toBe(false);
  });

  it("falls back to placeholder when no package.json description or README", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-st-"));
    mkdirSync(join(root, "weird-thing"));
    const r = deriveStructure(root);
    expect(r.entries[0].purpose).toBe("TODO describe purpose");
    expect(r.entries[0].isPlaceholder).toBe(true);
  });

  it("package.json with no description field stays placeholder", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-st-"));
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "package.json"), JSON.stringify({ name: "x" }));
    const r = deriveStructure(root);
    expect(r.entries[0].isPlaceholder).toBe(true);
  });
});
