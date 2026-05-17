// src/mcp/memory-tools.ts
// Memory query/show/stats tools for the anatomy MCP server.
// Reuses existing memory io from src/memory/io.ts.

import { join } from "node:path";
import { resolveAnatomy } from "../resolve.js";
import { wrapError, type SuccessEnvelope, type ErrorEnvelope } from "./envelope.js";
import { recordTelemetry } from "../telemetry.js";
import { readMemoryFile, parseMemoryDoc, type MemoryEntry } from "../memory/io.js";
import { bucketCounts } from "../memory/decay.js";
import { searchMemoryHybrid } from "../memory/search.js";
import { buildOrLoadMemoryEmbeddings, memoryEmbeddingsPath } from "../memory/embed.js";
import { embedQuery } from "../embed/index.js";
import { makeReverifyHandler } from "./memory-reverify-tool.js";
import type { StalenessInfo } from "./envelope.js";

type ToolResult<T> = SuccessEnvelope<T> | ErrorEnvelope;
type Args = Record<string, unknown>;

async function loadMemory(args: Args): Promise<{ entries: MemoryEntry[]; anatomy_path: string; anatomy_dir: string; repo_root: string; staleness: StalenessInfo | null; repo_fingerprint: string } | ErrorEnvelope> {
  const path = typeof args.path === "string" ? args.path : process.cwd();
  const r = await resolveAnatomy(path);
  if ("error" in r) return wrapError(r);
  const text = readMemoryFile(r.anatomy_dir);
  if (text === null) {
    return { error: "memory_not_found_for_anatomy", path: join(r.anatomy_dir, ".anatomy-memory") };
  }
  const memory = parseMemoryDoc(text);
  return {
    entries: memory.entries,
    anatomy_path: r.anatomy_path,
    anatomy_dir: r.anatomy_dir,
    repo_root: r.repo_root,
    staleness: r.staleness,
    repo_fingerprint: (r.doc as unknown as { identity?: { fingerprint?: string } }).identity?.fingerprint ?? "",
  };
}

function instrument<T>(name: string, fn: (args: Args) => Promise<ToolResult<T>>): (args: Args) => Promise<ToolResult<T>> {
  return async (args) => {
    const t0 = Date.now();
    const result = await fn(args);
    const json = JSON.stringify(result);
    recordTelemetry({
      kind: "mcp_call",
      ts: new Date().toISOString(),
      tool: name,
      args,
      repo_fingerprint: typeof (result as { repo_fingerprint?: string }).repo_fingerprint === "string" ? (result as { repo_fingerprint: string }).repo_fingerprint : "",
      result_count: Array.isArray((result as { data?: unknown }).data) ? ((result as { data: unknown[] }).data).length : undefined,
      result_bytes: json.length,
      error: "error" in result ? result.error : null,
      latency_ms: Date.now() - t0,
    });
    return result;
  };
}

async function search(args: Args): Promise<ToolResult<unknown>> {
  const loaded = await loadMemory(args);
  if ("error" in loaded) return loaded;

  const query = typeof args.query === "string" ? args.query : undefined;
  const opts = {
    query,
    kind: typeof args.kind === "string" ? args.kind : undefined,
    topic: typeof args.topic === "string" ? args.topic : undefined,
    tag: typeof args.tag === "string" ? args.tag : undefined,
    ref: typeof args.ref === "string" ? args.ref : undefined,
    includeSuperseded: !!args.include_superseded,
    limit: typeof args.limit === "number" ? args.limit : undefined,
  };

  // Build the dense arm only when there is a query. The embed cache and
  // embedQuery both degrade to "no vectors" when @xenova/transformers is
  // absent, so searchMemoryHybrid returns exact legacy output in that case.
  let vectors: { queryVec: number[] | null; entryVecs: Map<string, number[]> } | undefined;
  if (query && query.trim().length > 0) {
    const entryVecs = await buildOrLoadMemoryEmbeddings(
      loaded.entries,
      memoryEmbeddingsPath(loaded.repo_fingerprint),
    );
    const queryVec = entryVecs.size > 0 ? await embedQuery(query) : null;
    vectors = { queryVec, entryVecs };
  }

  const ranked = searchMemoryHybrid(loaded.entries, opts, vectors);
  return {
    anatomy_path: loaded.anatomy_path,
    staleness: loaded.staleness,
    repo_fingerprint: loaded.repo_fingerprint,
    data: ranked.map(r => {
      const base: Record<string, unknown> = {
        ...r.entry,
        bm25_score: r.bm25_score,
        decay_bucket: r.decay_bucket,
      };
      if (r.rrf_score !== null) {
        base.dense_score = r.dense_score;
        base.rrf_score = r.rrf_score;
      }
      return base;
    }),
  };
}

