import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { suggestRulesForAnatomy } from "../../src/verify-suggest/index.js";

beforeEach(() => {
  vi.resetModules();
});

function repoWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "anat-pipeline-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    const lastSep = full.lastIndexOf(sep);
    if (lastSep > dir.length) mkdirSync(full.slice(0, lastSep), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

describe("suggestRulesForAnatomy", () => {
  it("skips rules that already have a verify clause", async () => {
    const dir = repoWith({ "package.json": "{}" });
    const doc = {
      rules: [
        { rule: "r1", verify: { kind: "glob_exists", path: "package.json" } },
        { rule: "r2" },
      ],
    };
    const out: { ruleIndex: number; source: string | null }[] = [];
    for await (const sug of suggestRulesForAnatomy(dir, doc, { disableRegistry: true, disableLLM: true })) {
      out.push({ ruleIndex: sug.ruleIndex, source: sug.source });
    }
    expect(out.map(o => o.ruleIndex)).toEqual([1]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("yields a 'no candidate' suggestion when every source returns null", async () => {
    const dir = repoWith({ "package.json": "{}" });
    const doc = {
      rules: [{ rule: "abstract runtime-ordering invariant with no identifiers" }],
    };
    const out: { source: string | null; candidate: unknown }[] = [];
    for await (const sug of suggestRulesForAnatomy(dir, doc, { disableRegistry: true, disableLLM: true })) {
      out.push({ source: sug.source, candidate: sug.candidate });
    }
    expect(out.length).toBe(1);
    expect(out[0].source).toBeNull();
    expect(out[0].candidate).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });

  it("yields a test-mining suggestion when a rule matches a thrown identifier", async () => {
    const dir = repoWith({
      "package.json": "{}",
      "test/x.test.ts": `expect(() => f()).toThrow(MY_ERR);\n`,
    });
    writeFileSync(join(dir, "main.ts"), "throw new MY_ERR();\n");
    const doc = {
      rules: [{ rule: "Functions must throw MY_ERR when called incorrectly." }],
    };
    const out: { source: string | null; candidate: unknown }[] = [];
    for await (const sug of suggestRulesForAnatomy(dir, doc, { disableRegistry: true, disableLLM: true })) {
      out.push({ source: sug.source, candidate: sug.candidate });
    }
    expect(out.length).toBe(1);
    expect(out[0].source).toBe("test-mining");
    expect(out[0].candidate).toMatchObject({ kind: "ast_pattern", pattern: "throw new MY_ERR($$$)" });
    rmSync(dir, { recursive: true, force: true });
  });
});
