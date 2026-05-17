import { describe, it, expect } from "vitest";
import { searchMemory, searchMemoryHybrid } from "../src/memory/search.js";
import type { MemoryEntry } from "../src/memory/io.js";

const NOW = new Date("2026-05-13T12:00:00Z");

function entry(o: Partial<MemoryEntry> & { id: string }): MemoryEntry {
  return { id: o.id, kind: o.kind ?? "gotcha", topic: o.topic ?? "topic",
    content: o.content ?? "content", at: o.at ?? "2026-05-13T12:00:00Z",
    by: "human:test",
    ...(o.tags !== undefined ? { tags: o.tags } : {}),
    ...(o.last_verified_at !== undefined ? { last_verified_at: o.last_verified_at } : {}) };
}

const corpus: MemoryEntry[] = [
  entry({ id: "aaa11111", topic: "windows shell", content: "spawnSync needs shell:true on Windows" }),
  entry({ id: "bbb22222", kind: "decision", topic: "render-toml", content: "hand-roll TOML", tags: ["v07"] }),
  entry({ id: "ccc33333", topic: "concurrency note", content: "async await race condition fix" }),
];

describe("searchMemoryHybrid — degraded mode (no vectors)", () => {
  it("is byte-identical to sync searchMemory output", () => {
    const opts = { query: "windows toml", now: NOW };
    const legacy = searchMemory(corpus, opts);
    const hybrid = searchMemoryHybrid(corpus, opts);
    expect(hybrid.map(r => ({ id: r.entry.id, b: r.bm25_score, d: r.decay_bucket, c: r.combined_score })))
      .toEqual(legacy.map(r => ({ id: r.entry.id, b: r.bm25_score, d: r.decay_bucket, c: r.combined_score })));
    expect(hybrid.every(r => r.dense_score === null && r.rrf_score === null)).toBe(true);
  });

  it("degrades to legacy when queryVec is null even if entryVecs exist", () => {
    const entryVecs = new Map([["aaa11111", [1, 0, 0]]]);
    const hybrid = searchMemoryHybrid(corpus, { query: "windows", now: NOW }, { queryVec: null, entryVecs });
    expect(hybrid.every(r => r.rrf_score === null)).toBe(true);
  });

  it("degrades to legacy when no filtered candidate has an embedding", () => {
    // entryVecs only covers aaa11111, but the kind filter selects bbb22222 only.
    // The computed dense list is empty → spec requires exact legacy output.
    const opts = { query: "render-toml", kind: "decision", now: NOW };
    const queryVec = [1, 0, 0];
    const entryVecs = new Map<string, number[]>([["aaa11111", [1, 0, 0]]]);
    const hybrid = searchMemoryHybrid(corpus, opts, { queryVec, entryVecs });
    const legacy = searchMemory(corpus, opts);
    expect(hybrid.map(r => ({ id: r.entry.id, b: r.bm25_score, d: r.decay_bucket, c: r.combined_score })))
      .toEqual(legacy.map(r => ({ id: r.entry.id, b: r.bm25_score, d: r.decay_bucket, c: r.combined_score })));
    expect(hybrid.every(r => r.rrf_score === null && r.dense_score === null)).toBe(true);
  });
});

describe("searchMemoryHybrid — RRF mode", () => {
  // Recall fixture: a lexically-divergent query. "parallelism deadlock" shares
  // NO token with ccc33333 ("async await race condition"), so pure BM25F
  // cannot surface it. A dense vector that aligns query↔ccc33333 must.
  it("surfaces a semantically-relevant entry that BM25F scores zero", () => {
    const lexicalOnly = searchMemory(corpus, { query: "parallelism deadlock", now: NOW });
    expect(lexicalOnly.find(r => r.entry.id === "ccc33333")).toBeUndefined();

    const queryVec = [1, 0, 0];
    const entryVecs = new Map<string, number[]>([
      ["aaa11111", [0, 1, 0]],
      ["bbb22222", [0, 0, 1]],
      ["ccc33333", [1, 0, 0]], // aligned with the query
    ]);
    const hybrid = searchMemoryHybrid(
      corpus, { query: "parallelism deadlock", now: NOW }, { queryVec, entryVecs },
    );
    expect(hybrid[0].entry.id).toBe("ccc33333");
    expect(hybrid[0].dense_score).toBeGreaterThan(0);
    expect(hybrid[0].rrf_score).toBeGreaterThan(0);
  });

  it("decay still multiplies the fused score (combined = rrf × decay)", () => {
    const queryVec = [1, 0, 0];
    const entryVecs = new Map<string, number[]>([["aaa11111", [1, 0, 0]]]);
    const hybrid = searchMemoryHybrid(
      corpus, { query: "windows", now: NOW }, { queryVec, entryVecs },
    );
    const top = hybrid.find(r => r.entry.id === "aaa11111")!;
    expect(top.rrf_score).not.toBeNull();
    expect(top.combined_score).toBeCloseTo((top.rrf_score as number) * 0.7, 10);
  });

  it("excludes an entry absent from BOTH lists", () => {
    const queryVec = [1, 0, 0];
    const entryVecs = new Map<string, number[]>([["aaa11111", [1, 0, 0]]]);
    // Query 'windows' lexically hits only aaa11111; dense list only aaa11111.
    const hybrid = searchMemoryHybrid(
      corpus, { query: "windows", now: NOW }, { queryVec, entryVecs },
    );
    expect(hybrid.map(r => r.entry.id)).toEqual(["aaa11111"]);
  });

  it("empty query uses the unchanged decay×recency fallback (no dense arm)", () => {
    const queryVec = [1, 0, 0];
    const entryVecs = new Map<string, number[]>([["aaa11111", [1, 0, 0]]]);
    const hybrid = searchMemoryHybrid(corpus, { query: "", now: NOW }, { queryVec, entryVecs });
    const legacy = searchMemory(corpus, { query: "", now: NOW });
    expect(hybrid.map(r => r.entry.id)).toEqual(legacy.map(r => r.entry.id));
    expect(hybrid.every(r => r.rrf_score === null)).toBe(true);
  });
});
