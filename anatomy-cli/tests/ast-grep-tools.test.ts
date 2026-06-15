import { describe, it, expect } from "vitest";
import { recordTelemetry } from "../src/telemetry.js";
import { astGrepToolDefinitions, astGrepToolHandlers, _internal } from "../src/mcp/ast-grep-tools.js";

describe("ast_grep_call telemetry shape", () => {
  it("accepts an ast_grep_call record", () => {
    expect(() =>
      recordTelemetry({
        kind: "ast_grep_call",
        ts: new Date().toISOString(),
        tool: "ast_grep_search",
        lang: "ts",
        files_scanned: 12,
        matches: 3,
        truncated: false,
        duration_ms: 47,
        outcome: "ok",
      })
    ).not.toThrow();
  });
});

describe("ast-grep-tools scaffold", () => {
  it("exports a single ast_grep_search tool definition", () => {
    expect(astGrepToolDefinitions).toHaveLength(1);
    expect(astGrepToolDefinitions[0].name).toBe("ast_grep_search");
    expect(typeof astGrepToolDefinitions[0].description).toBe("string");
    const schema = astGrepToolDefinitions[0].inputSchema as {
      type: string;
      required?: string[];
      properties: Record<string, { type: string }>;
    };
    expect(schema.type).toBe("object");
    expect(schema.required).toEqual(["pattern"]);
    expect(Object.keys(schema.properties).sort()).toEqual(
      ["file_path", "lang", "max_results", "pattern"]
    );
  });

  it("exports a handler under the same name", () => {
    expect(astGrepToolHandlers).toHaveProperty("ast_grep_search");
    expect(typeof astGrepToolHandlers.ast_grep_search).toBe("function");
  });
});

describe("inferLang", () => {
  it("returns the lang for a known extension", () => {
    expect(_internal.inferLang("src/foo.ts")).toBe("ts");
    expect(_internal.inferLang("src/foo.tsx")).toBe("tsx");
    expect(_internal.inferLang("src/foo.js")).toBe("js");
    expect(_internal.inferLang("src/foo.mjs")).toBe("js");
    expect(_internal.inferLang("src/foo.cjs")).toBe("js");
    expect(_internal.inferLang("src/foo.jsx")).toBe("jsx");
    expect(_internal.inferLang("src/foo.py")).toBe("py");
    expect(_internal.inferLang("src/foo.rs")).toBe("rs");
    expect(_internal.inferLang("src/foo.go")).toBe("go");
    expect(_internal.inferLang("src/foo.java")).toBe("java");
    expect(_internal.inferLang("src/foo.cpp")).toBe("cpp");
    expect(_internal.inferLang("src/foo.hpp")).toBe("cpp");
  });

  it("returns null for an unknown extension", () => {
    expect(_internal.inferLang("src/foo.xyz")).toBeNull();
    expect(_internal.inferLang("README")).toBeNull();
    expect(_internal.inferLang("")).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(_internal.inferLang(undefined)).toBeNull();
  });

  it("handles globs by extracting the trailing extension", () => {
    expect(_internal.inferLang("src/**/*.ts")).toBe("ts");
    expect(_internal.inferLang("src/**/*.{ts,tsx}")).toBe("ts");
  });
});

describe("defaultExtensionsFor", () => {
  it("returns the canonical extension list for a known lang", () => {
    expect(_internal.defaultExtensionsFor("ts")).toEqual([".ts"]);
    expect(_internal.defaultExtensionsFor("js")).toEqual([".js", ".mjs", ".cjs"]);
    expect(_internal.defaultExtensionsFor("cpp")).toEqual([".cpp", ".cc", ".cxx", ".hpp", ".hh"]);
  });

  it("returns null for an unknown lang", () => {
    expect(_internal.defaultExtensionsFor("erlang")).toBeNull();
  });
});

import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep as PATH_SEP } from "node:path";

const toNative = (p: string): string => p.replace(/\//g, PATH_SEP);

describe("walkFiles", () => {
  function setupRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), "astgrep-walk-"));
    writeFileSync(join(dir, "a.ts"), "// a");
    writeFileSync(join(dir, "b.ts"), "// b");
    writeFileSync(join(dir, "c.py"), "# c");
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "d.ts"), "// d");
    // Default-excluded directories — must NOT appear in the walk.
    mkdirSync(join(dir, "node_modules"));
    writeFileSync(join(dir, "node_modules", "should-skip.ts"), "// skip");
    mkdirSync(join(dir, "dist"));
    writeFileSync(join(dir, "dist", "also-skip.ts"), "// skip");
    return dir;
  }

  it("walks default extensions for a lang when no glob is given", async () => {
    const dir = setupRepo();
    const found: string[] = [];
    for await (const f of _internal.walkFiles({ cwd: dir, lang: "ts", maxFiles: 100 })) {
      found.push(f);
    }
    // Should include a.ts, b.ts, src/d.ts. NOT node_modules/should-skip.ts or dist/also-skip.ts.
    expect(found.sort()).toEqual(["a.ts", "b.ts", "src/d.ts"].map(toNative));
  });

  it("walks an explicit glob when provided", async () => {
    const dir = setupRepo();
    const found: string[] = [];
    for await (const f of _internal.walkFiles({ cwd: dir, lang: "ts", globPattern: "src/**/*.ts", maxFiles: 100 })) {
      found.push(f);
    }
    expect(found).toEqual([toNative("src/d.ts")]);
  });

  it("respects the default-exclude list even when an explicit glob would match", async () => {
    const dir = setupRepo();
    const found: string[] = [];
    for await (const f of _internal.walkFiles({ cwd: dir, lang: "ts", globPattern: "**/*.ts", maxFiles: 100 })) {
      found.push(f);
    }
    // Should not include anything under node_modules or dist.
    expect(found.find((f) => f.includes("node_modules"))).toBeUndefined();
    expect(found.find((f) => f.includes("dist"))).toBeUndefined();
  });

  it("caps the walk at maxFiles", async () => {
    const dir = mkdtempSync(join(tmpdir(), "astgrep-cap-"));
    for (let i = 0; i < 10; i++) writeFileSync(join(dir, `f${i}.ts`), "// x");
    const found: string[] = [];
    for await (const f of _internal.walkFiles({ cwd: dir, lang: "ts", maxFiles: 3 })) {
      found.push(f);
    }
    expect(found).toHaveLength(3);
  });
});

