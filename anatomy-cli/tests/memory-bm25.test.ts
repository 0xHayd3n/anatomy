import { describe, it, expect } from "vitest";
import { tokenize, computeIdf, bm25fScore, FIELD_WEIGHTS, BM25_K1, BM25_B } from "../src/memory/bm25.js";
import type { TokenizedEntry } from "../src/memory/bm25.js";

describe("tokenize", () => {
  it("lowercases and splits on whitespace", () => {
    expect(tokenize("Hello World")).toEqual(["hello", "world"]);
  });

  it("splits on punctuation that is not an identifier character", () => {
    expect(tokenize("a, b; c! d? (e)")).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("preserves slashes in paths", () => {
    expect(tokenize("src/render/agents-md.ts")).toEqual(["src/render/agents-md.ts"]);
  });

  it("preserves @-scoped package identifiers", () => {
    expect(tokenize("uses @anatomytool/cli here")).toEqual(["uses", "@anatomytool/cli", "here"]);
  });

  it("preserves underscores and hyphens", () => {
    expect(tokenize("anatomy_memory_search and key-dependencies"))
      .toEqual(["anatomy_memory_search", "and", "key-dependencies"]);
  });

  it("preserves dots (acceptable: trailing-dot tokens stay as-is)", () => {
    expect(tokenize("end.")).toEqual(["end."]);
  });

  it("returns empty array on empty / whitespace input", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("   \t  \n ")).toEqual([]);
  });

  it("returns empty array on punctuation-only input", () => {
    expect(tokenize(",;:!?(){}[]<>'\"`\\")).toEqual([]);
  });

  it("collapses multiple whitespace characters", () => {
    expect(tokenize("a    b\tc\nd")).toEqual(["a", "b", "c", "d"]);
  });
});

describe("computeIdf", () => {
  // Tiny corpus: 3 entries, each with topic/content/tags as token lists.
  const corpus = [
    { topic: ["alpha"], content: ["bravo", "common"], tags: ["x"] },
    { topic: ["common"], content: ["delta", "common"], tags: [] },
    { topic: ["echo"], content: ["common"], tags: ["common"] },
  ];

  it("returns an IDF value for each unique query token", () => {
    const idf = computeIdf(["alpha", "bravo"], corpus);
    expect(idf.size).toBe(2);
    expect(idf.has("alpha")).toBe(true);
    expect(idf.has("bravo")).toBe(true);
  });

  it("dedupes repeated query tokens", () => {
    const idf = computeIdf(["alpha", "alpha", "bravo"], corpus);
    expect(idf.size).toBe(2);
  });

  it("rewards rare terms with higher IDF than common terms", () => {
    const idf = computeIdf(["alpha", "common"], corpus);
    // alpha: 1/3 entries → high IDF; common: 3/3 entries → low IDF
    expect(idf.get("alpha")!).toBeGreaterThan(idf.get("common")!);
  });

  it("counts a token as one match per entry even if it appears in multiple fields", () => {
    // "common" appears in topic of entry-1, content of entry-0, content+tags of entry-2.
    // Document frequency = 3 (all entries contain it somewhere), not 4.
    const idf = computeIdf(["common"], corpus);
    // Smoothed BM25 IDF: log((N - df + 0.5) / (df + 0.5) + 1) with N=3, df=3
    // = log((0.5) / (3.5) + 1) ≈ log(1.143) ≈ 0.134
    expect(idf.get("common")!).toBeCloseTo(Math.log(0.5 / 3.5 + 1), 5);
  });

  it("returns a positive IDF for a query token that appears nowhere", () => {
    // df = 0; smoothed IDF = log((3 + 0.5) / 0.5 + 1) = log(8) ≈ 2.079
    const idf = computeIdf(["zzz"], corpus);
    expect(idf.get("zzz")!).toBeCloseTo(Math.log(3.5 / 0.5 + 1), 5);
  });

  it("returns an empty map for empty query", () => {
    expect(computeIdf([], corpus).size).toBe(0);
  });

  it("returns an empty map for empty corpus", () => {
    expect(computeIdf(["alpha"], []).size).toBe(0);
  });
});

