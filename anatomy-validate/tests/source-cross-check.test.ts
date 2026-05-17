import { describe, it, expect } from "vitest";
import { sourceCrossCheck, extractLiterals, findQuotedReference, buildSourceIndex } from "../src/checks/source-cross-check.js";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function mkScratchRepo(): string {
  return mkdtempSync(join(tmpdir(), "anat-sxc-"));
}

describe("sourceCrossCheck — scaffolding", () => {
  it("returns empty errors+warnings when repoRoot is undefined", () => {
    const result = sourceCrossCheck({}, undefined);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("returns empty errors+warnings on an empty doc with repoRoot set", () => {
    const result = sourceCrossCheck({}, "/nonexistent");
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});

describe("extractLiterals", () => {
  it("extracts host-port from localhost:NNNN", () => {
    expect(extractLiterals("see localhost:2022 for details")).toEqual([
      { literal: "localhost:2022", kind: "host-port" },
    ]);
  });

  it("extracts host-port from 127.0.0.1:NNNN and 0.0.0.0:NNNN", () => {
    const result = extractLiterals("bind 127.0.0.1:8080 or 0.0.0.0:443");
    expect(result).toEqual([
      { literal: "127.0.0.1:8080", kind: "host-port" },
      { literal: "0.0.0.0:443", kind: "host-port" },
    ]);
  });

  it("does not match bare port like :2022 without a host prefix", () => {
    expect(extractLiterals("uses port :2022")).toEqual([]);
  });

  it("does not match timestamps like 01:30:00 as host-port", () => {
    expect(extractLiterals("at 01:30:00 something happens")).toEqual([]);
  });

  it("extracts scoped-package literals", () => {
    expect(extractLiterals("uses @codemirror/parser for syntax")).toEqual([
      { literal: "@codemirror/parser", kind: "scoped-package" },
    ]);
  });

  it("skips @types/* scoped packages", () => {
    expect(extractLiterals("requires @types/node at compile time")).toEqual([]);
  });

  it("does not match bare @scope without /name segment", () => {
    expect(extractLiterals("ping @alice in slack")).toEqual([]);
  });

  it("does not match email addresses as scoped packages", () => {
    expect(extractLiterals("contact contact@example.com")).toEqual([]);
  });

  it("extracts source-path literals anchored to known prefixes", () => {
    const result = extractLiterals("see src/main/index.ts and tests/foo.test.py");
    expect(result).toEqual([
      { literal: "src/main/index.ts", kind: "source-path" },
      { literal: "tests/foo.test.py", kind: "source-path" },
    ]);
  });

  it("does not match paths without recognized prefix", () => {
    expect(extractLiterals("see something.ts here")).toEqual([]);
  });

  it("does not match paths under node_modules", () => {
    expect(extractLiterals("look in node_modules/foo/bar.js")).toEqual([]);
  });

  it("deduplicates identical (literal, kind) pairs within one input", () => {
    const result = extractLiterals("localhost:2022 and again localhost:2022");
    expect(result).toEqual([
      { literal: "localhost:2022", kind: "host-port" },
    ]);
  });

  it("returns empty array for text with no extractable literals", () => {
    expect(extractLiterals("a perfectly normal sentence with no patterns")).toEqual([]);
  });
});

describe("findQuotedReference", () => {
  it("matches a name in single quotes", () => {
    expect(findQuotedReference("react", "import { useState } from 'react';")).toBe(true);
  });

  it("matches a name in double quotes", () => {
    expect(findQuotedReference("react", `const r = require("react");`)).toBe(true);
  });

  it("matches in JSON-style key contexts", () => {
    expect(findQuotedReference("react", `{ "dependencies": { "react": "^19.0.0" } }`)).toBe(true);
  });

  it("does not match a substring of a longer name (react vs react-dom)", () => {
    expect(findQuotedReference("react", `import x from 'react-dom';`)).toBe(false);
    expect(findQuotedReference("react", `import x from 'reactor';`)).toBe(false);
  });

  it("matches a scoped package name", () => {
    expect(findQuotedReference("@codemirror/parser", `import x from '@codemirror/parser';`)).toBe(true);
  });

  it("matches subpath imports of a scoped package (@fontsource/inter/400.css)", () => {
    // Subpath imports are common for CSS / dist files / submodules. Without
    // this, packages used only via subpath imports false-positive as unused.
    expect(findQuotedReference("@fontsource/inter", `import '@fontsource/inter/400.css';`)).toBe(true);
    expect(findQuotedReference("@fontsource/inter", `import "@fontsource/inter/500.css";`)).toBe(true);
  });

  it("matches subpath imports of a bare package (react-dom/client)", () => {
    expect(findQuotedReference("react-dom", `import { createRoot } from 'react-dom/client';`)).toBe(true);
  });

  it("subpath match does not false-positive on hyphen extensions", () => {
    // Ensure adding `/` to the boundary set doesn't accidentally let `react`
    // match `react-dom`. After `react` here is `-`, which is still rejected.
    expect(findQuotedReference("react", `import x from 'react-dom/client';`)).toBe(false);
  });

  it("returns false on empty haystack", () => {
    expect(findQuotedReference("react", "")).toBe(false);
  });

  it("returns false when name does not appear at all", () => {
    expect(findQuotedReference("react", "no relevant content here")).toBe(false);
  });
});

describe("buildSourceIndex", () => {
  it("walks directories listed in structureEntries", () => {
    const root = mkScratchRepo();
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "a.ts"), "import 'react';");
    const idx = buildSourceIndex(root, [{ path: "src" }]);
    expect(idx.files.length).toBe(1);
    expect(idx.files[0].relPath.endsWith("a.ts")).toBe(true);
    expect(idx.combinedHaystack).toContain("import 'react';");
    expect(idx.truncated).toBe(false);
  });

  it("includes package.json at the scan root", () => {
    const root = mkScratchRepo();
    writeFileSync(join(root, "package.json"), `{ "name": "x" }`);
    const idx = buildSourceIndex(root, []);
    expect(idx.combinedHaystack).toContain(`"name": "x"`);
  });

  it("includes top-level config files matching the pattern", () => {
    const root = mkScratchRepo();
    writeFileSync(join(root, "vite.config.ts"), "export default { name: 'v' }");
    writeFileSync(join(root, ".eslintrc.cjs"), "module.exports = { name: 'e' };");
    writeFileSync(join(root, "tsconfig.json"), `{ "compilerOptions": {} }`);
    const idx = buildSourceIndex(root, []);
    expect(idx.combinedHaystack).toContain("export default { name: 'v' }");
    expect(idx.combinedHaystack).toContain("module.exports = { name: 'e' };");
    expect(idx.combinedHaystack).toContain(`"compilerOptions"`);
  });

  it("includes Makefile, Dockerfile, docker-compose.{yml,yaml}", () => {
    const root = mkScratchRepo();
    writeFileSync(join(root, "Makefile"), "build:\n\tnpm run build");
    writeFileSync(join(root, "Dockerfile"), "FROM node:22");
    writeFileSync(join(root, "docker-compose.yml"), "version: '3'");
    const idx = buildSourceIndex(root, []);
    expect(idx.combinedHaystack).toContain("npm run build");
    expect(idx.combinedHaystack).toContain("FROM node:22");
    expect(idx.combinedHaystack).toContain("version: '3'");
  });

  it("includes .github/workflows/*.yml", () => {
    const root = mkScratchRepo();
    mkdirSync(join(root, ".github", "workflows"), { recursive: true });
    writeFileSync(join(root, ".github", "workflows", "ci.yml"), "name: CI\non: push");
    const idx = buildSourceIndex(root, []);
    expect(idx.combinedHaystack).toContain("name: CI");
  });

  it("excludes node_modules, .git, dist, build, target, out, .next, .turbo, etc.", () => {
    const root = mkScratchRepo();
    mkdirSync(join(root, "src"), { recursive: true });
    mkdirSync(join(root, "node_modules", "react"), { recursive: true });
    mkdirSync(join(root, "dist"), { recursive: true });
    mkdirSync(join(root, ".turbo"), { recursive: true });
    writeFileSync(join(root, "src", "ok.ts"), "// ok");
    writeFileSync(join(root, "node_modules", "react", "index.js"), "EXCLUDED_NM");
    writeFileSync(join(root, "dist", "out.js"), "EXCLUDED_DIST");
    writeFileSync(join(root, ".turbo", "x"), "EXCLUDED_TURBO");
    const idx = buildSourceIndex(root, [{ path: "src" }]);
    expect(idx.combinedHaystack).toContain("// ok");
    expect(idx.combinedHaystack).not.toContain("EXCLUDED_NM");
    expect(idx.combinedHaystack).not.toContain("EXCLUDED_DIST");
    expect(idx.combinedHaystack).not.toContain("EXCLUDED_TURBO");
  });

  it("skips files larger than 256 KB", () => {
    const root = mkScratchRepo();
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "big.ts"), "X".repeat(300_000));
    writeFileSync(join(root, "src", "small.ts"), "import 'lodash';");
    const idx = buildSourceIndex(root, [{ path: "src" }]);
    expect(idx.combinedHaystack).toContain("import 'lodash';");
    expect(idx.combinedHaystack).not.toContain("X".repeat(300_000));
  });

  it("skips binary files (NUL byte in first 4 KB)", () => {
    const root = mkScratchRepo();
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "binary.bin"), Buffer.from([0x42, 0x00, 0x42, 0x00, 0x42]));
    writeFileSync(join(root, "src", "ok.ts"), "// ok");
    const idx = buildSourceIndex(root, [{ path: "src" }]);
    expect(idx.combinedHaystack).toContain("// ok");
    expect(idx.combinedHaystack.split("\x00")[0]).not.toMatch(/binary/);
  });

  it("sets truncated:true and stops loading when total exceeds the byte budget", () => {
    const root = mkScratchRepo();
    mkdirSync(join(root, "src"), { recursive: true });
    // 50 files × 200 KB = 10 MB; each file under per-file 256 KB cap.
    for (let i = 0; i < 50; i++) {
      writeFileSync(join(root, "src", `f${i}.ts`), "Y".repeat(200_000));
    }
    // The default budget is 32 MB; explicitly cap to 4 MB for this test so
    // 10 MB of source overflows. Without this override the 32 MB default
    // would absorb the test data (covered by a separate test below).
    process.env.ANATOMY_SOURCE_SCAN_BYTES = "4M";
    try {
      const idx = buildSourceIndex(root, [{ path: "src" }]);
      expect(idx.truncated).toBe(true);
      // Should have loaded *some* files but not all 50.
      expect(idx.files.length).toBeGreaterThan(0);
      expect(idx.files.length).toBeLessThan(50);
    } finally {
      delete process.env.ANATOMY_SOURCE_SCAN_BYTES;
    }
  });

  it("default 32 MB budget absorbs the same 10 MB without truncating", () => {
    const root = mkScratchRepo();
    mkdirSync(join(root, "src"), { recursive: true });
    for (let i = 0; i < 50; i++) {
      writeFileSync(join(root, "src", `f${i}.ts`), "Y".repeat(200_000));
    }
    const idx = buildSourceIndex(root, [{ path: "src" }]);
    expect(idx.truncated).toBe(false);
    expect(idx.maxTotalBytes).toBe(32 * 1024 * 1024);
  });

  it("skips files whose extension is in the SKIP_EXT_RE blocklist", () => {
    const root = mkScratchRepo();
    mkdirSync(join(root, "docs"), { recursive: true });
    // .html / .min.js / .ipynb / .lock are dropped before stat() — they
    // never end up in the haystack. A regular .ts file alongside them is
    // indexed normally.
    writeFileSync(join(root, "docs", "index.html"), "<html>full of noise</html>");
    writeFileSync(join(root, "docs", "bundle.min.js"), "function(a,b){return a+b}");
    writeFileSync(join(root, "docs", "notebook.ipynb"), `{"cells":[]}`);
    writeFileSync(join(root, "docs", "package-lock.json"), `{ "lockfileVersion": 3 }`);
    writeFileSync(join(root, "docs", "real.ts"), "import 'lodash';");
    const idx = buildSourceIndex(root, [{ path: "docs" }]);
    const paths = idx.files.map(f => f.relPath.replace(/\\/g, "/"));
    expect(paths).toContain("docs/real.ts");
    expect(paths.find(p => p.endsWith(".html"))).toBeUndefined();
    expect(paths.find(p => p.endsWith(".min.js"))).toBeUndefined();
    expect(paths.find(p => p.endsWith(".ipynb"))).toBeUndefined();
    // Note: package-lock.json IS the structural manifest path, but its content
    // ends in .json (not .lock); it's caught only when the file truly ends in
    // .lock (e.g. yarn.lock, Cargo.lock). package-lock.json reaches load.
    expect(paths.find(p => p.endsWith(".lock"))).toBeUndefined();
  });

  it("excludes documentation build outputs (site/, _site/, _build/) from the scan", () => {
    const root = mkScratchRepo();
    mkdirSync(join(root, "src"), { recursive: true });
    mkdirSync(join(root, "site"), { recursive: true });
    mkdirSync(join(root, "_site"), { recursive: true });
    mkdirSync(join(root, "_build"), { recursive: true });
    writeFileSync(join(root, "src", "real.ts"), "import 'a';");
    writeFileSync(join(root, "site", "noise.ts"), "import 'b';");
    writeFileSync(join(root, "_site", "more.ts"), "import 'c';");
    writeFileSync(join(root, "_build", "even-more.ts"), "import 'd';");
    // structure entry covers root walk via repeated . — but EXCLUDE_DIRS
    // applies during recursive walk inside structure entries too.
    const idx = buildSourceIndex(root, [{ path: "." }]);
    const paths = idx.files.map(f => f.relPath.replace(/\\/g, "/"));
    expect(paths).toContain("src/real.ts");
    expect(paths.find(p => p.startsWith("site/"))).toBeUndefined();
    expect(paths.find(p => p.startsWith("_site/"))).toBeUndefined();
    expect(paths.find(p => p.startsWith("_build/"))).toBeUndefined();
  });

  it("dedupes by absolute path when a file appears via two include rules", () => {
    const root = mkScratchRepo();
    // package.json is both the manifest include AND would be in a structure
    // entry pointing to the root. Verify no duplication.
    writeFileSync(join(root, "package.json"), `{ "name": "x" }`);
    const idx = buildSourceIndex(root, [{ path: "." }]);
    const pkgCount = idx.files.filter(f => f.relPath.endsWith("package.json")).length;
    expect(pkgCount).toBe(1);
  });

  it("returns empty index when scan root does not exist", () => {
    const idx = buildSourceIndex("/nonexistent/path/xyz", [{ path: "src" }]);
    expect(idx.files).toEqual([]);
    expect(idx.combinedHaystack).toBe("");
    expect(idx.truncated).toBe(false);
  });
});

