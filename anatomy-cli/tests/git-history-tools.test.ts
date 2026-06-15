import { describe, it, expect } from "vitest";
import { recordTelemetry } from "../src/telemetry.js";
import { gitHistoryToolDefinitions, gitHistoryToolHandlers } from "../src/mcp/git-history-tools.js";

describe("git_history_call telemetry shape", () => {
  it("accepts a git_history_call record", () => {
    expect(() =>
      recordTelemetry({
        kind: "git_history_call",
        ts: new Date().toISOString(),
        tool: "git_blame",
        duration_ms: 47,
        truncated: false,
        outcome: "ok",
      })
    ).not.toThrow();
  });
});

describe("git-history-tools scaffold", () => {
  it("exports three tool definitions: git_blame, git_log_search, git_show", () => {
    expect(gitHistoryToolDefinitions).toHaveLength(3);
    const names = gitHistoryToolDefinitions.map((d) => d.name).sort();
    expect(names).toEqual(["git_blame", "git_log_search", "git_show"]);
    for (const def of gitHistoryToolDefinitions) {
      expect(typeof def.description).toBe("string");
      expect(def.inputSchema).toBeDefined();
    }
  });

  it("git_blame requires file_path", () => {
    const def = gitHistoryToolDefinitions.find((d) => d.name === "git_blame")!;
    const schema = def.inputSchema as { required?: string[]; properties: Record<string, unknown> };
    expect(schema.required).toEqual(["file_path"]);
    expect(Object.keys(schema.properties).sort()).toEqual(["file_path", "follow", "lines"]);
  });

  it("git_log_search requires kind", () => {
    const def = gitHistoryToolDefinitions.find((d) => d.name === "git_log_search")!;
    const schema = def.inputSchema as { required?: string[]; properties: Record<string, unknown> };
    expect(schema.required).toEqual(["kind"]);
    expect(Object.keys(schema.properties).sort()).toEqual(
      ["author", "kind", "limit", "query", "since", "until"],
    );
  });

  it("git_show requires commit", () => {
    const def = gitHistoryToolDefinitions.find((d) => d.name === "git_show")!;
    const schema = def.inputSchema as { required?: string[]; properties: Record<string, unknown> };
    expect(schema.required).toEqual(["commit"]);
    expect(Object.keys(schema.properties).sort()).toEqual(["commit", "with_diff"]);
  });

  it("exports handlers under matching names", () => {
    expect(gitHistoryToolHandlers).toHaveProperty("git_blame");
    expect(gitHistoryToolHandlers).toHaveProperty("git_log_search");
    expect(gitHistoryToolHandlers).toHaveProperty("git_show");
    expect(typeof gitHistoryToolHandlers.git_blame).toBe("function");
    expect(typeof gitHistoryToolHandlers.git_log_search).toBe("function");
    expect(typeof gitHistoryToolHandlers.git_show).toBe("function");
  });
});