import { astGrepToolHandlers as handlers } from "../src/mcp/ast-grep-tools.js";

describe("ast_grep_search — end-to-end", () => {
  function setupTsRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), "astgrep-e2e-"));
    writeFileSync(
      join(dir, "a.ts"),
      "console.log('first');\nconsole.log('second');\nconsole.error('third');\n",
    );
    writeFileSync(join(dir, "b.ts"), "function f() { return 42; }\n");
    return dir;
  }

  it("finds matches with captures and returns the inferred language", async () => {
    const dir = setupTsRepo();
    const oldCwd = process.cwd();
    try {
      process.chdir(dir);
      const r = await handlers.ast_grep_search({
        pattern: "console.log($X)",
        file_path: "*.ts",
      });
      const data = JSON.parse(r.content[0].text);
      expect(r.isError).toBeFalsy();
      expect(data.language).toBe("ts");
      expect(data.matches).toHaveLength(2);
      expect(data.matches[0]).toMatchObject({
        file: expect.stringMatching(/a\.ts$/),
        line: expect.any(Number),
        column: expect.any(Number),
        text: expect.stringContaining("console.log"),
      });
      expect(data.matches[0].captures).toMatchObject({ X: "'first'" });
      expect(data.files_scanned).toBe(2);
      expect(data.truncated).toBe(false);
    } finally {
      process.chdir(oldCwd);
    }
  });

  it("returns empty matches and no error when nothing matches", async () => {
    const dir = setupTsRepo();
    const oldCwd = process.cwd();
    try {
      process.chdir(dir);
      const r = await handlers.ast_grep_search({
        pattern: "unrelated_function_call_that_doesnt_exist($X)",
        file_path: "*.ts",
      });
      const data = JSON.parse(r.content[0].text);
      expect(r.isError).toBeFalsy();
      expect(data.matches).toEqual([]);
      expect(data.files_scanned).toBeGreaterThan(0);
    } finally {
      process.chdir(oldCwd);
    }
  });

  it("respects max_results and sets truncated", async () => {
    const dir = mkdtempSync(join(tmpdir(), "astgrep-trunc-"));
    let body = "";
    for (let i = 0; i < 10; i++) body += `console.log(${i});\n`;
    writeFileSync(join(dir, "many.ts"), body);
    const oldCwd = process.cwd();
    try {
      process.chdir(dir);
      const r = await handlers.ast_grep_search({
        pattern: "console.log($X)",
        file_path: "*.ts",
        max_results: 3,
      });
      const data = JSON.parse(r.content[0].text);
      expect(data.matches).toHaveLength(3);
      expect(data.truncated).toBe(true);
    } finally {
      process.chdir(oldCwd);
    }
  });
});

describe("ast_grep_search — error paths", () => {
  it("returns missing_pattern when pattern is missing", async () => {
    const r = await handlers.ast_grep_search({});
    expect(r.isError).toBe(true);
    const data = JSON.parse(r.content[0].text);
    expect(data.error).toBe("missing_pattern");
  });

  it("returns missing_pattern when pattern is an empty string", async () => {
    const r = await handlers.ast_grep_search({ pattern: "" });
    expect(r.isError).toBe(true);
    const data = JSON.parse(r.content[0].text);
    expect(data.error).toBe("missing_pattern");
  });

  it("returns missing_lang_or_file_path when neither is set", async () => {
    const r = await handlers.ast_grep_search({ pattern: "$X" });
    expect(r.isError).toBe(true);
    const data = JSON.parse(r.content[0].text);
    expect(data.error).toBe("missing_lang_or_file_path");
    expect(data.supported_langs).toEqual(expect.arrayContaining(["ts", "py", "rs"]));
  });

  it("returns missing_lang_or_file_path when file_path has unknown extension", async () => {
    const r = await handlers.ast_grep_search({
      pattern: "$X",
      file_path: "src/**/*.xyz",
    });
    expect(r.isError).toBe(true);
    const data = JSON.parse(r.content[0].text);
    expect(data.error).toBe("missing_lang_or_file_path");
  });

  it("returns pattern_parse_failed for an unparseable pattern", async () => {
    const dir = mkdtempSync(join(tmpdir(), "astgrep-bad-"));
    writeFileSync(join(dir, "a.ts"), "const x = 1;\n");
    const oldCwd = process.cwd();
    try {
      process.chdir(dir);
      // Whitespace-only pattern → napi rejects with "No AST root is detected".
      // Non-empty (so it passes the missing_pattern guard) but unparseable.
      const r = await handlers.ast_grep_search({
        pattern: "   ",
        file_path: "*.ts",
      });
      const data = JSON.parse(r.content[0].text);
      expect(r.isError).toBe(true);
      expect(data.error).toBe("pattern_parse_failed");
      expect(data.language).toBe("ts");
      expect(typeof data.detail).toBe("string");
    } finally {
      process.chdir(oldCwd);
    }
  });
});
