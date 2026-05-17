// src/memory/search.ts
// Shared orchestrator used by both `anatomy memory search` (CLI) and the
// `anatomy_memory_search` MCP tool. Composes:
//   1. Hard filters (superseded/deprecated, kind, topic, ref, tag)
//   2. BM25F scoring (or empty-query fallback)
//   3. Decay-multiplier composition
//   4. Sort + limit
// Returns RankedEntry[] with score components surfaced for consumers.

import type { MemoryEntry } from "./io.js";
import { decayBucket, decayMultiplier, type DecayBucket } from "./decay.js";
import { tokenize, computeIdf, bm25fScore, type TokenizedEntry } from "./bm25.js";
import { cosine } from "../embed/index.js";
import { rrfFuse } from "./rrf.js";

const DEFAULT_LIMIT = 25;
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export interface SearchOptions {
  query?: string;
  kind?: string;
  topic?: string;
  ref?: string;
  tag?: string;
  includeSuperseded?: boolean;
  limit?: number;
  now?: Date;
}

export interface RankedEntry {
  entry: MemoryEntry;
  bm25_score: number;
  decay_bucket: DecayBucket;
  combined_score: number;
}

export interface HybridRankedEntry extends RankedEntry {
  /** Cosine similarity to the query vector, or null when the entry had no
   *  embedding or hybrid degraded to legacy. */
  dense_score: number | null;
  /** Fused RRF score, or null in degraded (legacy) mode. */
  rrf_score: number | null;
}

export interface HybridVectors {
  queryVec: number[] | null;
  entryVecs: Map<string, number[]>;
}

/** Hard pre-score filters shared by searchMemory and searchMemoryHybrid:
 *  superseded/deprecated (unless includeSuperseded), then kind/topic/ref/tag. */
export function filterCandidates(entries: MemoryEntry[], opts: SearchOptions): MemoryEntry[] {
  let candidates = entries;
  if (!opts.includeSuperseded) {
    candidates = candidates.filter(e => !e.superseded_by && !e.deprecated_at);
  }
  if (typeof opts.kind === "string") candidates = candidates.filter(e => e.kind === opts.kind);
  if (typeof opts.topic === "string") candidates = candidates.filter(e => e.topic === opts.topic);
  if (typeof opts.ref === "string") candidates = candidates.filter(e => (e.refs ?? []).includes(opts.ref!));
  if (typeof opts.tag === "string") candidates = candidates.filter(e => (e.tags ?? []).includes(opts.tag!));
  return candidates;
}

export function searchMemory(entries: MemoryEntry[], opts: SearchOptions): RankedEntry[] {
  const now = opts.now ?? new Date();
  const limit = typeof opts.limit === "number" ? opts.limit : DEFAULT_LIMIT;

  // 1. Hard filters
  const candidates = filterCandidates(entries, opts);

  if (candidates.length === 0) return [];

  const queryTokens = typeof opts.query === "string" ? tokenize(opts.query) : [];

  // 2a. Empty-query fallback: rank by decay × recency
  if (queryTokens.length === 0) {
    const ranked: RankedEntry[] = candidates.map(entry => {
      const bucket = decayBucket(entry, now);
      const lastTouch = entry.last_verified_at ?? entry.at;
      const rawAgeMs = now.getTime() - Date.parse(lastTouch);
      const ageMs = Number.isFinite(rawAgeMs) ? Math.max(0, rawAgeMs) : null;
      const recency = ageMs !== null ? Math.exp(-ageMs / ONE_YEAR_MS) : 0;
      const combined = decayMultiplier(bucket) * recency;
      return { entry, bm25_score: 0, decay_bucket: bucket, combined_score: combined };
    });
    ranked.sort((a, b) => {
      if (b.combined_score !== a.combined_score) return b.combined_score - a.combined_score;
      return b.entry.at.localeCompare(a.entry.at);
    });
    return ranked.slice(0, limit);
  }

  // 2b. BM25 scoring path
  const tokenized: TokenizedEntry[] = candidates.map(e => ({
    topic: tokenize(e.topic),
    content: tokenize(e.content),
    tags: (e.tags ?? []).flatMap(t => tokenize(t)),
  }));
  const avg = avgFieldLengths(tokenized);
  const idf = computeIdf(queryTokens, tokenized);

  const ranked: RankedEntry[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const bm25 = bm25fScore(queryTokens, tokenized[i], avg, idf);
    if (bm25 === 0) continue;
    const bucket = decayBucket(candidates[i], now);
    const combined = bm25 * decayMultiplier(bucket);
    ranked.push({ entry: candidates[i], bm25_score: bm25, decay_bucket: bucket, combined_score: combined });
  }
  ranked.sort((a, b) => {
    if (b.combined_score !== a.combined_score) return b.combined_score - a.combined_score;
    return b.entry.at.localeCompare(a.entry.at);
  });
  return ranked.slice(0, limit);
}

