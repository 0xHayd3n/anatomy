import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { decayBucket, decayMultiplier, bucketCounts, _resetDecayMultiplierCache } from "../src/memory/decay.js";
import type { MemoryEntry } from "../src/memory/io.js";

const NOW = new Date("2026-05-08T12:00:00Z");

function entry(at: string, last_verified_at?: string): MemoryEntry {
  return {
    id: "abcd1234",
    kind: "decision",
    topic: "test",
    content: "test",
    at,
    by: "human:test",
    ...(last_verified_at !== undefined ? { last_verified_at } : {}),
  };
}

describe("decayBucket", () => {
  it("v0.1 entry (no last_verified_at) → untouched, regardless of recent `at`", () => {
    expect(decayBucket(entry("2026-05-08T00:00:00Z"), NOW)).toBe("untouched");
    expect(decayBucket(entry("2026-05-01T00:00:00Z"), NOW)).toBe("untouched");
    expect(decayBucket(entry("2024-01-01T00:00:00Z"), NOW)).toBe("untouched");
  });

  it("verified within 30 days → fresh", () => {
    expect(decayBucket(entry("2025-01-01T00:00:00Z", "2026-04-25T00:00:00Z"), NOW)).toBe("fresh");
    expect(decayBucket(entry("2025-01-01T00:00:00Z", "2026-05-08T11:00:00Z"), NOW)).toBe("fresh");
  });

  it("verified between 30 and 180 days → aging", () => {
    expect(decayBucket(entry("2025-01-01T00:00:00Z", "2026-04-01T00:00:00Z"), NOW)).toBe("aging");
    expect(decayBucket(entry("2025-01-01T00:00:00Z", "2025-12-01T00:00:00Z"), NOW)).toBe("aging");
  });

  it("verified more than 180 days ago → stale", () => {
    expect(decayBucket(entry("2024-01-01T00:00:00Z", "2025-10-01T00:00:00Z"), NOW)).toBe("stale");
  });

  it("malformed last_verified_at → stale (worst-case)", () => {
    expect(decayBucket(entry("2025-01-01T00:00:00Z", "not-a-date"), NOW)).toBe("stale");
  });
});

describe("decayMultiplier", () => {
  beforeEach(() => {
    delete process.env.ANATOMY_MEMORY_DECAY_MULTIPLIERS;
    _resetDecayMultiplierCache();
  });
  afterEach(() => {
    delete process.env.ANATOMY_MEMORY_DECAY_MULTIPLIERS;
    _resetDecayMultiplierCache();
  });

  it("default multipliers per design doc", () => {
    expect(decayMultiplier("fresh")).toBe(1.0);
    expect(decayMultiplier("aging")).toBe(0.85);
    expect(decayMultiplier("stale")).toBe(0.6);
    expect(decayMultiplier("untouched")).toBe(0.7);
  });

  it("env override changes multipliers", () => {
    process.env.ANATOMY_MEMORY_DECAY_MULTIPLIERS = "fresh:0.9,stale:0.3";
    _resetDecayMultiplierCache();
    expect(decayMultiplier("fresh")).toBe(0.9);
    expect(decayMultiplier("stale")).toBe(0.3);
    // Untouched + aging keep defaults (env didn't override them).
    expect(decayMultiplier("aging")).toBe(0.85);
    expect(decayMultiplier("untouched")).toBe(0.7);
  });

  it("env override clamps out-of-range values to [0, 1]", () => {
    process.env.ANATOMY_MEMORY_DECAY_MULTIPLIERS = "fresh:5,stale:-2";
    _resetDecayMultiplierCache();
    expect(decayMultiplier("fresh")).toBe(1);
    expect(decayMultiplier("stale")).toBe(0);
  });

  it("ignores unknown bucket names + non-numeric values", () => {
    process.env.ANATOMY_MEMORY_DECAY_MULTIPLIERS = "garbage:0.5,fresh:not-a-number,stale:0.4";
    _resetDecayMultiplierCache();
    expect(decayMultiplier("fresh")).toBe(1.0);
    expect(decayMultiplier("stale")).toBe(0.4);
  });
});

describe("bucketCounts", () => {
  it("totals each bucket across an entry array", () => {
    const entries: MemoryEntry[] = [
      entry("2026-01-01T00:00:00Z", "2026-04-25T00:00:00Z"), // fresh
      entry("2026-01-01T00:00:00Z", "2026-04-01T00:00:00Z"), // aging
      entry("2024-01-01T00:00:00Z", "2025-09-01T00:00:00Z"), // stale
      entry("2024-01-01T00:00:00Z"),                           // untouched
      entry("2026-05-01T00:00:00Z"),                           // untouched (recent at, but no verify)
    ];
    const c = bucketCounts(entries, NOW);
    expect(c).toEqual({ fresh: 1, aging: 1, stale: 1, untouched: 2 });
  });

  it("empty entry list returns zeroed buckets", () => {
    expect(bucketCounts([], NOW)).toEqual({ fresh: 0, aging: 0, stale: 0, untouched: 0 });
  });
});
