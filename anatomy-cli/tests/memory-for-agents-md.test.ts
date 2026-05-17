import { describe, it, expect } from "vitest";
import { selectTopMemoryEntries } from "../src/render/memory-for-agents-md.js";
import type { MemoryEntry } from "../src/memory/io.js";

function entry(overrides: Partial<MemoryEntry>): MemoryEntry {
  return {
    id: overrides.id ?? "00000001",
    kind: overrides.kind ?? "gotcha",
    topic: overrides.topic ?? "topic",
    content: overrides.content ?? "content",
    at: overrides.at ?? new Date().toISOString(),
    by: overrides.by ?? "test",
    ...overrides,
  };
}

describe("selectTopMemoryEntries", () => {
  const now = new Date("2026-05-13T12:00:00.000Z");

  it("returns at most N entries", () => {
    const entries = Array.from({ length: 30 }, (_, i) =>
      entry({ id: `e${i}`, at: now.toISOString(), last_verified_at: now.toISOString() }),
    );
    const out = selectTopMemoryEntries(entries, 10, now);
    expect(out.length).toBe(10);
  });

  it("excludes deprecated entries", () => {
    const out = selectTopMemoryEntries(
      [
        entry({ id: "a", at: now.toISOString(), last_verified_at: now.toISOString() }),
        entry({ id: "b", at: now.toISOString(), deprecated_at: now.toISOString() }),
      ],
      10,
      now,
    );
    expect(out.map((e) => e.id)).toEqual(["a"]);
  });

  it("prefers fresh-verified over untouched-but-recent", () => {
    const oneWeekAgoIso = new Date(now.getTime() - 7 * 86400_000).toISOString();
    const fresh = entry({ id: "fresh", at: oneWeekAgoIso, last_verified_at: oneWeekAgoIso });
    const untouched = entry({ id: "untouched", at: oneWeekAgoIso });
    const out = selectTopMemoryEntries([untouched, fresh], 1, now);
    expect(out[0].id).toBe("fresh");
  });

  it("excludes stale entries with very old verification", () => {
    const twoYearsAgoIso = new Date(now.getTime() - 2 * 365 * 86400_000).toISOString();
    const stale = entry({ id: "stale-old", at: twoYearsAgoIso, last_verified_at: twoYearsAgoIso });
    const out = selectTopMemoryEntries([stale], 10, now);
    expect(out.map((e) => e.id)).not.toContain("stale-old");
  });

  it("includes stale entries with high recency", () => {
    // Stale because never verified in the last STALE_DAYS, but verified ONE week ago
    // (we control timestamps to construct a 'stale-but-recent' edge case).
    // Default STALE_DAYS = 90; verify 100 days ago -> stale bucket.
    const hundredDaysAgoIso = new Date(now.getTime() - 100 * 86400_000).toISOString();
    const e = entry({
      id: "stale-recent",
      at: hundredDaysAgoIso,
      last_verified_at: hundredDaysAgoIso,
    });
    const out = selectTopMemoryEntries([e], 10, now);
    // recency_floor_for_stale is 0.7; 100/365 years -> exp(-0.27) ≈ 0.76, above floor
    expect(out.map((x) => x.id)).toContain("stale-recent");
  });

  it("returns entries unchanged structurally (no mutation)", () => {
    const e = entry({ id: "a", at: now.toISOString(), last_verified_at: now.toISOString() });
    const original = JSON.parse(JSON.stringify(e));
    selectTopMemoryEntries([e], 10, now);
    expect(e).toEqual(original);
  });
});
