import { describe, it, expect } from "vitest";
import { resolveModel, pass2ModelId } from "../src/pass2/model.js";
import { claudeArgs } from "../src/pass2/providers/claude-cli.js";
import { aiImplied } from "../src/commands/generate.js";

describe("resolveModel", () => {
  it("flag wins over env", () => {
    expect(resolveModel("haiku", "sonnet")).toBe("haiku");
  });
  it("env used when no flag", () => {
    expect(resolveModel(undefined, "sonnet")).toBe("sonnet");
  });
  it("empty string is treated as unset", () => {
    expect(resolveModel("", "")).toBeUndefined();
    expect(resolveModel("  ", undefined)).toBeUndefined();
  });
  it("both unset -> undefined (provider default)", () => {
    expect(resolveModel(undefined, undefined)).toBeUndefined();
  });
});

describe("pass2ModelId", () => {
  it("legacy value preserved when no model override (claude-cli)", () => {
    expect(pass2ModelId("claude-cli", undefined)).toBe("claude-code");
  });
  it("non-claude provider name preserved when no override", () => {
    expect(pass2ModelId("anthropic-http", undefined)).toBe("anthropic-http");
  });
  it("encodes provider:model when overridden", () => {
    expect(pass2ModelId("claude-cli", "claude-haiku-4-5")).toBe("claude-cli:claude-haiku-4-5");
  });
});

describe("claudeArgs", () => {
  it("is exactly ['--print'] when no model (byte-identical to today)", () => {
    expect(claudeArgs(undefined)).toEqual(["--print"]);
  });
  it("appends --model <id> when set", () => {
    expect(claudeArgs("claude-haiku-4-5")).toEqual(["--print", "--model", "claude-haiku-4-5"]);
  });
});

describe("aiImplied — --model implies --ai", () => {
  it("false when nothing implies AI", () => {
    expect(aiImplied({})).toBe(false);
  });
  it("true when --model is set (the new behavior)", () => {
    expect(aiImplied({ model: "some-model" })).toBe(true);
  });
  it("preserves the existing implications", () => {
    expect(aiImplied({ ai: true })).toBe(true);
    expect(aiImplied({ printPrompt: true })).toBe(true);
    expect(aiImplied({ provider: "anthropic-http" })).toBe(true);
    expect(aiImplied({ rich: true })).toBe(true);
  });
});
