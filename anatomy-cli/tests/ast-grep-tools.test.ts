import { describe, it, expect } from "vitest";
import { recordTelemetry } from "../src/telemetry.js";
import { astGrepToolDefinitions, astGrepToolHandlers } from "../src/mcp/ast-grep-tools.js";

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
