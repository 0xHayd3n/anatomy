import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { parseRegistry } from "../../src/verify-suggest/registry/parse.js";

function fakeRegistry(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "anat-reg-parse-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    const lastSep = full.lastIndexOf(sep);
    if (lastSep > dir.length) mkdirSync(full.slice(0, lastSep), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

describe("parseRegistry — yaml extraction", () => {
  it("extracts rule metadata from a standard semgrep yaml file", async () => {
    const dir = fakeRegistry({
      "javascript/lang/security/no-console-log.yaml":
        `rules:\n` +
        `  - id: javascript.lang.security.no-console-log\n` +
        `    message: "console.log can leak data in production"\n` +
        `    languages: [javascript, typescript]\n` +
        `    severity: WARNING\n` +
        `    pattern: console.log($X)\n` +
        `    metadata:\n` +
        `      category: best-practice\n`,
    });
    const records = await parseRegistry(dir);
    expect(records.length).toBe(1);
    expect(records[0]).toMatchObject({
      id: "javascript.lang.security.no-console-log",
      message: "console.log can leak data in production",
      category: "best-practice",
    });
    expect(records[0].path).toContain("no-console-log.yaml");
    rmSync(dir, { recursive: true, force: true });
  });

  it("skips files that don't have a top-level rules: key", async () => {
    const dir = fakeRegistry({
      "config.yaml": `not-a-rule: true\n`,
      "rules/x.yaml":
        `rules:\n  - id: x\n    message: "msg"\n    languages: [python]\n    pattern: foo\n`,
    });
    const records = await parseRegistry(dir);
    expect(records.length).toBe(1);
    expect(records[0].id).toBe("x");
    rmSync(dir, { recursive: true, force: true });
  });

  it("handles multiple rules per file", async () => {
    const dir = fakeRegistry({
      "a.yaml":
        `rules:\n` +
        `  - id: rule-one\n    message: "first"\n    languages: [py]\n    pattern: foo\n` +
        `  - id: rule-two\n    message: "second"\n    languages: [py]\n    pattern: bar\n`,
    });
    const records = await parseRegistry(dir);
    expect(records.length).toBe(2);
    expect(records.map(r => r.id).sort()).toEqual(["rule-one", "rule-two"]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("skips .github/ and stats/ directories", async () => {
    const dir = fakeRegistry({
      ".github/CODEOWNERS.yaml": `rules:\n  - id: meta\n    message: x\n    pattern: y\n`,
      "stats/coverage.yaml": `rules:\n  - id: stat\n    message: x\n    pattern: y\n`,
      "real/rule.yaml": `rules:\n  - id: real\n    message: x\n    pattern: y\n`,
    });
    const records = await parseRegistry(dir);
    expect(records.map(r => r.id)).toEqual(["real"]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("handles block-list languages form", async () => {
    const dir = fakeRegistry({
      "block-langs.yaml":
        `rules:\n` +
        `  - id: block-langs\n` +
        `    message: "block-form languages"\n` +
        `    languages:\n` +
        `      - python\n` +
        `      - javascript\n` +
        `    pattern: foo\n`,
    });
    const records = await parseRegistry(dir);
    expect(records.length).toBe(1);
    expect(records[0].languages.sort()).toEqual(["javascript", "python"]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("suppresses block-scalar message indicators (| and >)", async () => {
    const dir = fakeRegistry({
      "block-msg.yaml":
        `rules:\n` +
        `  - id: block-msg\n` +
        `    message: |\n` +
        `      Multi-line\n` +
        `      message body.\n` +
        `    languages: [py]\n` +
        `    pattern: foo\n`,
    });
    const records = await parseRegistry(dir);
    expect(records.length).toBe(1);
    // The block-scalar continuation is not parsed; message becomes empty
    // rather than the literal "|" character which would confuse consumers.
    expect(records[0].message).toBe("");
    rmSync(dir, { recursive: true, force: true });
  });
});
