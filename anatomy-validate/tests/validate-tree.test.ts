import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateTree } from "../src/index.js";

const minimalRoot = `anatomy_version = "0.2"
tagline = "x"

[identity]
fingerprint = "a8fybpg4nh2b5vpw498v"

[identity.stack]
id = "rust"
hash = "a8fyb"

[identity.form]
id = "cli-tool"
hash = "pg4nh"

[identity.domain]
id = "web-publishing"
hash = "2b5vp"

[identity.function]
id = "markdown-to-static-html"
hash = "w498v"

[generated]
at = 2026-05-06T12:00:00.000Z
by = "x"
model = "x"
schema = "https://example.com"
`;

const minimalSub = `anatomy_version = "0.2"
tagline = "y"

[identity]
fingerprint = "jtambpg4nh2b5vpw498v"

[identity.stack]
id = "typescript"
hash = "jtamb"

[identity.form]
id = "cli-tool"
hash = "pg4nh"

[identity.domain]
id = "web-publishing"
hash = "2b5vp"

[identity.function]
id = "markdown-to-static-html"
hash = "w498v"

[generated]
at = 2026-05-06T12:00:00.000Z
by = "x"
model = "x"
schema = "https://example.com"
`;

describe("validateTree", () => {
  it("ok:true for an empty tree", async () => {
    const root = mkdtempSync(join(tmpdir(), "anat-tree-"));
    const r = await validateTree(root);
    expect(r.ok).toBe(true);
    expect(r.results).toEqual([]);
    expect(r.crossFileWarnings).toEqual([]);
  });

  it("ok:true for one valid root anatomy", async () => {
    const root = mkdtempSync(join(tmpdir(), "anat-tree-"));
    writeFileSync(join(root, ".anatomy"), minimalRoot);
    const r = await validateTree(root);
    expect(r.ok).toBe(true);
    expect(r.results).toHaveLength(1);
    expect(r.results[0].relPath).toBe(".anatomy");
    expect(r.results[0].result.ok).toBe(true);
    expect(r.crossFileWarnings).toEqual([]);
  });

  it("ok:true for root + valid sub-anatomy", async () => {
    const root = mkdtempSync(join(tmpdir(), "anat-tree-"));
    mkdirSync(join(root, "packages", "sdk"), { recursive: true });
    writeFileSync(join(root, ".anatomy"), minimalRoot);
    writeFileSync(join(root, "packages", "sdk", ".anatomy"), minimalSub);
    const r = await validateTree(root);
    expect(r.ok).toBe(true);
    expect(r.results.map(x => x.relPath)).toEqual([".anatomy", "packages/sdk/.anatomy"]);
  });

  it("emits duplicate-fingerprint-in-tree when two anatomies share a fingerprint", async () => {
    const root = mkdtempSync(join(tmpdir(), "anat-tree-"));
    mkdirSync(join(root, "packages", "copy"), { recursive: true });
    writeFileSync(join(root, ".anatomy"), minimalRoot);
    writeFileSync(join(root, "packages", "copy", ".anatomy"), minimalRoot); // same fingerprint
    const r = await validateTree(root);
    expect(r.ok).toBe(true); // warnings don't flip ok
    expect(r.crossFileWarnings).toHaveLength(1);
    expect(r.crossFileWarnings[0].code).toBe("duplicate-fingerprint-in-tree");
  });

  it("ok:false when a sub-anatomy has nested-path-escape", async () => {
    const root = mkdtempSync(join(tmpdir(), "anat-tree-"));
    mkdirSync(join(root, "packages", "sdk"), { recursive: true });
    writeFileSync(join(root, ".anatomy"), minimalRoot);
    const escaping = minimalSub + `
[[structure.entries]]
path = "../../escape"
purpose = "y"
kind = "source"
`;
    writeFileSync(join(root, "packages", "sdk", ".anatomy"), escaping);
    const r = await validateTree(root);
    expect(r.ok).toBe(false);
    const subResult = r.results.find(x => x.relPath === "packages/sdk/.anatomy")!;
    expect(subResult.result.ok).toBe(false);
    if (!subResult.result.ok) {
      expect(subResult.result.errors.some(e => e.code === "nested-path-escape")).toBe(true);
    }
  });

  it("relPath uses POSIX separators on every platform", async () => {
    const root = mkdtempSync(join(tmpdir(), "anat-tree-"));
    mkdirSync(join(root, "a", "b"), { recursive: true });
    writeFileSync(join(root, "a", "b", ".anatomy"), minimalRoot);
    const r = await validateTree(root);
    expect(r.results[0].relPath).toBe("a/b/.anatomy");
  });
});