describe("sourceCrossCheck — Class 1 (dep usage)", () => {
  it("no warning when dep name appears as quoted reference in src", () => {
    const root = mkScratchRepo();
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "index.ts"), "import _ from 'lodash';");
    const doc = {
      structure: { entries: [{ path: "src", kind: "source" }] },
      substance: { key_dependencies: [{ name: "lodash" }] },
    };
    const r = sourceCrossCheck(doc, root);
    expect(r.warnings).toEqual([]);
  });

  it("warns when dep is ONLY declared in package.json dependencies (Snipper @codemirror/* case)", () => {
    // Declaration in dependencies/devDependencies/etc is the manifest claim
    // itself — it does not constitute usage. Without an import or a script
    // invocation, the dep is unused and the claim is drift.
    const root = mkScratchRepo();
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "index.ts"), "// nothing imports codemirror");
    writeFileSync(join(root, "package.json"), `{ "name": "x", "dependencies": { "@codemirror/parser": "^1.0.0" } }`);
    const doc = {
      structure: { entries: [{ path: "src", kind: "source" }] },
      substance: { key_dependencies: [{ name: "@codemirror/parser" }] },
    };
    const r = sourceCrossCheck(doc, root);
    expect(r.warnings.length).toBe(1);
    expect(r.warnings[0].code).toBe("unused-dependency-claim");
    expect(r.warnings[0].actual).toBe("@codemirror/parser");
  });

  it("warns when dep is in devDependencies but never imported", () => {
    const root = mkScratchRepo();
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "index.ts"), "// nothing");
    writeFileSync(join(root, "package.json"),
      `{ "name": "x", "devDependencies": { "@fontsource/inter": "^5.2.8" } }`);
    const doc = {
      structure: { entries: [{ path: "src", kind: "source" }] },
      substance: { key_dependencies: [{ name: "@fontsource/inter" }] },
    };
    const r = sourceCrossCheck(doc, root);
    expect(r.warnings.length).toBe(1);
    expect(r.warnings[0].code).toBe("unused-dependency-claim");
  });

  it("warns even when dep is in peerDependencies and optionalDependencies", () => {
    const root = mkScratchRepo();
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "index.ts"), "// nothing");
    writeFileSync(join(root, "package.json"),
      `{ "name": "x", "peerDependencies": { "peer-pkg": "*" }, "optionalDependencies": { "opt-pkg": "*" } }`);
    const doc = {
      structure: { entries: [{ path: "src", kind: "source" }] },
      substance: { key_dependencies: [{ name: "peer-pkg" }, { name: "opt-pkg" }] },
    };
    const r = sourceCrossCheck(doc, root);
    expect(r.warnings.length).toBe(2);
  });

  it("warns when dep is missing from src AND package.json", () => {
    const root = mkScratchRepo();
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "index.ts"), "// no codemirror references");
    writeFileSync(join(root, "package.json"), `{ "name": "x", "dependencies": { "react": "^19" } }`);
    const doc = {
      structure: { entries: [{ path: "src", kind: "source" }] },
      substance: { key_dependencies: [{ name: "@codemirror/parser" }] },
    };
    const r = sourceCrossCheck(doc, root);
    expect(r.warnings.length).toBe(1);
    expect(r.warnings[0].code).toBe("unused-dependency-claim");
    expect(r.warnings[0].pointer).toBe("/substance/key_dependencies/0");
    expect(r.warnings[0].actual).toBe("@codemirror/parser");
  });

  it("no warning for @types/* deps even when missing from source", () => {
    const root = mkScratchRepo();
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "index.ts"), "// no refs");
    const doc = {
      structure: { entries: [{ path: "src", kind: "source" }] },
      substance: { key_dependencies: [{ name: "@types/node" }] },
    };
    const r = sourceCrossCheck(doc, root);
    expect(r.warnings).toEqual([]);
  });

  it("no warning for husky / lint-staged tooling-allowlist deps", () => {
    const root = mkScratchRepo();
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "index.ts"), "// no refs");
    const doc = {
      structure: { entries: [{ path: "src", kind: "source" }] },
      substance: {
        key_dependencies: [
          { name: "husky" },
          { name: "lint-staged" },
        ],
      },
    };
    const r = sourceCrossCheck(doc, root);
    expect(r.warnings).toEqual([]);
  });

  it("no warning when dep is invoked as a bare command in package.json scripts (prettier case)", () => {
    // prettier in scripts → real usage, even though it's not imported and
    // not present in source/. Bin name == package name is the common case.
    const root = mkScratchRepo();
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "index.ts"), "// no prettier ref in src");
    writeFileSync(join(root, "package.json"),
      `{ "name": "x", "scripts": { "format": "prettier --write ." }, "devDependencies": { "prettier": "^3" } }`);
    const doc = {
      structure: { entries: [{ path: "src", kind: "source" }] },
      substance: { key_dependencies: [{ name: "prettier" }] },
    };
    const r = sourceCrossCheck(doc, root);
    expect(r.warnings).toEqual([]);
  });

  it("no warning when dep is invoked via npx in a script", () => {
    const root = mkScratchRepo();
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "index.ts"), "// nothing");
    writeFileSync(join(root, "package.json"),
      `{ "name": "x", "scripts": { "build": "npx esbuild src/main.ts --bundle" } }`);
    const doc = {
      structure: { entries: [{ path: "src", kind: "source" }] },
      substance: { key_dependencies: [{ name: "esbuild" }] },
    };
    const r = sourceCrossCheck(doc, root);
    expect(r.warnings).toEqual([]);
  });

  it("no warning when dep is invoked after && or pipe in a script", () => {
    const root = mkScratchRepo();
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "index.ts"), "// nothing");
    writeFileSync(join(root, "package.json"),
      `{ "name": "x", "scripts": { "ci": "npm run lint && vitest run" } }`);
    const doc = {
      structure: { entries: [{ path: "src", kind: "source" }] },
      substance: { key_dependencies: [{ name: "vitest" }] },
    };
    const r = sourceCrossCheck(doc, root);
    expect(r.warnings).toEqual([]);
  });

  it("no warning for @scope/name dep invoked via conventional <scope>-<name> bin (Snipper @electron/rebuild)", () => {
    // Many scoped CLI packages publish a bin named <scope>-<name> (e.g.
    // `@electron/rebuild` → `electron-rebuild`). Match the conventional form
    // when checking script invocations.
    const root = mkScratchRepo();
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "index.ts"), "// no rebuild ref");
    writeFileSync(join(root, "package.json"),
      `{ "name": "x", "scripts": { "postinstall": "electron-rebuild" }, "devDependencies": { "@electron/rebuild": "^4" } }`);
    const doc = {
      structure: { entries: [{ path: "src", kind: "source" }] },
      substance: { key_dependencies: [{ name: "@electron/rebuild" }] },
    };
    const r = sourceCrossCheck(doc, root);
    expect(r.warnings).toEqual([]);
  });

  it("no warning when dep is imported by a top-level source file at scan root (Verbifex case)", () => {
    // Small repos often put server.js / database.js at the root rather than
    // under src/. The scan should pick those up so deps imported there don't
    // FP just because the structure entry only lists src/ (or nothing).
    const root = mkScratchRepo();
    writeFileSync(join(root, "server.js"),
      `const express = require("express");\nconst Anthropic = require("@anthropic-ai/sdk");`);
    writeFileSync(join(root, "package.json"),
      `{ "name": "x", "dependencies": { "express": "^4", "@anthropic-ai/sdk": "^0.32" } }`);
    const doc = {
      structure: { entries: [] },
      substance: { key_dependencies: [{ name: "express" }, { name: "@anthropic-ai/sdk" }] },
    };
    const r = sourceCrossCheck(doc, root);
    expect(r.warnings).toEqual([]);
  });

  it("finds dep referenced only in a config file", () => {
    const root = mkScratchRepo();
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "index.ts"), "// no eslint ref");
    writeFileSync(join(root, ".eslintrc.cjs"), `module.exports = { extends: ['eslint:recommended'] };`);
    writeFileSync(join(root, "package.json"), `{ "name": "x" }`);
    const doc = {
      structure: { entries: [{ path: "src", kind: "source" }] },
      substance: { key_dependencies: [{ name: "eslint:recommended" }] },
    };
    const r = sourceCrossCheck(doc, root);
    expect(r.warnings).toEqual([]);
  });

  it("emits one warning per unused dep, in order", () => {
    const root = mkScratchRepo();
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "index.ts"), "// nothing");
    writeFileSync(join(root, "package.json"), `{ "name": "x" }`);
    const doc = {
      structure: { entries: [{ path: "src", kind: "source" }] },
      substance: {
        key_dependencies: [
          { name: "react" },
          { name: "@codemirror/view" },
        ],
      },
    };
    const r = sourceCrossCheck(doc, root);
    expect(r.warnings.length).toBe(2);
    expect(r.warnings[0].pointer).toBe("/substance/key_dependencies/0");
    expect(r.warnings[0].actual).toBe("react");
    expect(r.warnings[1].pointer).toBe("/substance/key_dependencies/1");
    expect(r.warnings[1].actual).toBe("@codemirror/view");
  });

  it("emits source-cross-check-truncated warning when scan exceeds the budget", () => {
    const root = mkScratchRepo();
    mkdirSync(join(root, "src"), { recursive: true });
    for (let i = 0; i < 50; i++) {
      writeFileSync(join(root, "src", `f${i}.ts`), "Z".repeat(200_000));
    }
    writeFileSync(join(root, "package.json"), `{ "name": "x" }`);
    const doc = {
      structure: { entries: [{ path: "src", kind: "source" }] },
      substance: { key_dependencies: [{ name: "react" }] },
    };
    // Cap to 4 MB so the 10 MB of test data overflows; default 32 MB would absorb it.
    process.env.ANATOMY_SOURCE_SCAN_BYTES = "4M";
    try {
      const r = sourceCrossCheck(doc, root);
      const truncWarn = r.warnings.find(w => w.code === "source-cross-check-truncated");
      expect(truncWarn).toBeDefined();
      // Warning should name the first skipped file + the env-var escape hatch.
      expect(truncWarn!.message).toMatch(/First file skipped: "[^"]*\.ts"/);
      expect(truncWarn!.message).toMatch(/ANATOMY_SOURCE_SCAN_BYTES/);
    } finally {
      delete process.env.ANATOMY_SOURCE_SCAN_BYTES;
    }
  });

  it("ANATOMY_SOURCE_SCAN_BYTES raises the budget beyond the 32 MB default", () => {
    const root = mkScratchRepo();
    mkdirSync(join(root, "src"), { recursive: true });
    // 50 × 200KB = ~10MB; the 32MB default already absorbs this. We're just
    // verifying the env var override path works for setting *higher* limits.
    for (let i = 0; i < 50; i++) {
      writeFileSync(join(root, "src", `f${i}.ts`), "Z".repeat(200_000));
    }
    writeFileSync(join(root, "package.json"), `{ "name": "x" }`);
    const doc = {
      structure: { entries: [{ path: "src", kind: "source" }] },
      substance: { key_dependencies: [{ name: "react" }] },
    };
    process.env.ANATOMY_SOURCE_SCAN_BYTES = "64M";
    try {
      const r = sourceCrossCheck(doc, root);
      const truncWarn = r.warnings.find(w => w.code === "source-cross-check-truncated");
      expect(truncWarn).toBeUndefined();
    } finally {
      delete process.env.ANATOMY_SOURCE_SCAN_BYTES;
    }
  });

  it("ANATOMY_SOURCE_SCAN_BYTES with a tiny budget truncates eagerly", () => {
    const root = mkScratchRepo();
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "a.ts"), "Z".repeat(50_000));
    writeFileSync(join(root, "src", "b.ts"), "Z".repeat(50_000));
    writeFileSync(join(root, "package.json"), `{ "name": "x" }`);
    const doc = {
      structure: { entries: [{ path: "src", kind: "source" }] },
      substance: { key_dependencies: [{ name: "react" }] },
    };
    process.env.ANATOMY_SOURCE_SCAN_BYTES = "60K";
    try {
      const r = sourceCrossCheck(doc, root);
      const truncWarn = r.warnings.find(w => w.code === "source-cross-check-truncated");
      expect(truncWarn).toBeDefined();
      // 60K cap means stops after the first file's ~50K + tiny package.json.
      expect(truncWarn!.message).toContain("61440 bytes");
    } finally {
      delete process.env.ANATOMY_SOURCE_SCAN_BYTES;
    }
  });
});

