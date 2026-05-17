import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { fingerprintFromPillars } from "@anatomytool/validate";
import { memoryToolHandlers } from "../src/mcp/memory-tools.js";
import { _setEmbedderForTesting } from "../src/embed/index.js";
import { buildAnatomyToml } from "./_helpers/fixture.js";

const ANATOMY = buildAnatomyToml({ tagline: "test" });
// Memory file's repo_fingerprint must match the .anatomy's fingerprint.
const FP = fingerprintFromPillars("javascript", "javascript-library", "test", "test");

const MEMORY = `anatomy_memory_version = "0.1"
repo_fingerprint = "${FP}"

[[entries]]
id = "aaa11111"
kind = "gotcha"
topic = "windows-shell"
content = "spawnSync needs shell:true on Windows"
at = "2026-05-08T00:00:00.000Z"
by = "human:test"

[[entries]]
id = "bbb22222"
kind = "decision"
topic = "render-toml"
content = "hand-roll TOML"
at = "2026-05-08T00:00:01.000Z"
by = "human:test"
tags = ["v07", "schema"]

[[entries]]
id = "ccc33333"
kind = "convention"
topic = "rendering details"
content = "see render-toml entry for hand-roll discussion"
at = "2026-05-08T00:00:02.000Z"
by = "human:test"
`;

let tmpDir: string;
const origCwd = process.cwd();

beforeEach(() => {
  _setEmbedderForTesting(null); // force degraded (lexical-only) mode by default
  tmpDir = mkdtempSync(join(tmpdir(), "anat-mcp-mem-"));
  execSync("git init", { cwd: tmpDir, stdio: "ignore", shell: true });
  writeFileSync(join(tmpDir, ".anatomy"), ANATOMY);
  writeFileSync(join(tmpDir, ".anatomy-memory"), MEMORY);
  process.chdir(tmpDir);
});

