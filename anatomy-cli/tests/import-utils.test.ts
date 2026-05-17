import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractLocalSpecifiers, resolveSpecifier } from "../src/pass1/import-utils.js";

describe("extractLocalSpecifiers", () => {
  it("extracts named import specifiers", () => {
    const src = `import { foo } from './foo.js';\nimport { bar } from './bar.js';`;
    expect(extractLocalSpecifiers(src)).toEqual(["./foo.js", "./bar.js"]);
  });

  it("ignores bare module imports", () => {
    const src = `import { x } from 'lodash';\nimport { y } from './local.js';`;
    expect(extractLocalSpecifiers(src)).toEqual(["./local.js"]);
  });

  it("deduplicates", () => {
    const src = `import { a } from './x.js';\nimport { b } from './x.js';`;
    expect(extractLocalSpecifiers(src)).toEqual(["./x.js"]);
  });

  it("captures side-effect imports", () => {
    const src = `import './side.js';`;
    expect(extractLocalSpecifiers(src)).toEqual(["./side.js"]);
  });

  it("captures multiple side-effect imports on the same line", () => {
    const src = `import './a.js'; import './b.js'; import './c.js';`;
    const result = extractLocalSpecifiers(src);
    expect(result).toContain("./a.js");
    expect(result).toContain("./b.js");
    expect(result).toContain("./c.js");
  });
});

describe("resolveSpecifier", () => {
  it("resolves .js specifier to existing file", () => {
    const dir = mkdtempSync(join(tmpdir(), "anat-iu-"));
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "foo.js"), "");
    const result = resolveSpecifier(dir, "src/index.js", "./foo.js");
    expect(result).toBe(join(dir, "src", "foo.js"));
  });

  it("swaps .js to .ts when .ts exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "anat-iu-"));
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "foo.ts"), "");
    const result = resolveSpecifier(dir, "src/index.ts", "./foo.js");
    expect(result).toBe(join(dir, "src", "foo.ts"));
  });

  it("returns null for non-existent file", () => {
    const dir = mkdtempSync(join(tmpdir(), "anat-iu-"));
    mkdirSync(join(dir, "src"));
    expect(resolveSpecifier(dir, "src/index.js", "./missing.js")).toBeNull();
  });
});