describe("sourceCrossCheck — Class 2 (literal cross-references)", () => {
  it("no warning when host-port literal in rule appears in source", () => {
    const root = mkScratchRepo();
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "ai.js"),
      `const CURSOR_PROXY = "http://localhost:60044/v1/chat";`);
    const doc = {
      structure: { entries: [{ path: "src", kind: "source" }] },
      rules: [{ rule: "AI proxy targets localhost:60044 — do not change." }],
    };
    const r = sourceCrossCheck(doc, root);
    expect(r.warnings).toEqual([]);
  });

  it("warns when host-port literal in rule is stale (cursorinline case)", () => {
    const root = mkScratchRepo();
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "ai.js"),
      `const CURSOR_PROXY = "http://localhost:60044/v1/chat";`);
    const doc = {
      structure: { entries: [{ path: "src", kind: "source" }] },
      rules: [{ rule: "AI proxy targets localhost:2022 — do not change." }],
    };
    const r = sourceCrossCheck(doc, root);
    expect(r.warnings.length).toBe(1);
    expect(r.warnings[0].code).toBe("literal-not-in-source");
    expect(r.warnings[0].pointer).toBe("/rules/0/rule");
    expect(r.warnings[0].actual).toBe("localhost:2022");
    expect(r.warnings[0].literalKind).toBe("host-port");
  });

  it("warns on stale scoped-package literal in claim text (Snipper case)", () => {
    const root = mkScratchRepo();
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "main.ts"), "// no codemirror anywhere");
    writeFileSync(join(root, "package.json"), `{ "name": "x" }`);
    const doc = {
      structure: { entries: [{ path: "src", kind: "source" }] },
      rules: [{ rule: "Use @codemirror/parser for syntax highlighting." }],
    };
    const r = sourceCrossCheck(doc, root);
    expect(r.warnings.length).toBe(1);
    expect(r.warnings[0].code).toBe("literal-not-in-source");
    expect(r.warnings[0].literalKind).toBe("scoped-package");
    expect(r.warnings[0].actual).toBe("@codemirror/parser");
  });

  it("no warning when source-path literal points at an existing file", () => {
    const root = mkScratchRepo();
    mkdirSync(join(root, "src", "main"), { recursive: true });
    writeFileSync(join(root, "src", "main", "index.ts"), "// real");
    const doc = {
      structure: { entries: [{ path: "src", kind: "source" }] },
      flows: [{ name: "boot", summary: "starts at src/main/index.ts" }],
    };
    const r = sourceCrossCheck(doc, root);
    expect(r.warnings).toEqual([]);
  });

  it("warns on missing source-path literal not present in haystack either", () => {
    const root = mkScratchRepo();
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "current.ts"), "// nothing about old.ts");
    const doc = {
      structure: { entries: [{ path: "src", kind: "source" }] },
      decisions: [{ topic: "legacy", reason: "see src/old.ts for history" }],
    };
    const r = sourceCrossCheck(doc, root);
    expect(r.warnings.length).toBe(1);
    expect(r.warnings[0].literalKind).toBe("source-path");
    expect(r.warnings[0].actual).toBe("src/old.ts");
    expect(r.warnings[0].pointer).toBe("/decisions/0/reason");
  });

  it("falls back to haystack search when source-path literal does not exist on disk but appears in code", () => {
    const root = mkScratchRepo();
    mkdirSync(join(root, "src"), { recursive: true });
    // src/old.ts file does NOT exist, but a comment references it.
    writeFileSync(join(root, "src", "current.ts"), "// migrated from src/old.ts to here");
    const doc = {
      structure: { entries: [{ path: "src", kind: "source" }] },
      decisions: [{ topic: "legacy", reason: "see src/old.ts for history" }],
    };
    const r = sourceCrossCheck(doc, root);
    expect(r.warnings).toEqual([]);
  });

  it("emits separate warnings for the same literal across two fields", () => {
    const root = mkScratchRepo();
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "index.ts"), "// nothing here");
    const doc = {
      structure: { entries: [{ path: "src", kind: "source" }] },
      rules: [
        { rule: "Use localhost:2022 for the proxy." },
        { rule: "blah", why: "Compatibility with localhost:2022 historic clients." },
      ],
    };
    const r = sourceCrossCheck(doc, root);
    const literalWarns = r.warnings.filter(w => w.code === "literal-not-in-source");
    expect(literalWarns.length).toBe(2);
    expect(literalWarns[0].pointer).toBe("/rules/0/rule");
    expect(literalWarns[1].pointer).toBe("/rules/1/why");
  });

  it("does not flag email addresses or bare @scope tokens", () => {
    const root = mkScratchRepo();
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "index.ts"), "// no relevant content");
    const doc = {
      structure: { entries: [{ path: "src", kind: "source" }] },
      rules: [{ rule: "Contact contact@example.com for issues; ping @alice for review." }],
    };
    const r = sourceCrossCheck(doc, root);
    expect(r.warnings.filter(w => w.code === "literal-not-in-source")).toEqual([]);
  });

  it("checks rules.rule, rules.why, flows.summary, decisions.topic, decisions.reason", () => {
    const root = mkScratchRepo();
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "index.ts"), "// none of these");
    const doc = {
      structure: { entries: [{ path: "src", kind: "source" }] },
      rules: [{ rule: "uses localhost:1111", why: "for localhost:2222 historical reasons" }],
      flows: [{ name: "f1", summary: "talks to localhost:3333" }],
      decisions: [{ topic: "talks to localhost:4444", reason: "decided long ago for localhost:5555" }],
    };
    const r = sourceCrossCheck(doc, root);
    const literals = r.warnings.filter(w => w.code === "literal-not-in-source").map(w => w.actual);
    expect(literals.sort()).toEqual([
      "localhost:1111", "localhost:2222", "localhost:3333", "localhost:4444", "localhost:5555",
    ]);
  });
});

