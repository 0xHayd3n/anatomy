import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _setEmbedderForTesting } from "../src/embed/index.js";
import { buildOrLoadMemoryEmbeddings, memoryEmbedTexts, memoryEmbeddingsPath } from "../src/memory/embed.js";
import type { MemoryEntry } from "../src/memory/io.js";

function e(id: string, over: Partial<MemoryEntry> = {}): MemoryEntry {
  return { id, kind: "gotcha", topic: `topic ${id}`, content: `content ${id}`,
    at: "2026-05-08T00:00:00.000Z", by: "human:test", ...over };
}

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "anat-memembed-")); });
afterEach(() => {
  _setEmbedderForTesting(undefined);
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
});

describe("memoryEmbedTexts", () => {
  it("excludes the entry id; includes topic, content, tags", () => {
    const [t] = memoryEmbedTexts([
      e("ZZIDZZID", { topic: "alpha topic", content: "beta content", tags: ["gamma", "delta"] }),
    ]);
    expect(t).not.toContain("ZZIDZZID");
    expect(t).toContain("alpha topic");
    expect(t).toContain("beta content");
    expect(t).toContain("gamma");
    expect(t).toContain("delta");
  });
});

describe("buildOrLoadMemoryEmbeddings", () => {
  const persist = () => join(dir, "fp1.json");

  it("returns empty map when embedder is unavailable", async () => {
    _setEmbedderForTesting(null);
    const m = await buildOrLoadMemoryEmbeddings([e("a")], persist());
    expect(m.size).toBe(0);
  });

  it("returns empty map (no throw) when the embedder throws per-call", async () => {
    _setEmbedderForTesting(async () => { throw new Error("transient model failure"); });
    const m = await buildOrLoadMemoryEmbeddings([e("a")], persist());
    expect(m.size).toBe(0);
  });

  it("embeds on miss, writes cache, returns id→vector map", async () => {
    _setEmbedderForTesting(async (texts: string[]) => texts.map(() => [1, 0, 0]));
    const m = await buildOrLoadMemoryEmbeddings([e("a"), e("b")], persist());
    expect(m.get("a")).toEqual([1, 0, 0]);
    expect(m.get("b")).toEqual([1, 0, 0]);
    expect(existsSync(persist())).toBe(true);
  });

  it("reads cache on hit without calling the embedder", async () => {
    let calls = 0;
    _setEmbedderForTesting(async (texts: string[]) => { calls++; return texts.map(() => [2, 0, 0]); });
    await buildOrLoadMemoryEmbeddings([e("a")], persist());
    expect(calls).toBe(1);
    await buildOrLoadMemoryEmbeddings([e("a")], persist());
    expect(calls).toBe(1); // second call served from cache
  });

  it("re-embeds when entry content changes (textHash invalidation)", async () => {
    let calls = 0;
    _setEmbedderForTesting(async (texts: string[]) => { calls++; return texts.map(() => [3, 0, 0]); });
    await buildOrLoadMemoryEmbeddings([e("a", { content: "v1" })], persist());
    await buildOrLoadMemoryEmbeddings([e("a", { content: "v2" })], persist());
    expect(calls).toBe(2);
  });

  it("re-embeds when the id set changes", async () => {
    let calls = 0;
    _setEmbedderForTesting(async (texts: string[]) => { calls++; return texts.map(() => [4, 0, 0]); });
    await buildOrLoadMemoryEmbeddings([e("a")], persist());
    await buildOrLoadMemoryEmbeddings([e("a"), e("b")], persist());
    expect(calls).toBe(2);
  });

  it("treats a corrupt cache file as a miss and re-embeds", async () => {
    writeFileSync(persist(), "{ not json");
    _setEmbedderForTesting(async (texts: string[]) => texts.map(() => [5, 0, 0]));
    const m = await buildOrLoadMemoryEmbeddings([e("a")], persist());
    expect(m.get("a")).toEqual([5, 0, 0]);
  });

  it("skips all cache I/O when persistPath is null but still returns vectors", async () => {
    let calls = 0;
    _setEmbedderForTesting(async (texts: string[]) => { calls++; return texts.map(() => [6, 0, 0]); });
    const m1 = await buildOrLoadMemoryEmbeddings([e("a")], null);
    expect(m1.get("a")).toEqual([6, 0, 0]);
    // No cache file to read back from: a second call re-embeds rather than
    // serving a hit, proving nothing was persisted or loaded.
    const m2 = await buildOrLoadMemoryEmbeddings([e("a")], null);
    expect(m2.get("a")).toEqual([6, 0, 0]);
    expect(calls).toBe(2);
  });
});

describe("memoryEmbeddingsPath", () => {
  it("uses a valid fingerprint as the filename", () => {
    const p = memoryEmbeddingsPath("abc123def456");
    expect(p).not.toBeNull();
    expect(p!.endsWith(join("memory-embeddings", "abc123def456.json"))).toBe(true);
  });

  it("returns null (skip cache) for an invalid/empty fingerprint", () => {
    expect(memoryEmbeddingsPath("")).toBeNull();
    expect(memoryEmbeddingsPath("../evil")).toBeNull();
  });
});
