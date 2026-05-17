import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { suggestFromTests } from "../../src/verify-suggest/test-mining.js";

function testRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "anat-test-mining-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    const lastSep = full.lastIndexOf(sep);
    if (lastSep > dir.length) mkdirSync(full.slice(0, lastSep), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

describe("suggestFromTests — happy path", () => {
  it("proposes ast_pattern verifier for a rule mentioning an asserted error class", async () => {
    const dir = testRepo({
      "test/decorate.test.ts":
        `import { test } from "vitest";\n` +
        `test("decorate after listen throws", () => {\n` +
        `  expect(() => fastify.decorate("x", 1)).toThrow(FST_ERR_DEC_AFTER_START);\n` +
        `});\n`,
    });
    const rule = {
      rule: "Decorators must be added before listen() — calling decorate() after listen() throws FST_ERR_DEC_AFTER_START.",
      why: "Decorators are frozen into the prototype chain at startup.",
    };
    const candidate = await suggestFromTests(dir, rule);
    expect(candidate).toEqual({
      kind: "ast_pattern",
      lang: "ts",
      pattern: "throw new FST_ERR_DEC_AFTER_START($$$)",
      expect_in: "**/*.{ts,js}",
    });
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("suggestFromTests — assertion variants", () => {
  it("matches expect(...).toThrowError", async () => {
    const dir = testRepo({
      "test/x.test.ts": `expect(() => f()).toThrowError(FOO_ERR);\n`,
    });
    const candidate = await suggestFromTests(dir, { rule: "must throw FOO_ERR" });
    expect(candidate?.kind).toBe("ast_pattern");
    expect((candidate as { pattern: string }).pattern).toContain("FOO_ERR");
    rmSync(dir, { recursive: true, force: true });
  });

  it("matches assert.throws(..., ClassName)", async () => {
    const dir = testRepo({
      "test/y.test.ts":
        `import assert from "node:assert";\n` +
        `assert.throws(() => f(), BAR_ERR);\n`,
    });
    const candidate = await suggestFromTests(dir, { rule: "must throw BAR_ERR" });
    expect(candidate?.kind).toBe("ast_pattern");
    expect((candidate as { pattern: string }).pattern).toContain("BAR_ERR");
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("suggestFromTests — no match", () => {
  it("returns null when rule mentions no ALL_CAPS identifier", async () => {
    const dir = testRepo({ "test/x.test.ts": `expect(f()).toBe(1);\n` });
    const candidate = await suggestFromTests(dir, { rule: "the answer is 1" });
    expect(candidate).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns null when no test asserts the identifier is thrown", async () => {
    const dir = testRepo({
      "test/x.test.ts": `expect(f()).toBe(NOT_THIS_ONE);\n`,
    });
    const candidate = await suggestFromTests(dir, { rule: "must throw FST_ERR_DEC_AFTER_START" });
    expect(candidate).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns null when no test files exist", async () => {
    const dir = testRepo({ "src/main.ts": "export const x = 1;\n" });
    const candidate = await suggestFromTests(dir, { rule: "uses FOO" });
    expect(candidate).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });
});