import { validate } from "../src/index.js";

describe("validate() integration — source-cross-check fires", () => {
  it("fires unused-dependency-claim through the public validate() entry", async () => {
    const root = mkScratchRepo();
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "index.ts"), "// nothing references react");
    writeFileSync(join(root, "package.json"), `{ "name": "x" }`);
    // Build a minimal valid v0.8 .anatomy with key_dependencies referencing
    // an unused dep. Other fields kept minimal — we just need schema-valid
    // enough that earlier checks pass through.
    const toml = `anatomy_version = "0.8"
tagline = "scaffold"

[identity]
stack = "typescript"
form = "typescript-library"
domain = "test"
function = "test"
fingerprint = "${"a".repeat(20)}"

[[structure.entries]]
path = "src"
kind = "source"
purpose = "x"

[[substance.key_dependencies]]
name = "react"
why = "ui"

[generated]
at = 2026-05-09T00:00:00Z
by = "test"
model = "none"
schema = "https://anatomy.dev/spec/0.8/schema.json"
`;
    const result = await validate(toml, { repoRoot: root });
    // We expect the unused-dep warning regardless of whether other checks
    // (e.g., fingerprint) pass — the validator runs all checks.
    const sxc = result.warnings.filter(
      w => w.code === "unused-dependency-claim",
    );
    expect(sxc.length).toBe(1);
    expect(sxc[0].actual).toBe("react");
  });
});