afterEach(() => {
  _setEmbedderForTesting(undefined);
  process.chdir(origCwd);
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

describe("anatomy_memory_search", () => {
  it("returns all entries when no filters given", async () => {
    const out = await memoryToolHandlers.anatomy_memory_search({});
    if ("error" in out) throw new Error("expected success");
    expect((out.data as unknown[]).length).toBe(3);
  });

  it("filters by kind", async () => {
    const out = await memoryToolHandlers.anatomy_memory_search({ kind: "gotcha" });
    if ("error" in out) throw new Error("expected success");
    const arr = out.data as Array<{ id: string }>;
    expect(arr).toHaveLength(1);
    expect(arr[0].id).toBe("aaa11111");
  });

  it("substring-matches the query against topic and content", async () => {
    const out = await memoryToolHandlers.anatomy_memory_search({ query: "windows" });
    if ("error" in out) throw new Error("expected success");
    expect((out.data as unknown[]).length).toBe(1);
  });

  it("ANDs filters with query", async () => {
    const out = await memoryToolHandlers.anatomy_memory_search({ query: "TOML", kind: "decision" });
    if ("error" in out) throw new Error("expected success");
    const arr = out.data as Array<{ id: string }>;
    expect(arr).toHaveLength(1);
    expect(arr[0].id).toBe("bbb22222");
  });

  it("multiple tokens matching different fields of one entry score that entry highest", async () => {
    // bbb22222 has the single token "render-toml" in topic (hyphens preserved by tokenizer)
    // and tokens "hand-roll" + "toml" in content. A query of "render-toml hand-roll"
    // with kind filter to decision matches BOTH tokens in bbb22222 (topic + content).
    // ccc33333 also contains these tokens but is convention kind. Filtering to decision
    // ensures bbb22222 is the only result.
    const out = await memoryToolHandlers.anatomy_memory_search({ query: "render-toml hand-roll", kind: "decision" });
    if ("error" in out) throw new Error("expected success");
    const arr = out.data as Array<{ id: string }>;
    expect(arr).toHaveLength(1);
    expect(arr[0].id).toBe("bbb22222");
  });

  it("OR-semantics: query tokens matching different entries surface both", async () => {
    // "toml" matches bbb22222 (content), "windows" matches aaa11111 (content).
    // Under BM25F OR-semantics, both entries score > 0 and both surface.
    const out = await memoryToolHandlers.anatomy_memory_search({ query: "toml windows" });
    if ("error" in out) throw new Error("expected success");
    const arr = out.data as Array<{ id: string }>;
    expect(arr.length).toBe(2);
    const ids = arr.map(r => r.id).sort();
    expect(ids).toEqual(["aaa11111", "bbb22222"]);
  });

  it("topic match outranks content-only match for the same token", async () => {
    // bbb22222 has "render-toml" in TOPIC (field weight 3.0).
    // ccc33333 has "render-toml" in CONTENT (field weight 1.0).
    // Both score > 0; bbb22222 ranks first because of topic-field weighting.
    const out = await memoryToolHandlers.anatomy_memory_search({ query: "render-toml" });
    if ("error" in out) throw new Error("expected success");
    const arr = out.data as Array<{ id: string }>;
    expect(arr.length).toBe(2);
    expect(arr[0].id).toBe("bbb22222");
    expect(arr[1].id).toBe("ccc33333");
  });

  it("returns bm25_score and decay_bucket on each result", async () => {
    const out = await memoryToolHandlers.anatomy_memory_search({ query: "windows" });
    if ("error" in out) throw new Error("expected success");
    const arr = out.data as Array<{ id: string; bm25_score: number; decay_bucket: string }>;
    expect(arr.length).toBe(1);
    expect(typeof arr[0].bm25_score).toBe("number");
    expect(arr[0].bm25_score).toBeGreaterThan(0);
    expect(typeof arr[0].decay_bucket).toBe("string");
  });

  it("tag-only match exposes positive bm25_score and decay_bucket on result", async () => {
    // v07 appears only in bbb22222's tags. The result surfaces the new BM25 envelope
    // fields (bm25_score > 0, decay_bucket string). Complementary to the existing
    // "matches query tokens against tags" test which only checks length and id.
    const out = await memoryToolHandlers.anatomy_memory_search({ query: "v07" });
    if ("error" in out) throw new Error("expected success");
    const arr = out.data as Array<{ id: string; bm25_score: number; decay_bucket: string }>;
    expect(arr.length).toBe(1);
    expect(arr[0].id).toBe("bbb22222");
    expect(arr[0].bm25_score).toBeGreaterThan(0);
    expect(typeof arr[0].decay_bucket).toBe("string");
  });

  it("matches query tokens against tags as well as topic and content", async () => {
    // "v07" appears only in bbb22222's tags, not in any topic or content.
    const out = await memoryToolHandlers.anatomy_memory_search({ query: "v07" });
    if ("error" in out) throw new Error("expected success");
    const arr = out.data as Array<{ id: string }>;
    expect(arr).toHaveLength(1);
    expect(arr[0].id).toBe("bbb22222");
  });

  it("treats whitespace-only query as no-op (returns all)", async () => {
    const out = await memoryToolHandlers.anatomy_memory_search({ query: "   " });
    if ("error" in out) throw new Error("expected success");
    expect((out.data as unknown[]).length).toBe(3);
  });

  it("returns memory_not_found_for_anatomy when memory file is missing", async () => {
    rmSync(join(tmpDir, ".anatomy-memory"));
    const out = await memoryToolHandlers.anatomy_memory_search({});
    expect(out).toMatchObject({ error: "memory_not_found_for_anatomy" });
  });
});

describe("anatomy_memory_show", () => {
  it("returns full detail for a known id", async () => {
    const out = await memoryToolHandlers.anatomy_memory_show({ id: "aaa11111" });
    if ("error" in out) throw new Error("expected success");
    expect(out.data).toMatchObject({ entry: { id: "aaa11111", topic: "windows-shell" } });
  });

  it("returns invalid_id for unknown id", async () => {
    const out = await memoryToolHandlers.anatomy_memory_show({ id: "zzzzzzzz" });
    expect(out).toMatchObject({ error: "invalid_id", id: "zzzzzzzz" });
  });
});

describe("anatomy_memory_stats", () => {
  it("returns per-kind active counts", async () => {
    const out = await memoryToolHandlers.anatomy_memory_stats({});
    if ("error" in out) throw new Error("expected success");
    expect(out.data).toMatchObject({ gotcha: { active: 1 }, decision: { active: 1 }, convention: { active: 1 } });
  });

  it("includes per-kind decay-bucket counts (v0.2)", async () => {
    const out = await memoryToolHandlers.anatomy_memory_stats({});
    if ("error" in out) throw new Error("expected success");
    // All three fixture entries have no last_verified_at field → bucket = untouched.
    expect(out.data).toMatchObject({
      gotcha: { active: 1, decay: { fresh: 0, aging: 0, stale: 0, untouched: 1 } },
      decision: { active: 1, decay: { fresh: 0, aging: 0, stale: 0, untouched: 1 } },
      convention: { active: 1, decay: { fresh: 0, aging: 0, stale: 0, untouched: 1 } },
    });
  });
});

describe("anatomy_memory_search — v0.2 decay ranking", () => {
  // Build a fresh memory file with explicitly-mixed verification dates so the
  // decay buckets and rank multipliers can be observed directly.
  const NOW_ISO = new Date().toISOString();
  const RECENT = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();    // 5 days ago → fresh
  const AGING = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();    // 90 days ago → aging
  const STALE = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();   // 365 days ago → stale

  const RANKED_MEMORY = `anatomy_memory_version = "0.2"
repo_fingerprint = "${FP}"

[[entries]]
id = "fresh001"
kind = "gotcha"
topic = "all-shared-token"
content = "fresh entry"
at = "2026-01-01T00:00:00.000Z"
by = "human:test"
last_verified_at = "${RECENT}"
verified_by = ["human:test"]

[[entries]]
id = "aging001"
kind = "gotcha"
topic = "all-shared-token"
content = "aging entry"
at = "2026-01-01T00:00:00.000Z"
by = "human:test"
last_verified_at = "${AGING}"
verified_by = ["human:test"]

[[entries]]
id = "stale001"
kind = "gotcha"
topic = "all-shared-token"
content = "stale entry"
at = "2026-01-01T00:00:00.000Z"
by = "human:test"
last_verified_at = "${STALE}"
verified_by = ["human:test"]

[[entries]]
id = "untoucha"
kind = "gotcha"
topic = "all-shared-token"
content = "untouched entry"
at = "${NOW_ISO}"
by = "human:test"
`;

  beforeEach(() => {
    writeFileSync(join(tmpDir, ".anatomy-memory"), RANKED_MEMORY);
  });

  it("annotates each result with decay_bucket", async () => {
    const out = await memoryToolHandlers.anatomy_memory_search({ kind: "gotcha" });
    if ("error" in out) throw new Error("expected success");
    const arr = out.data as Array<{ id: string; decay_bucket: string }>;
    const byId = Object.fromEntries(arr.map(e => [e.id, e.decay_bucket]));
    expect(byId.fresh001).toBe("fresh");
    expect(byId.aging001).toBe("aging");
    expect(byId.stale001).toBe("stale");
    expect(byId.untoucha).toBe("untouched");
  });

  it("ranks by decay × recency (fresh > untouched-new > aging-90d > stale)", async () => {
    const out = await memoryToolHandlers.anatomy_memory_search({ kind: "gotcha" });
    if ("error" in out) throw new Error("expected success");
    const arr = out.data as Array<{ id: string }>;
    // Empty-query path in the BM25 orchestrator ranks by decay_multiplier × recency
    // (recency = exp(-ageMs / ONE_YEAR_MS)). "untoucha" has at=NOW so recency≈1.0
    // and combined≈0.7*1.0=0.70, which beats aging001 whose combined≈0.85*exp(-90/365)≈0.66.
    // Order: fresh001 (≈0.99) > untoucha (≈0.70) > aging001 (≈0.66) > stale001 (≈0.22).
    expect(arr.map(e => e.id)).toEqual(["fresh001", "untoucha", "aging001", "stale001"]);
  });
});

describe("anatomy_memory_search — hybrid (embedder available)", () => {
  it("adds dense_score/rrf_score and surfaces a lexically-divergent entry", async () => {
    // ccc33333 ("see render-toml entry for hand-roll discussion") shares no
    // token with the query "serialization ordering"; a fake embedder aligns
    // the query with ccc33333 so the dense arm must surface it.
    _setEmbedderForTesting(async (texts: string[]) =>
      texts.map(t => /serialization ordering|render-toml entry/i.test(t) ? [1, 0, 0] : [0, 1, 0]),
    );
    const out = await memoryToolHandlers.anatomy_memory_search({ query: "serialization ordering" });
    if ("error" in out) throw new Error("expected success");
    const arr = out.data as Array<{ id: string; dense_score: number | null; rrf_score: number | null }>;
    const ids = arr.map(r => r.id);
    expect(ids).toContain("ccc33333");
    const hit = arr.find(r => r.id === "ccc33333")!;
    expect(hit.rrf_score).not.toBeNull();
    expect(typeof hit.dense_score).toBe("number");
  });

  it("degrades to identical legacy output when embedder is null", async () => {
    _setEmbedderForTesting(null);
    const out = await memoryToolHandlers.anatomy_memory_search({ query: "windows" });
    if ("error" in out) throw new Error("expected success");
    const arr = out.data as Array<{ id: string; bm25_score: number; rrf_score?: unknown }>;
    expect(arr.length).toBe(1);
    expect(arr[0].id).toBe("aaa11111");
    expect(arr[0].bm25_score).toBeGreaterThan(0);
    expect("rrf_score" in arr[0]).toBe(false); // legacy shape: no new keys
  });

  it("degrades to legacy (no error) when the embedder throws per-call", async () => {
    _setEmbedderForTesting(async () => { throw new Error("transient model failure"); });
    const out = await memoryToolHandlers.anatomy_memory_search({ query: "windows" });
    if ("error" in out) throw new Error("expected success, not a thrown error");
    const arr = out.data as Array<{ id: string; bm25_score: number; rrf_score?: unknown }>;
    expect(arr.length).toBe(1);
    expect(arr[0].id).toBe("aaa11111");
    expect("rrf_score" in arr[0]).toBe(false);
  });
});
