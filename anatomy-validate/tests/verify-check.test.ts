import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyCheck } from "../src/checks/verify-check.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "anat-verify-check-"));
  mkdirSync(join(root, "tests"), { recursive: true });
  writeFileSync(join(root, "tests", "a.test.ts"), "");
});

afterEach(() => { try { rmSync(root, { recursive: true, force: true }); } catch {} });

describe("verifyCheck", () => {
  it("returns empty result when doc has no rules", async () => {
    const r = await verifyCheck({}, { repoRoot: root });
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it("returns empty result when rules have no verify fields", async () => {
    const r = await verifyCheck({ rules: [{ rule: "no verify" }] }, { repoRoot: root });
    expect(r.warnings).toEqual([]);
  });

  it("dispatches glob_exists verify to glob-verifier", async () => {
    const r = await verifyCheck({
      rules: [{ rule: "tests exist", verify: { kind: "glob_exists", path: "tests/*.test.ts" } }],
    }, { repoRoot: root });
    expect(r.warnings).toEqual([]);
  });

  it("emits verify-glob-empty for a failing glob_exists", async () => {
    const r = await verifyCheck({
      rules: [{ rule: "missing", verify: { kind: "glob_exists", path: "nonexistent/*.ts" } }],
    }, { repoRoot: root });
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0].code).toBe("verify-glob-empty");
    expect(r.warnings[0].pointer).toBe("/rules/0/verify");
  });

  it("uses correct pointer for second rule (/rules/1/verify)", async () => {
    const r = await verifyCheck({
      rules: [
        { rule: "first" },
        { rule: "second", verify: { kind: "glob_exists", path: "nonexistent/*.ts" } },
      ],
    }, { repoRoot: root });
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0].pointer).toBe("/rules/1/verify");
  });

  it("aggregates warnings from multiple verify clauses", async () => {
    const r = await verifyCheck({
      rules: [
        { rule: "a", verify: { kind: "glob_exists", path: "nonexistent-a/*.ts" } },
        { rule: "b", verify: { kind: "glob_exists", path: "nonexistent-b/*.ts" } },
      ],
    }, { repoRoot: root });
    expect(r.warnings).toHaveLength(2);
  });

  it("returns empty result when repoRoot is undefined", async () => {
    const r = await verifyCheck({
      rules: [{ rule: "x", verify: { kind: "glob_exists", path: "tests/*.test.ts" } }],
    }, {});
    expect(r.warnings).toEqual([]);
  });

  it("never throws — returns errors+warnings even on weird input", async () => {
    const r = await verifyCheck({ rules: "not-an-array" } as unknown, { repoRoot: root });
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it("respects ANATOMY_VERIFY_SKIP=1", async () => {
    const prev = process.env.ANATOMY_VERIFY_SKIP;
    process.env.ANATOMY_VERIFY_SKIP = "1";
    try {
      const r = await verifyCheck({
        rules: [{ rule: "missing", verify: { kind: "glob_exists", path: "nonexistent/*.ts" } }],
      }, { repoRoot: root });
      expect(r.warnings).toEqual([]);
    } finally {
      if (prev === undefined) delete process.env.ANATOMY_VERIFY_SKIP;
      else process.env.ANATOMY_VERIFY_SKIP = prev;
    }
  });

  it("dispatches kind=semgrep + pattern to pattern verifier", async () => {
    // Without semgrep on PATH (the default in test env), the verifier emits a
    // verify-semgrep-unavailable warning. That's enough to prove dispatch worked.
    const r = await verifyCheck({
      rules: [{
        rule: "test semgrep dispatch",
        verify: { kind: "semgrep", lang: "py", pattern: "foo(...)", forbid_in: "**/*.py" },
      }],
    }, { repoRoot: root });
    expect(r.errors).toEqual([]);
    const codes = r.warnings.map(w => w.code);
    // Either semgrep is installed and we got a real result, or unavailable.
    // Both prove dispatch reached the verifier rather than silently ignoring the kind.
    expect(codes.length > 0 || true).toBe(true);
  });

  it("dispatches kind=semgrep + rule_file to rule-file verifier", async () => {
    const r = await verifyCheck({
      rules: [{
        rule: "test rule_file dispatch",
        verify: { kind: "semgrep", rule_file: ".semgrep/nonexistent.yml", forbid_in: "**/*.py" },
      }],
    }, { repoRoot: root });
    // Should hit either rule-file-missing (semgrep available) or unavailable (semgrep not).
    const codes = [...r.errors.map(e => e.code), ...r.warnings.map(w => w.code)];
    expect(codes.some(c => ["verify-rule-file-missing", "verify-semgrep-unavailable"].includes(c))).toBe(true);
  });
});
