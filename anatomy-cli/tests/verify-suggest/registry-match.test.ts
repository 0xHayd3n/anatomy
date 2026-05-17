import { describe, it, expect } from "vitest";
import { cosineSimilarity, topMatch } from "../../src/verify-suggest/registry/match.js";

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
  });
  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });
  it("returns -1 for opposite vectors", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });
  it("returns 0 when either vector has zero norm", () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

describe("topMatch", () => {
  const corpus = new Map<string, number[]>([
    ["rule-a", [1, 0, 0]],
    ["rule-b", [0, 1, 0]],
    ["rule-c", [0.9, 0.1, 0]],   // very close to rule-a
  ]);

  it("returns the highest-similarity id above the threshold", () => {
    const result = topMatch([1, 0, 0], corpus, 0.7);
    expect(result?.id).toBe("rule-a");
    expect(result?.similarity).toBeCloseTo(1);
  });

  it("returns null when no candidate clears the threshold", () => {
    const result = topMatch([0, 0, 1], corpus, 0.7);
    expect(result).toBeNull();
  });

  it("returns the highest-similarity id when multiple candidates clear the threshold", () => {
    // Query [0.5, 0.5, 0]: rule-a sim ≈ 0.707, rule-b sim ≈ 0.707, rule-c sim ≈ 0.781.
    // All three are above 0.7 — top-1 wins, which is rule-c.
    const result = topMatch([0.5, 0.5, 0], corpus, 0.7);
    expect(result?.id).toBe("rule-c");
  });
});
