import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyGlobExists, verifyGlobOnly } from "../src/checks/verify/glob-verifier.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "anat-verify-glob-"));
  mkdirSync(join(root, "tests"), { recursive: true });
  writeFileSync(join(root, "tests", "a.test.ts"), "");
  writeFileSync(join(root, "tests", "b.test.ts"), "");
  mkdirSync(join(root, "src", "routes"), { recursive: true });
  writeFileSync(join(root, "src", "routes", "users.ts"), "");
  writeFileSync(join(root, "src", "routes", "posts.ts"), "");
  mkdirSync(join(root, "src", "util"), { recursive: true });
  writeFileSync(join(root, "src", "util", "stray-route.ts"), "");
});

afterEach(() => { try { rmSync(root, { recursive: true, force: true }); } catch {} });

describe("verifyGlobExists", () => {
  it("passes when path matches ≥1 file", async () => {
    const warnings = await verifyGlobExists(root, { kind: "glob_exists", path: "tests/*.test.ts" }, "/rules/0/verify");
    expect(warnings).toEqual([]);
  });

  it("emits verify-glob-empty when path matches 0 files", async () => {
    const warnings = await verifyGlobExists(root, { kind: "glob_exists", path: "nonexistent/*.ts" }, "/rules/0/verify");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe("verify-glob-empty");
    expect(warnings[0].pointer).toBe("/rules/0/verify");
  });

  it("with should_not=true: passes when 0 files match", async () => {
    const warnings = await verifyGlobExists(root, { kind: "glob_exists", path: "nonexistent/*.ts", should_not: true }, "/rules/0/verify");
    expect(warnings).toEqual([]);
  });

  it("with should_not=true: emits verify-glob-unexpected-files when files match", async () => {
    const warnings = await verifyGlobExists(root, { kind: "glob_exists", path: "tests/*.test.ts", should_not: true }, "/rules/0/verify");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe("verify-glob-unexpected-files");
    expect(warnings[0].message).toContain("tests/a.test.ts");
  });
});

describe("verifyGlobOnly", () => {
  it("passes when all match-files are inside container", async () => {
    const warnings = await verifyGlobOnly(root, { kind: "glob_only", match: "src/routes/*.ts", container: "src/routes/**" }, "/rules/0/verify");
    expect(warnings).toEqual([]);
  });

  it("emits verify-glob-outside-container when files exist outside container", async () => {
    const warnings = await verifyGlobOnly(root, { kind: "glob_only", match: "src/**/stray-route.ts", container: "src/routes/**" }, "/rules/0/verify");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe("verify-glob-outside-container");
    expect(warnings[0].message).toContain("src/util/stray-route.ts");
  });

  it("passes silently when match glob has no hits at all", async () => {
    const warnings = await verifyGlobOnly(root, { kind: "glob_only", match: "src/**/*.zzz", container: "src/routes/**" }, "/rules/0/verify");
    expect(warnings).toEqual([]);
  });
});
