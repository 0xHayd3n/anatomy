// src/verify-suggest/registry/embed.ts
// Builds-or-loads embeddings for verify-suggest registry records. Delegates
// the model loader to src/embed/index.ts so anatomy_brief and verify-suggest
// share one pipeline singleton.

import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { RegistryRecord } from "./parse.js";
import {
  loadEmbedder,
  embedQuery as embedSharedQuery,
  _setEmbedderForTesting as setSharedEmbedderForTesting,
} from "../../embed/index.js";

// Re-export to keep existing test imports working.
export const _setEmbedderForTesting = setSharedEmbedderForTesting;

function hashTexts(texts: string[]): string {
  // FNV-1a 32-bit hash over a deterministic concatenation. Adequate as a
  // cache key — collisions only mean a needless re-embed.
  const joined = [...texts].sort().join("");
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

export async function buildOrLoadEmbeddings(
  records: RegistryRecord[],
  persistPath: string,
): Promise<Map<string, number[]>> {
  const ids = records.map(r => r.id);
  const idSet = new Set(ids);
  const currentTexts = records.map(r => `${r.id}\n${r.message}\n${r.category}`);
  const currentTextHash = hashTexts(currentTexts);

  if (existsSync(persistPath)) {
    try {
      const cached: CacheFile = JSON.parse(readFileSync(persistPath, "utf8"));
      if (
        cached.ids.length === ids.length &&
        cached.ids.every(id => idSet.has(id)) &&
        cached.textHash === currentTextHash
      ) {
        const map = new Map<string, number[]>();
        for (let i = 0; i < cached.ids.length; i++) {
          map.set(cached.ids[i], cached.embeddings[i]);
        }
        return map;
      }
    } catch {
      // Fall through to re-embed.
    }
  }

  const embedder = await loadEmbedder();
  if (!embedder) return new Map();

  const vectors = await embedder(currentTexts);

  const payload: CacheFile = { ids, embeddings: vectors, textHash: currentTextHash };
  await mkdir(dirname(persistPath), { recursive: true });
  try {
    await writeFile(persistPath, JSON.stringify(payload));
  } catch {
    // Cache write failed (permissions, disk full, etc.) — proceed with the
    // computed result; next run will re-embed.
  }

  const map = new Map<string, number[]>();
  for (let i = 0; i < ids.length; i++) map.set(ids[i], vectors[i]);
  return map;
}

export const embedQuery = embedSharedQuery;
