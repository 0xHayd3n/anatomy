import { describe, it, expect } from "vitest";
import { parseLLMOutput, _setProviderForTesting } from "../../src/verify-suggest/llm.js";

describe("parseLLMOutput", () => {
  it("parses a glob_exists inline table", () => {
    const out = parseLLMOutput(`{ kind = "glob_exists", path = "package.json" }`);
    expect(out).toEqual({ kind: "glob_exists", path: "package.json" });
  });

  it("parses an ast_pattern inline table with forbid_in", () => {
    const text = `{ kind = "ast_pattern", lang = "ts", pattern = "console.log($X)", forbid_in = "src/**/*.ts" }`;
    const out = parseLLMOutput(text);
    expect(out).toEqual({
      kind: "ast_pattern", lang: "ts", pattern: "console.log($X)", forbid_in: "src/**/*.ts",
    });
  });

  it("returns null on NO_VERIFIER_FEASIBLE", () => {
    expect(parseLLMOutput("NO_VERIFIER_FEASIBLE")).toBeNull();
    expect(parseLLMOutput("  NO_VERIFIER_FEASIBLE  ")).toBeNull();
  });

  it("returns null on malformed output (text fences)", () => {
    expect(parseLLMOutput("```toml\n{ kind = \"glob_exists\", path = \"x\" }\n```")).toBeNull();
  });

  it("returns null on prose responses", () => {
    expect(parseLLMOutput("I think you should use a glob_exists clause.")).toBeNull();
  });

  it("returns null on missing required fields", () => {
    expect(parseLLMOutput(`{ kind = "ast_pattern" }`)).toBeNull();
  });

  it("parses a semgrep inline table with expect_in", () => {
    const text = `{ kind = "semgrep", lang = "py", pattern = "print($X)", expect_in = "**/*.py" }`;
    expect(parseLLMOutput(text)).toEqual({
      kind: "semgrep", lang: "py", pattern: "print($X)", expect_in: "**/*.py",
    });
  });

  it("parses glob_exists with should_not = true", () => {
    const text = `{ kind = "glob_exists", path = "secrets.json", should_not = true }`;
    expect(parseLLMOutput(text)).toEqual({
      kind: "glob_exists", path: "secrets.json", should_not: true,
    });
  });

  it("returns null for ast_pattern missing both expect_in and forbid_in", () => {
    const text = `{ kind = "ast_pattern", lang = "ts", pattern = "console.log($X)" }`;
    expect(parseLLMOutput(text)).toBeNull();
  });
});

describe("suggestFromLLM — with mocked provider", () => {
  it("invokes the provider and parses its response", async () => {
    const { suggestFromLLM } = await import("../../src/verify-suggest/llm.js");
    _setProviderForTesting(async () => `{ kind = "glob_exists", path = "README.md" }`);
    const result = await suggestFromLLM("/tmp/repo", {
      rule: "must have README",
      why: "discoverability",
    }, { entries: [{ path: "docs", purpose: "docs", kind: "docs" }] });
    expect(result).toEqual({ kind: "glob_exists", path: "README.md" });
  });

  it("returns null when the provider emits NO_VERIFIER_FEASIBLE", async () => {
    const { suggestFromLLM } = await import("../../src/verify-suggest/llm.js");
    _setProviderForTesting(async () => "NO_VERIFIER_FEASIBLE");
    const result = await suggestFromLLM("/tmp/repo", {
      rule: "runtime invariant about ordering",
    }, undefined);
    expect(result).toBeNull();
  });

  it("returns null when no provider is configured", async () => {
    const { suggestFromLLM } = await import("../../src/verify-suggest/llm.js");
    _setProviderForTesting(null);
    const result = await suggestFromLLM("/tmp/repo", { rule: "x" }, undefined);
    expect(result).toBeNull();
  });

  it("returns null when the provider throws", async () => {
    const { suggestFromLLM } = await import("../../src/verify-suggest/llm.js");
    _setProviderForTesting(async () => { throw new Error("provider exploded"); });
    const result = await suggestFromLLM("/tmp/repo", { rule: "x" }, undefined);
    expect(result).toBeNull();
  });
});