function avgFieldLengths(corpus: TokenizedEntry[]): { topic: number; content: number; tags: number } {
  if (corpus.length === 0) return { topic: 1, content: 1, tags: 1 };
  let topic = 0, content = 0, tags = 0;
  for (const e of corpus) {
    topic += e.topic.length;
    content += e.content.length;
    tags += e.tags.length;
  }
  return {
    topic: Math.max(topic / corpus.length, 1),
    content: Math.max(content / corpus.length, 1),
    tags: Math.max(tags / corpus.length, 1),
  };
}

/** Hybrid lexical+dense ranking. When `vectors` is absent, queryVec is null,
 *  or no candidate has an embedding, the dense arm is empty and the result is
 *  byte-identical to searchMemory (legacy bm25×decay), with dense_score and
 *  rrf_score set to null. Otherwise lexical and dense ranked id lists are
 *  RRF-fused, then multiplied by the existing decay multiplier. Empty queries
 *  always use the unchanged decay×recency fallback (no dense arm). */
export function searchMemoryHybrid(
  entries: MemoryEntry[],
  opts: SearchOptions,
  vectors?: HybridVectors,
): HybridRankedEntry[] {
  const now = opts.now ?? new Date();
  const limit = typeof opts.limit === "number" ? opts.limit : DEFAULT_LIMIT;
  const queryTokens = typeof opts.query === "string" ? tokenize(opts.query) : [];

  // Empty query OR no usable dense input → exact legacy behavior.
  const denseUsable =
    queryTokens.length > 0 &&
    !!vectors &&
    Array.isArray(vectors.queryVec) &&
    vectors.entryVecs.size > 0;

  if (!denseUsable) {
    return searchMemory(entries, opts).map(r => ({ ...r, dense_score: null, rrf_score: null }));
  }

  const candidates = filterCandidates(entries, opts);
  if (candidates.length === 0) return [];

  // Lexical arm: same BM25F primitives as searchMemory, sorted by raw bm25 desc.
  const tokenized: TokenizedEntry[] = candidates.map(e => ({
    topic: tokenize(e.topic),
    content: tokenize(e.content),
    tags: (e.tags ?? []).flatMap(t => tokenize(t)),
  }));
  const avg = avgFieldLengths(tokenized);
  const idf = computeIdf(queryTokens, tokenized);
  const lexical: Array<{ id: string; score: number; entry: MemoryEntry }> = [];
  const bm25ById = new Map<string, number>();
  for (let i = 0; i < candidates.length; i++) {
    const s = bm25fScore(queryTokens, tokenized[i], avg, idf);
    bm25ById.set(candidates[i].id, s);
    if (s > 0) lexical.push({ id: candidates[i].id, score: s, entry: candidates[i] });
  }
  lexical.sort((a, b) =>
    b.score !== a.score ? b.score - a.score : b.entry.at.localeCompare(a.entry.at),
  );

  // Dense arm: cosine(query, entry) for candidates that have an embedding.
  const qv = vectors!.queryVec as number[];
  const dense: Array<{ id: string; score: number; entry: MemoryEntry }> = [];
  const denseById = new Map<string, number>();
  for (const c of candidates) {
    const v = vectors!.entryVecs.get(c.id);
    if (!v) continue;
    const s = cosine(qv, v);
    denseById.set(c.id, s);
    // negative/zero cosine → semantically unrelated or opposed; omit from the
    // dense arm (the entry stays rankable via the lexical arm).
    if (s > 0) dense.push({ id: c.id, score: s, entry: c });
  }
  dense.sort((a, b) =>
    b.score !== a.score ? b.score - a.score : b.entry.at.localeCompare(a.entry.at),
  );

  // Spec degraded-mode guarantee: if the dense list is empty (no filtered
  // candidate had an embedding, or every cosine was ≤ 0), bypass RRF and
  // return byte-identical legacy output rather than RRF-scaled lexical-only.
  if (dense.length === 0) {
    return searchMemory(entries, opts).map(r => ({ ...r, dense_score: null, rrf_score: null }));
  }

  const fused = rrfFuse(lexical.map(x => x.id), dense.map(x => x.id));
  const byId = new Map(candidates.map(c => [c.id, c]));

  const ranked: HybridRankedEntry[] = [];
  for (const [id, rrf] of fused) {
    const entry = byId.get(id)!;
    const bucket = decayBucket(entry, now);
    ranked.push({
      entry,
      bm25_score: bm25ById.get(id) ?? 0,
      dense_score: denseById.has(id) ? denseById.get(id)! : null,
      rrf_score: rrf,
      decay_bucket: bucket,
      combined_score: rrf * decayMultiplier(bucket),
    });
  }
  ranked.sort((a, b) =>
    b.combined_score !== a.combined_score
      ? b.combined_score - a.combined_score
      : b.entry.at.localeCompare(a.entry.at),
  );
  return ranked.slice(0, limit);
}