describe("bm25fScore", () => {
  const avgLens = { topic: 2, content: 4, tags: 1 };

  it("returns 0 when no query token matches anywhere", () => {
    const entry: TokenizedEntry = { topic: ["alpha"], content: ["bravo"], tags: ["x"] };
    const idf = new Map([["zzz", 1.5]]);
    expect(bm25fScore(["zzz"], entry, avgLens, idf)).toBe(0);
  });

  it("returns 0 for empty query", () => {
    const entry: TokenizedEntry = { topic: ["alpha"], content: ["bravo"], tags: [] };
    const idf = new Map<string, number>();
    expect(bm25fScore([], entry, avgLens, idf)).toBe(0);
  });

  it("weights topic match higher than content match (ratio ≈ FIELD_WEIGHTS.topic / FIELD_WEIGHTS.content)", () => {
    // Build two entries with identical TF and field lengths, but the matching
    // token lives in different fields. Their score ratio should equal the
    // field-weight ratio (3:1).
    const entryTopic: TokenizedEntry = { topic: ["alpha", "x"], content: ["a", "b", "c", "d"], tags: ["t"] };
    const entryContent: TokenizedEntry = { topic: ["a", "b"], content: ["alpha", "x", "y", "z"], tags: ["t"] };
    const idf = new Map([["alpha", 1.0]]);
    const scoreTopic = bm25fScore(["alpha"], entryTopic, avgLens, idf);
    const scoreContent = bm25fScore(["alpha"], entryContent, avgLens, idf);
    expect(scoreTopic / scoreContent).toBeCloseTo(FIELD_WEIGHTS.topic / FIELD_WEIGHTS.content, 5);
  });

  it("weights tags match higher than content match", () => {
    const entryTags: TokenizedEntry = { topic: ["x", "y"], content: ["a", "b", "c", "d"], tags: ["alpha"] };
    const entryContent: TokenizedEntry = { topic: ["x", "y"], content: ["alpha", "b", "c", "d"], tags: ["t"] };
    const idf = new Map([["alpha", 1.0]]);
    const scoreTags = bm25fScore(["alpha"], entryTags, avgLens, idf);
    const scoreContent = bm25fScore(["alpha"], entryContent, avgLens, idf);
    // Tags (weight 2.0) > content (weight 1.0); ratio depends on length normalization
    // but should be strictly greater.
    expect(scoreTags).toBeGreaterThan(scoreContent);
  });

  it("rewards multiple matching tokens over one match", () => {
    const entry: TokenizedEntry = { topic: ["alpha", "bravo"], content: ["c", "d"], tags: [] };
    const idf = new Map([["alpha", 1.0], ["bravo", 1.0]]);
    const scoreOne = bm25fScore(["alpha"], entry, avgLens, idf);
    const scoreTwo = bm25fScore(["alpha", "bravo"], entry, avgLens, idf);
    expect(scoreTwo).toBeGreaterThan(scoreOne);
  });

  it("scales score by IDF (rare term contributes more)", () => {
    const entry: TokenizedEntry = { topic: ["alpha", "common"], content: [], tags: [] };
    const idfRare = new Map([["alpha", 2.0]]);
    const idfCommon = new Map([["common", 0.5]]);
    const scoreRare = bm25fScore(["alpha"], entry, avgLens, idfRare);
    const scoreCommon = bm25fScore(["common"], entry, avgLens, idfCommon);
    expect(scoreRare / scoreCommon).toBeCloseTo(2.0 / 0.5, 5);
  });

  it("exposes named constants for k1, b, and field weights", () => {
    expect(BM25_K1).toBe(1.2);
    expect(BM25_B).toBe(0.75);
    expect(FIELD_WEIGHTS).toEqual({ topic: 3.0, tags: 2.0, content: 1.0 });
  });

  it("deduplicates duplicate query tokens (matches computeIdf dedup behavior)", () => {
    const entry: TokenizedEntry = { topic: ["alpha"], content: ["bravo"], tags: [] };
    const idf = new Map([["alpha", 1.0]]);
    const scoreOnce = bm25fScore(["alpha"], entry, avgLens, idf);
    const scoreTwice = bm25fScore(["alpha", "alpha"], entry, avgLens, idf);
    expect(scoreTwice).toBeCloseTo(scoreOnce, 10);
  });
});
