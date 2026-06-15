import { describe, it, expect } from "vitest";
import { recordTelemetry } from "../src/telemetry.js";

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