async function show(args: Args): Promise<ToolResult<unknown>> {
  if (typeof args.id !== "string") return { error: "invalid_id", id: String(args.id ?? "") };
  const loaded = await loadMemory(args);
  if ("error" in loaded) return loaded;
  const entry = loaded.entries.find(e => e.id === args.id);
  if (!entry) return { error: "invalid_id", id: args.id as string };
  // Walk supersession chain
  const chain: MemoryEntry[] = [entry];
  let cursor = entry;
  while (cursor.superseded_by) {
    const next = loaded.entries.find(e => e.id === cursor.superseded_by);
    if (!next) break;
    chain.push(next);
    cursor = next;
  }
  return { anatomy_path: loaded.anatomy_path, staleness: loaded.staleness, repo_fingerprint: loaded.repo_fingerprint, data: { entry, chain } };
}

async function stats(args: Args): Promise<ToolResult<unknown>> {
  const loaded = await loadMemory(args);
  if ("error" in loaded) return loaded;
  const now = new Date();
  const acc: Record<string, {
    active: number;
    superseded: number;
    deprecated: number;
    decay: { fresh: number; aging: number; stale: number; untouched: number };
  }> = {};
  const activeByKind: Record<string, MemoryEntry[]> = {};
  for (const e of loaded.entries) {
    if (!acc[e.kind]) acc[e.kind] = {
      active: 0, superseded: 0, deprecated: 0,
      decay: { fresh: 0, aging: 0, stale: 0, untouched: 0 },
    };
    if (e.superseded_by) acc[e.kind].superseded++;
    else if (e.deprecated_at) acc[e.kind].deprecated++;
    else {
      acc[e.kind].active++;
      (activeByKind[e.kind] ??= []).push(e);
    }
  }
  for (const [kind, entries] of Object.entries(activeByKind)) {
    acc[kind].decay = bucketCounts(entries, now);
  }
  return { anatomy_path: loaded.anatomy_path, staleness: loaded.staleness, repo_fingerprint: loaded.repo_fingerprint, data: acc };
}

export const memoryToolHandlers: Record<string, (args: Args) => Promise<ToolResult<unknown>>> = {
  anatomy_memory_search: instrument("anatomy_memory_search", search),
  anatomy_memory_show: instrument("anatomy_memory_show", show),
  anatomy_memory_stats: instrument("anatomy_memory_stats", stats),
  anatomy_memory_reverify: instrument("anatomy_memory_reverify", makeReverifyHandler(loadMemory)),
};

export const memoryToolDefinitions = [
  {
    name: "anatomy_memory_search",
    description: "Search .anatomy-memory entries via hybrid retrieval: BM25F lexical ranking (per-field weights topic ×3, tags ×2, content ×1) reciprocal-rank-fused with dense embedding similarity. When the embedding dependency is unavailable this degrades to BM25F-only with identical scoring. Results in RRF mode include dense_score and rrf_score; in degraded mode only bm25_score. Tokenization is lowercase whitespace+punctuation split that preserves identifiers (paths, scoped packages, memory IDs). Each result's BM25 score is multiplied by a decay multiplier (fresh=1.0, aging=0.85, untouched=0.7, stale=0.6) computed from last_verified_at (or `at` for untouched entries). Filters (kind, topic, ref, tag) apply as hard pre-filters before scoring. Defaults: hide superseded/deprecated, limit 25. Each result includes bm25_score and decay_bucket. Empty query: returns entries ranked by decay × recency only.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        kind: { type: "string", description: "Filter by kind (gotcha | decision | convention | attempt | milestone | etc.)" },
        topic: { type: "string" },
        ref: { type: "string" },
        tag: { type: "string" },
        include_superseded: { type: "boolean" },
        limit: { type: "number" },
        path: { type: "string" },
      },
    },
  },
  {
    name: "anatomy_memory_show",
    description: "Returns the full detail of one memory entry plus its supersession chain.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string" },
        path: { type: "string" },
      },
    },
  },
  {
    name: "anatomy_memory_stats",
    description: "Returns per-kind active/superseded/deprecated counts.",
    inputSchema: { type: "object", properties: { path: { type: "string" } } },
  },
  {
    name: "anatomy_memory_reverify",
    description: "Re-verify a memory entry against current source. Returns the entry plus, for each ref, the git diff since the entry's last endorsement (max of `at` and `last_verified_at`). Empty diff → `status: \"unchanged\"`, a strong signal the entry is still valid. Diff > 400 lines falls back to current file content (`truncated: true`). Other statuses: `new_since_endorsement` (ref postdates endorsement), `deleted`, `not_in_repo`. Read-only — the tool does not mutate the memory file. Compose with `anatomy memory verify <id>` or `anatomy memory deprecate <id>` to act on the result.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string" },
        path: { type: "string" },
      },
    },
  },
];
