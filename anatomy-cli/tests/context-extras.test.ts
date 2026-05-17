import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { buildGitLog, buildTestSample, buildImportSample } from "../src/pass2/context-extras.js";

describe("buildGitLog", () => {
  it("returns formatted log for a repo with commits", () => {
    const dir = mkdtempSync(join(tmpdir(), "anat-extras-"));
    execSync("git init", { cwd: dir, stdio: "ignore" });
    execSync('git config user.email "test@test.com"', { cwd: dir, stdio: "ignore" });
    execSync('git config user.name "Test"', { cwd: dir, stdio: "ignore" });
    execSync("git commit --allow-empty -m \"initial commit\"", { cwd: dir, stdio: "ignore" });
    const result = buildGitLog(dir);
    expect(result).toMatch(/^## Recent commits\n/);
    expect(result).toContain("initial commit");
  });

  it("returns empty string for a non-git directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "anat-extras-"));
    expect(buildGitLog(dir)).toBe("");
  });

  it("returns empty string for a git repo with no commits", () => {
    const dir = mkdtempSync(join(tmpdir(), "anat-extras-"));
    execSync("git init", { cwd: dir, stdio: "ignore" });
    expect(buildGitLog(dir)).toBe("");
  });
});

describe("buildTestSample", () => {
  it("returns empty string when no test files exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "anat-extras-"));
    expect(buildTestSample(dir)).toBe("");
  });

  it("returns content from a test file in a tests/ directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "anat-extras-"));
    mkdirSync(join(dir, "tests"));
    writeFileSync(join(dir, "tests", "core.test.ts"), "describe('core', () => { it('works', () => {}); });");
    const result = buildTestSample(dir);
    expect(result).toMatch(/^## Test sample: tests\/core\.test\.ts\n/);
    expect(result).toContain("describe('core'");
  });

  it("prefers a test file matching the entry point stem", () => {
    const dir = mkdtempSync(join(tmpdir(), "anat-extras-"));
    mkdirSync(join(dir, "tests"));
    writeFileSync(join(dir, "tests", "utils.test.ts"), "// utils test");
    writeFileSync(join(dir, "tests", "index.test.ts"), "// index test — should be preferred");
    const result = buildTestSample(dir, "src/index.ts");
    expect(result).toContain("index.test.ts");
    expect(result).toContain("// index test");
    expect(result).not.toContain("utils.test.ts");
  });

  it("caps output at 60 content lines", () => {
    const dir = mkdtempSync(join(tmpdir(), "anat-extras-"));
    mkdirSync(join(dir, "tests"));
    const manyLines = Array.from({ length: 120 }, (_, i) => `// line ${i}`).join("\n");
    writeFileSync(join(dir, "tests", "big.test.ts"), manyLines);
    const result = buildTestSample(dir);
    // Strip the header line, count remaining content lines
    const contentLines = result.split("\n").slice(1);
    expect(contentLines.length).toBe(60);
  });
});

describe("buildImportSample", () => {
  it("returns empty string for non-TS/JS entry points", () => {
    const dir = mkdtempSync(join(tmpdir(), "anat-extras-"));
    expect(buildImportSample(dir, "src/main.rs")).toBe("");
    expect(buildImportSample(dir, "main.go")).toBe("");
    expect(buildImportSample(dir, "main.py")).toBe("");
  });

  it("returns empty string when entry point file does not exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "anat-extras-"));
    expect(buildImportSample(dir, "src/index.ts")).toBe("");
  });

  it("returns empty string when entry point has no local imports", () => {
    const dir = mkdtempSync(join(tmpdir(), "anat-extras-"));
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "index.ts"), `
import { readFile } from "node:fs";
import lodash from "lodash";
export function main() {}
`);
    expect(buildImportSample(dir, "src/index.ts")).toBe("");
  });

  it("surfaces content of locally-imported files", () => {
    const dir = mkdtempSync(join(tmpdir(), "anat-extras-"));
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "index.ts"), `
import { runPipeline } from './pipeline';
import type { Config } from './types';
export { main } from './main';
`);
    writeFileSync(join(dir, "src", "pipeline.ts"), "// pipeline implementation\nexport function runPipeline() {}");
    writeFileSync(join(dir, "src", "types.ts"), "// type definitions\nexport interface Config {}");
    writeFileSync(join(dir, "src", "main.ts"), "// main module\nexport function main() {}");

    const result = buildImportSample(dir, "src/index.ts");
    expect(result).toMatch(/^## Key source files/);
    expect(result).toContain("pipeline.ts");
    expect(result).toContain("types.ts");
    expect(result).toContain("main.ts");
  });

  it("caps at 3 imported files", () => {
    const dir = mkdtempSync(join(tmpdir(), "anat-extras-"));
    mkdirSync(join(dir, "src"), { recursive: true });
    const imports = Array.from({ length: 5 }, (_, i) => `import {} from './mod${i}';`).join("\n");
    writeFileSync(join(dir, "src", "index.ts"), imports);
    for (let i = 0; i < 5; i++) {
      writeFileSync(join(dir, "src", `mod${i}.ts`), `// module ${i}`);
    }
    const result = buildImportSample(dir, "src/index.ts");
    const fileHeaders = (result.match(/^### /gm) ?? []).length;
    expect(fileHeaders).toBe(3);
  });

  it("deduplicates when two specifiers resolve to the same file", () => {
    const dir = mkdtempSync(join(tmpdir(), "anat-extras-"));
    mkdirSync(join(dir, "src"), { recursive: true });
    // './utils' and './utils.js' both resolve to utils.ts in a NodeNext repo
    writeFileSync(join(dir, "src", "index.ts"), `
import { foo } from './utils';
import { bar } from './utils.js';
`);
    writeFileSync(join(dir, "src", "utils.ts"), "// utils content");
    const result = buildImportSample(dir, "src/index.ts");
    // utils.ts should appear exactly once despite two specifiers
    const headers = (result.match(/^### /gm) ?? []).length;
    expect(headers).toBe(1);
  });

  it("resolves .js extension specifiers to .ts files (NodeNext pattern)", () => {
    const dir = mkdtempSync(join(tmpdir(), "anat-extras-"));
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "index.ts"), `import { foo } from './utils.js';`);
    writeFileSync(join(dir, "src", "utils.ts"), "// utils content\nexport function foo() {}");
    const result = buildImportSample(dir, "src/index.ts");
    expect(result).toContain("utils.ts");
    expect(result).toContain("// utils content");
  });

  it("resolves .ts extension specifiers directly", () => {
    const dir = mkdtempSync(join(tmpdir(), "anat-extras-"));
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "index.ts"), `import { bar } from './helper.ts';`);
    writeFileSync(join(dir, "src", "helper.ts"), "// helper content\nexport function bar() {}");
    const result = buildImportSample(dir, "src/index.ts");
    expect(result).toContain("helper.ts");
    expect(result).toContain("// helper content");
  });
});
