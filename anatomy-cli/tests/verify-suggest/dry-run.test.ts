import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dryRun } from "../../src/verify-suggest/dry-run.js";

function repoWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "anat-dryrun-"));
  for (const [rel, content] of Object.entries(files)) {
    writeFileSync(join(dir, rel), content);
  }
  return dir;
}

describe("dryRun — glob_exists", () => {
  it("accepts a candidate that finds the expected path", async () => {
    const dir = repoWith({ "package.json": "{}" });
    const result = await dryRun(dir, { kind: "glob_exists", path: "package.json" });
    expect(result.accepted).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it("accepts a candidate that legitimately reports missing files", async () => {
    // 'verify-glob-empty' is a legitimate drift signal, not a broken verifier
    const dir = repoWith({ "package.json": "{}" });
    const result = await dryRun(dir, { kind: "glob_exists", path: "README.md" });
    expect(result.accepted).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("dryRun — broken candidates", () => {
  it("rejects an ast_pattern with malformed syntax", async () => {
    const dir = repoWith({ "a.ts": "x" });
    // ast-grep ERROR-node syntax: unbalanced bracket
    const result = await dryRun(dir, {
      kind: "ast_pattern",
      lang: "ts",
      pattern: "function ([",
      expect_in: "**/*.ts",
    });
    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/invalid|malformed/i);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("dryRun — timeout", () => {
  it("rejects when verifyCheck exceeds the 3s budget", async () => {
    process.env.ANATOMY_DRY_RUN_TIMEOUT_MS = "1";
    try {
      const dir = repoWith({ "a.ts": "x", "b.ts": "y", "c.ts": "z" });
      const result = await dryRun(dir, {
        kind: "ast_pattern",
        lang: "ts",
        pattern: "console.log($X)",
        forbid_in: "**/*.ts",
      });
      expect(result.accepted).toBe(false);
      expect(result.reason).toMatch(/timed out/i);
      rmSync(dir, { recursive: true, force: true });
    } finally {
      delete process.env.ANATOMY_DRY_RUN_TIMEOUT_MS;
    }
  });
});
