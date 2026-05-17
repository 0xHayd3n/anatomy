import { describe, it, expect } from "vitest";
import { searchMemory } from "../src/memory/search.js";
import type { MemoryEntry } from "../src/memory/io.js";

const NOW = new Date("2026-05-13T12:00:00Z");
const FIVE_DAYS_AGO = new Date(NOW.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString();
const ONE_YEAR_AGO = new Date(NOW.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString();

function entry(overrides: Partial<MemoryEntry> & { id: string }): MemoryEntry {
  return {
    id: overrides.id,
    kind: overrides.kind ?? "gotcha",
    topic: overrides.topic ?? "topic",
    content: overrides.content ?? "content",
    at: overrides.at ?? "2026-05-13T12:00:00Z",
    by: overrides.by ?? "human:test",
    ...(overrides.tags !== undefined ? { tags: overrides.tags } : {}),
    ...(overrides.refs !== undefined ? { refs: overrides.refs } : {}),
    ...(overrides.last_verified_at !== undefined ? { last_verified_at: overrides.last_verified_at } : {}),
    ...(overrides.superseded_by !== undefined ? { superseded_by: overrides.superseded_by } : {}),
    ...(overrides.deprecated_at !== undefined ? { deprecated_at: overrides.deprecated_at } : {}),
  };
}

describe("searchMemory", () => {
  const corpus: MemoryEntry[] = [
    entry({ id: "aaa11111", topic: "windows shell", content: "spawnSync needs shell:true on Windows" }),
    entry({ id: "bbb22222", kind: "decision", topic: "render-toml", content: "hand-roll TOML", tags: ["v07"] }),
    entry({ id: "ccc33333", topic: "deprecated entry", deprecated_at: NOW.toISOString() }),
    entry({ id: "ddd44444", topic: "superseded entry", superseded_by: "eee55555" }),
  ];

  it("returns entries matching the query, ranked by relevance × decay", () => {
    const out = searchMemory(corpus, { query: "windows", now: NOW });
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out[0].entry.id).toBe("aaa11111");
    expect(out[0].bm25_score).toBeGreaterThan(0);
    expect(out[0].decay_bucket).toBe("untouched");
    expect(out[0].combined_score).toBeCloseTo(out[0].bm25_score * 0.7, 5);
  });

  it("excludes superseded and deprecated entries by default", () => {
    const out = searchMemory(corpus, { query: "entry", now: NOW });
    const ids = out.map(r => r.entry.id);
    expect(ids).not.toContain("ccc33333");
    expect(ids).not.toContain("ddd44444");
  });

  it("includes superseded and deprecated when includeSuperseded is set", () => {
    const out = searchMemory(corpus, { query: "entry", includeSuperseded: true, now: NOW });
    const ids = out.map(r => r.entry.id);
    expect(ids).toContain("ccc33333");
    expect(ids).toContain("ddd44444");
  });

  it("filters by kind before scoring", () => {
    const out = searchMemory(corpus, { kind: "decision", now: NOW });
    expect(out.every(r => r.entry.kind === "decision")).toBe(true);
  });

  it("filters by tag before scoring", () => {
    const out = searchMemory(corpus, { tag: "v07", now: NOW });
    expect(out.length).toBe(1);
    expect(out[0].entry.id).toBe("bbb22222");
  });

  it("OR-semantics: returns entries matching any token", () => {
    // 'windows' is only in aaa11111; 'toml' is only in bbb22222.
    // BM25 OR-semantics: both entries score > 0 and both surface.
    const out = searchMemory(corpus, { query: "windows toml", now: NOW });
    const ids = out.map(r => r.entry.id);
    expect(ids).toContain("aaa11111");
    expect(ids).toContain("bbb22222");
  });

  it("excludes entries with bm25_score == 0 (no token matches)", () => {
    const out = searchMemory(corpus, { query: "zzz unknown words", now: NOW });
    expect(out.length).toBe(0);
  });

  it("relevance can beat decay: high-relevance stale outranks low-relevance fresh", () => {
    const entries: MemoryEntry[] = [
      // Stale entry, but query matches in topic (high BM25)
      entry({ id: "stale1", topic: "tpm preflight gate", content: "x", last_verified_at: ONE_YEAR_AGO }),
      // Fresh entry, but only a weak content match (low BM25)
      entry({ id: "fresh1", topic: "unrelated topic", content: "tpm appears once", last_verified_at: FIVE_DAYS_AGO }),
    ];
    const out = searchMemory(entries, { query: "tpm preflight", now: NOW });
    expect(out[0].entry.id).toBe("stale1");
  });

  it("empty query returns entries ranked by decay × recency (graceful fallback)", () => {
    const entries: MemoryEntry[] = [
      entry({ id: "old1", at: "2024-01-01T00:00:00Z" }),
      entry({ id: "new1", at: "2026-05-01T00:00:00Z" }),
    ];
    const out = searchMemory(entries, { query: "", now: NOW });
    expect(out.length).toBe(2);
    expect(out[0].entry.id).toBe("new1");
  });

  it("undefined query is treated as empty (fallback)", () => {
    const entries: MemoryEntry[] = [entry({ id: "x" })];
    const out = searchMemory(entries, { now: NOW });
    expect(out.length).toBe(1);
  });

  it("honors limit (default 25, override applied)", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      entry({ id: `id${i.toString().padStart(5, "0")}`, content: `match ${i}` }),
    );
    expect(searchMemory(many, { query: "match", now: NOW }).length).toBe(25);
    expect(searchMemory(many, { query: "match", limit: 5, now: NOW }).length).toBe(5);
  });

  it("tiebreaker: equal combined_score sorts by entry.at DESC", () => {
    const entries: MemoryEntry[] = [
      entry({ id: "older", topic: "match", at: "2026-05-01T00:00:00Z" }),
      entry({ id: "newer", topic: "match", at: "2026-05-13T00:00:00Z" }),
    ];
    const out = searchMemory(entries, { query: "match", now: NOW });
    expect(out[0].entry.id).toBe("newer");
  });

  it("returns empty array on empty corpus", () => {
    expect(searchMemory([], { query: "anything", now: NOW })).toEqual([]);
  });

  it("filters by topic before scoring (exact match)", () => {
    const out = searchMemory(corpus, { topic: "windows shell", now: NOW });
    expect(out.length).toBe(1);
    expect(out[0].entry.id).toBe("aaa11111");
  });

  it("empty-query fallback handles malformed at timestamp gracefully", () => {
    const entries: MemoryEntry[] = [
      entry({ id: "bad1", at: "not-a-date" }),
      entry({ id: "good1", at: "2026-05-01T00:00:00Z" }),
    ];
    const out = searchMemory(entries, { query: "", now: NOW });
    expect(out.length).toBe(2);
    // bad1's recency = 0, so good1 ranks first.
    expect(out[0].entry.id).toBe("good1");
  });
});
