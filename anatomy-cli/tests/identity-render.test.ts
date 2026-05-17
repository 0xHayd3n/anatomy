import { describe, it, expect } from "vitest";
import { pillarString } from "../src/render/identity.js";

describe("pillarString", () => {
  it("returns the string for v0.7 flat-pillar shape", () => {
    expect(pillarString("javascript")).toBe("javascript");
    expect(pillarString("monorepo")).toBe("monorepo");
  });

  it("returns the .id for v0.1-v0.6 nested-pillar shape", () => {
    expect(pillarString({ id: "javascript", hash: "abc12" })).toBe("javascript");
    expect(pillarString({ id: "cli-tool" })).toBe("cli-tool");
  });

  it("returns empty string for missing or malformed input", () => {
    expect(pillarString(undefined)).toBe("");
    expect(pillarString(null)).toBe("");
    expect(pillarString({})).toBe("");
    expect(pillarString({ hash: "abc" })).toBe(""); // no id
    expect(pillarString({ id: 42 })).toBe(""); // non-string id
    expect(pillarString(123)).toBe("");
  });

  it("does not stringify objects to '[object Object]' (the bug-was)", () => {
    // Pre-fix, hook.ts/show.ts did `${id.stack}` directly. For a v0.6 doc
    // where id.stack is { id: "javascript", hash: "..." }, that produced
    // the literal string "[object Object]" in user-facing output. This is
    // the regression guard.
    expect(pillarString({ id: "javascript", hash: "abc12" })).not.toBe("[object Object]");
  });
});
