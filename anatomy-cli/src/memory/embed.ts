// src/memory/embed.ts
// Build-or-load per-repo embeddings for .anatomy-memory entries. Mirrors the
// verify-suggest registry cache pattern but typed to MemoryEntry. The embedded
// text excludes the entry id (random Crockford-base32 = semantic noise); the
// id only participates in cache-invalidation. Returns an empty Map when the
// shared embedder is unavailable or the cache cannot be written — callers then
// degrade to lexical-only ranking.

import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { MemoryEntry } from "./io.js";
import { embedBatch } from "../embed/index.js";

/** Text fed to the embedding model for one entry. Id intentionally omitted. */
export function memoryEmbedTexts(entries: MemoryEntry[]): string[] {
  return entries.map(e => `${e.topic}\n${e.content}\n${(e.tags ?? []).join(" ")}`);
}

/** Per-repo cache path, or null when the fingerprint is empty/non-alphanumeric.
 *  Returning null (rather than a shared "unknown.json") makes callers skip the
 *  on-disk cache entirely: a single shared file across every fingerprint-less
 *  repo only ever thrashes (the id-set + textHash guard in
 *  buildOrLoadMemoryEmbeddings means distinct repos never serve each other's
 *  vectors, so the file is rewritten on every call) and races between
 *  concurrent writers. Skipping has the same compute cost with no disk churn. */
export function memoryEmbeddingsPath(repoFingerprint: string): string | null {
  if (!repoFingerprint || !/^[a-z0-9]+$/i.test(repoFingerprint)) return null;
  return join(homedir(), ".anatomy", "memory-embeddings", `${repoFingerprint}.json`);
}

function hashTexts(texts: string[]): string {
  // FNV-1a 32-bit over a deterministic concatenation. Collisions only cause a
  // needless re-embed, so a fast non-crypto hash is sufficient.
  const joined = [...texts].sort().join(" ");
  let h = 0x811c9dc5;
  for (let i = 0; i < joined.length; i++) {
    h ^= joined.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

interface CacheFile {
  ids: string[];
  embeddings: number[][];
  textHash: string;
}

export async function buildOrLoadMemoryEmbeddings(
  entries: MemoryEntry[],
  persistPath: string | null,
): Promise<Map<string, number[]>> {
  const ids = entries.map(e => e.id);
  const idSet = new Set(ids);
  const texts = memoryEmbedTexts(entries);
  const textHash = hashTexts(texts);

  // Null path → caller opted out of the on-disk cache (empty/invalid
  // fingerprint). Embed in-memory and persist nothing.
  if (persistPath === null) {
    const vectors = await embedBatch(texts);
    if (!vectors) return new Map();
    const map = new Map<string, number[]>();
    for (let i = 0; i < ids.length; i++) map.set(ids[i], vectors[i]);
    return map;
  }

  if (existsSync(persistPath)) {
    try {
      const cached: CacheFile = JSON.parse(readFileSync(persistPath, "utf8"));
      if (
        cached.ids.length === ids.length &&
        cached.ids.every(id => idSet.has(id)) &&
        cached.textHash === textHash
      ) {
        const map = new Map<string, number[]>();
        for (let i = 0; i < cached.ids.length; i++) map.set(cached.ids[i], cached.embeddings[i]);
        return map;
      }
    } catch {
      // Corrupt/unreadable cache → fall through and re-embed.
    }
  }

  const vectors = await embedBatch(texts);
  if (!vectors) return new Map();

  const payload: CacheFile = { ids, embeddings: vectors, textHash };
  try {
    await mkdir(dirname(persistPath), { recursive: true });
    await writeFile(persistPath, JSON.stringify(payload));
  } catch {
    // Cache write failed (permissions, disk full) — proceed with the computed
    // result; the next run re-embeds.
  }

  const map = new Map<string, number[]>();
  for (let i = 0; i < ids.length; i++) map.set(ids[i], vectors[i]);
  return map;
}
