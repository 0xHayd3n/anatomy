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
