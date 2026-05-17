import { describe, it, expect } from "vitest";
import { renderMemoryProse } from "../src/render/memory-prose.js";
import type { MemoryDoc } from "../src/memory/io.js";

function entry(over: Partial<{ id: string; kind: string; topic: string; content: string; at: string; by: string; superseded_by: string; deprecated_at: string }>): any {
  return {
    id: over.id ?? "aaaaaaaa",
    kind: over.kind ?? "gotcha",
    topic: over.topic ?? "t",
    content: over.content ?? "c",
    at: over.at ?? "2026-05-08T00:00:00Z",
    by: over.by ?? "human:test",
    ...(over.superseded_by ? { superseded_by: over.superseded_by } : {}),
    ...(over.deprecated_at ? { deprecated_at: over.deprecated_at } : {}),
  };
}

const baseDoc = (entries: any[]): MemoryDoc => ({
  anatomy_memory_version: "0.1",
  repo_fingerprint: "abcdefghijklmnopqrst",
  entries,
});

describe("renderMemoryProse", () => {
  it("returns empty string when no entries", () => {
    expect(renderMemoryProse(baseDoc([]))).toBe("");
  });

  it("renders header with stats", () => {
    const doc = baseDoc([
      entry({ kind: "convention", topic: "c1" }),
      entry({ kind: "gotcha", topic: "g1", id: "bbbbbbbb" }),
    ]);
    const out = renderMemoryProse(doc);
    expect(out).toContain("## Memory");
    expect(out).toMatch(/2 entries/);
    expect(out).toMatch(/1 convention/);
    expect(out).toMatch(/1 gotcha/);
  });

  it("uncaps conventions; caps gotchas/decisions/attempts", () => {
    const conv = Array.from({ length: 30 }, (_, i) =>
      entry({ kind: "convention", id: `c${i}`.padEnd(8, "0"), topic: `c-${i}` }));
    const gotchas = Array.from({ length: 30 }, (_, i) =>
      entry({ kind: "gotcha", id: `g${i}`.padEnd(8, "0"), topic: `g-${i}` }));
    const out = renderMemoryProse(baseDoc([...conv, ...gotchas]));
    // All 30 conventions visible
    for (let i = 0; i < 30; i++) expect(out).toContain(`c-${i}`);
    // Only 10 gotchas
    expect(out).toContain("g-29"); // most-recent at end of input → first shown
    expect(out).not.toContain("g-19");
  });

  it("hides superseded and deprecated by default", () => {
    const out = renderMemoryProse(baseDoc([
      entry({ kind: "gotcha", topic: "active", id: "aaaaaaaa" }),
      entry({ kind: "gotcha", topic: "supr", id: "bbbbbbbb", superseded_by: "aaaaaaaa" }),
      entry({ kind: "gotcha", topic: "depr", id: "cccccccc", deprecated_at: "2026-05-08T00:00:00Z" }),
    ]));
    expect(out).toContain("active");
    expect(out).not.toContain("supr");
    expect(out).not.toContain("depr");
  });

  it("respects custom limits", () => {
    const gotchas = Array.from({ length: 5 }, (_, i) =>
      entry({ kind: "gotcha", id: `g${i}`.padEnd(8, "0"), topic: `g-${i}` }));
    const out = renderMemoryProse(baseDoc(gotchas), { limitGotcha: 2 });
    expect(out).toContain("g-4");
    expect(out).toContain("g-3");
    expect(out).not.toContain("g-2");
  });

  it("emits 'N older entries not shown' footer when limits truncate", () => {
    const gotchas = Array.from({ length: 15 }, (_, i) =>
      entry({ kind: "gotcha", id: `g${i}`.padEnd(8, "0"), topic: `g-${i}` }));
    const out = renderMemoryProse(baseDoc(gotchas));
    expect(out).toMatch(/older entries not shown/);
  });
});
