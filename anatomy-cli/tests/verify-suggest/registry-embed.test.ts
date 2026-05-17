import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildOrLoadEmbeddings, _setEmbedderForTesting } from "../../src/verify-suggest/registry/embed.js";

function fakeEmbedder(dim = 4): (texts: string[]) => Promise<number[][]> {
  // Deterministic embedder: hash each text into a small dense vector.
  return async (texts) =>
    texts.map(t => {
      const v = new Array(dim).fill(0);
      for (let i = 0; i < t.length; i++) v[i % dim] += t.charCodeAt(i);
      const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
      return v.map(x => x / norm);
    });
}

describe("buildOrLoadEmbeddings", () => {
  it("computes and persists embeddings on first call", async () => {
    _setEmbedderForTesting(fakeEmbedder(4));
    const persistPath = join(mkdtempSync(join(tmpdir(), "anat-emb-")), "embeddings.json");
    const records = [
      { id: "r1", message: "no console.log", category: "best-practice", languages: ["js"], path: "/a.yaml" },
      { id: "r2", message: "no hardcoded secrets", category: "security", languages: ["js"], path: "/b.yaml" },
    ];
    const embeddings = await buildOrLoadEmbeddings(records, persistPath);
    expect(embeddings.size).toBe(2);
    expect(embeddings.get("r1")).toHaveLength(4);
    expect(existsSync(persistPath)).toBe(true);
    rmSync(persistPath, { force: true });
  });

  it("loads from disk on subsequent call without re-embedding", async () => {
    _setEmbedderForTesting(fakeEmbedder(4));
    const persistPath = join(mkdtempSync(join(tmpdir(), "anat-emb-")), "embeddings.json");
    const records = [{ id: "r1", message: "x", category: "", languages: [], path: "" }];
    await buildOrLoadEmbeddings(records, persistPath);
    // Swap embedder to one that throws — should not be called on the second pass.
    _setEmbedderForTesting(async () => { throw new Error("should not embed again"); });
    const second = await buildOrLoadEmbeddings(records, persistPath);
    expect(second.size).toBe(1);
    rmSync(persistPath, { force: true });
  });

  it("re-embeds when the corpus id set differs from the persisted cache", async () => {
    _setEmbedderForTesting(fakeEmbedder(4));
    const persistPath = join(mkdtempSync(join(tmpdir(), "anat-emb-")), "embeddings.json");
    await buildOrLoadEmbeddings(
      [{ id: "r1", message: "x", category: "", languages: [], path: "" }],
      persistPath,
    );
    // Different corpus → must re-embed.
    let calls = 0;
    _setEmbedderForTesting(async (texts) => {
      calls++;
      return fakeEmbedder(4)(texts);
    });
    await buildOrLoadEmbeddings(
      [{ id: "r2", message: "y", category: "", languages: [], path: "" }],
      persistPath,
    );
    expect(calls).toBeGreaterThan(0);
    rmSync(persistPath, { force: true });
  });

  it("re-embeds when an existing rule's message text changes (same id, different text)", async () => {
    _setEmbedderForTesting(fakeEmbedder(4));
    const persistPath = join(mkdtempSync(join(tmpdir(), "anat-emb-")), "embeddings.json");
    await buildOrLoadEmbeddings(
      [{ id: "r1", message: "original", category: "", languages: [], path: "" }],
      persistPath,
    );
    let calls = 0;
    _setEmbedderForTesting(async (texts) => {
      calls++;
      return fakeEmbedder(4)(texts);
    });
    await buildOrLoadEmbeddings(
      // Same id, different message → text hash differs → must re-embed.
      [{ id: "r1", message: "rewritten by upstream", category: "", languages: [], path: "" }],
      persistPath,
    );
    expect(calls).toBeGreaterThan(0);
    rmSync(persistPath, { force: true });
  });
});

describe("buildOrLoadEmbeddings — embedder unavailable", () => {
  it("returns an empty map when no embedder is configured and library load fails", async () => {
    _setEmbedderForTesting(null);  // null means "library not available"
    const persistPath = join(mkdtempSync(join(tmpdir(), "anat-emb-")), "embeddings.json");
    const embeddings = await buildOrLoadEmbeddings(
      [{ id: "r1", message: "x", category: "", languages: [], path: "" }],
      persistPath,
    );
    expect(embeddings.size).toBe(0);
  });
});
