import { describe, it, expect } from "vitest";
import { estimateTokens } from "../src/render/token-count.js";

describe("estimateTokens", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("returns approximately chars/3 for ASCII text", () => {
    const s = "a".repeat(300);
    const n = estimateTokens(s);
    expect(n).toBeGreaterThanOrEqual(99);
    expect(n).toBeLessThanOrEqual(110);
  });

  it("is monotonic — longer string never has fewer tokens", () => {
    expect(estimateTokens("hello world")).toBeGreaterThanOrEqual(estimateTokens("hello"));
  });
});
