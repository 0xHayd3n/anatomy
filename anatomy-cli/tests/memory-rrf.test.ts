import { describe, it, expect } from "vitest";
import { rrfFuse } from "../src/memory/rrf.js";

describe("rrfFuse", () => {
  it("sums 1/(k+rank) contributions across both lists (1-based ranks)", () => {
    // a: lexical rank 1, dense rank 2 → 1/61 + 1/62
    // b: lexical rank 2, dense rank 1 → 1/62 + 1/61  (ties a)
    const out = rrfFuse(["a", "b"], ["b", "a"]);
    expect(out.get("a")).toBeCloseTo(1 / 61 + 1 / 62, 10);
    expect(out.get("b")).toBeCloseTo(1 / 61 + 1 / 62, 10);
  });

  it("an id in only one list still contributes its single term", () => {
    const out = rrfFuse(["x"], ["y"]);
    expect(out.get("x")).toBeCloseTo(1 / 61, 10);
    expect(out.get("y")).toBeCloseTo(1 / 61, 10);
  });

  it("respects a custom k", () => {
    const out = rrfFuse(["x"], [], 9);
    expect(out.get("x")).toBeCloseTo(1 / 10, 10);
  });

  it("returns an empty map when both lists are empty", () => {
    expect(rrfFuse([], []).size).toBe(0);
  });

  it("deduplicates a repeated id within a list using its first (best) rank", () => {
    const out = rrfFuse(["x", "x"], []);
    expect(out.get("x")).toBeCloseTo(1 / 61, 10);
  });
});
