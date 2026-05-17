import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyAstPattern } from "../src/checks/verify/ast-grep-verifier.js";
import { _resetAstGrepCache } from "../src/checks/verify/detect-ast-grep.js";

let root: string;

beforeEach(() => {
  _resetAstGrepCache();
  root = mkdtempSync(join(tmpdir(), "anat-verify-ast-"));
  mkdirSync(join(root, "src", "api"), { recursive: true });
  mkdirSync(join(root, "src", "ui"), { recursive: true });
  // src/api/users.ts: contains fetch() — legitimate
  writeFileSync(join(root, "src", "api", "users.ts"), `export async function getUsers() {
  const r = await fetch("/api/users");
  return r.json();
}`);
  // src/ui/dashboard.ts: contains fetch() — drift! Should be in api/.
  writeFileSync(join(root, "src", "ui", "dashboard.ts"), `export async function loadDashboard() {
  const r = await fetch("/api/dashboard");
  return r.json();
}`);
  // src/ui/clean.ts: NO fetch — fine
  writeFileSync(join(root, "src", "ui", "clean.ts"), `export function clean() { return 42; }`);
});

afterEach(() => { try { rmSync(root, { recursive: true, force: true }); } catch {} });

describe("verifyAstPattern", () => {
  it("expect_in: passes when pattern matches ≥1 file in glob", async () => {
    const warnings = await verifyAstPattern(root, {
      kind: "ast_pattern",
      lang: "ts",
      pattern: "fetch($_)",
      expect_in: "src/api/**/*.ts",
    }, "/rules/0/verify");
    expect(warnings).toEqual([]);
  });

  it("expect_in: emits verify-pattern-not-matched when 0 matches", async () => {
    const warnings = await verifyAstPattern(root, {
      kind: "ast_pattern",
      lang: "ts",
      pattern: "fetch($_)",
      expect_in: "src/ui/clean.ts",
    }, "/rules/0/verify");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe("verify-pattern-not-matched");
  });

  it("forbid_in: emits verify-pattern-found-where-forbidden listing the offending file", async () => {
    const warnings = await verifyAstPattern(root, {
      kind: "ast_pattern",
      lang: "ts",
      pattern: "fetch($_)",
      forbid_in: "src/ui/**/*.ts",
    }, "/rules/0/verify");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe("verify-pattern-found-where-forbidden");
    expect(warnings[0].message).toContain("dashboard.ts");
  });

  it("forbid_in: passes when glob contains no fetch", async () => {
    const warnings = await verifyAstPattern(root, {
      kind: "ast_pattern",
      lang: "ts",
      pattern: "fetch($_)",
      forbid_in: "src/ui/clean.ts",
    }, "/rules/0/verify");
    expect(warnings).toEqual([]);
  });

  it("emits verify-invalid-pattern when pattern is malformed", async () => {
    const warnings = await verifyAstPattern(root, {
      kind: "ast_pattern",
      lang: "ts",
      pattern: "((((",  // intentionally broken
      expect_in: "src/**/*.ts",
    }, "/rules/0/verify");
    expect(warnings.some(w => w.code === "verify-invalid-pattern")).toBe(true);
  });

  it("emits verify-invalid-pattern when lang is not supported by napi (e.g., python)", async () => {
    const warnings = await verifyAstPattern(root, {
      kind: "ast_pattern",
      lang: "py",
      pattern: "print($_)",
      expect_in: "src/**/*.py",
    }, "/rules/0/verify");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe("verify-invalid-pattern");
    expect(warnings[0].message).toContain("py");
  });

  it("emits verify-ast-grep-unavailable when @ast-grep/napi is unavailable", async () => {
    // Stub getAstGrep to return null for this test only.
    vi.doMock("../src/checks/verify/detect-ast-grep.js", () => ({
      getAstGrep: async () => null,
      _resetAstGrepCache: () => {},
    }));
    // Re-import the verifier with the mocked dep
    const mod = await import("../src/checks/verify/ast-grep-verifier.js?fresh=1");
    const warnings = await mod.verifyAstPattern(root, {
      kind: "ast_pattern",
      lang: "ts",
      pattern: "fetch($_)",
      expect_in: "src/api/**/*.ts",
    }, "/rules/0/verify");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe("verify-ast-grep-unavailable");
    vi.doUnmock("../src/checks/verify/detect-ast-grep.js");
  });
});
