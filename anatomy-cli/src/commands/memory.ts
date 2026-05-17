// src/commands/memory.ts
// `anatomy memory <subcommand>` dispatcher.
// Subcommands: deprecate, list, grep, search, show, stats, thanks, credits, verify

import { patchEntryField, parseMemoryDoc, readMemoryFile, recordThanks, recordVerification, type MemoryEntry } from "../memory/io.js";
import { resolveAnatomy } from "../resolve.js";
import { searchMemoryHybrid, type HybridVectors } from "../memory/search.js";
import { buildOrLoadMemoryEmbeddings, memoryEmbeddingsPath } from "../memory/embed.js";
import { embedQuery } from "../embed/index.js";
import { detectBy } from "../memory/attribution.js";
import { decayBucket, bucketCounts } from "../memory/decay.js";

export interface MemoryOptions {
  reason?: string;
  kind?: string;
  topic?: string;
  ref?: string;
  tag?: string;
  limit?: number;
  includeSuperseded?: boolean;
  onlyFresh?: boolean;
}

export async function memoryCommand(positional: string[], opts: MemoryOptions): Promise<number> {
  const subcommand = positional[0];
  const rest = positional.slice(1);
  switch (subcommand) {
    case "deprecate": return deprecateSub(rest, opts);
    case "list":      return listSub(rest, opts);
    case "grep":      return grepSub(rest, opts);
    case "search":    return searchSub(rest, opts);
    case "show":      return showSub(rest, opts);
    case "stats":     return statsSub(rest, opts);
    case "thanks":    return thanksSub(rest, opts);
    case "credits":   return creditsSub(rest, opts);
    case "verify":    return verifySub(rest, opts);
    default:
      if (subcommand === undefined) {
        process.stderr.write(`anatomy memory: missing subcommand.\n`);
      } else {
        process.stderr.write(`anatomy memory: unknown subcommand "${subcommand}".\n`);
      }
      process.stderr.write(`Available: deprecate, list, grep, search, show, stats, thanks, credits, verify\n`);
      return 1;
  }
}

function deprecateSub(args: string[], opts: MemoryOptions): number {
  const id = args[0];
  if (!id) {
    process.stderr.write(`anatomy memory deprecate: usage: anatomy memory deprecate <id> --reason <text>\n`);
    return 1;
  }
  if (!opts.reason) {
    process.stderr.write(`anatomy memory deprecate: --reason is required\n`);
    return 1;
  }
  const repoRoot = process.cwd();
  const text = readMemoryFile(repoRoot);
  if (!text) {
    process.stderr.write(`anatomy memory deprecate: no .anatomy-memory in ${repoRoot}\n`);
    return 1;
  }
  const doc = parseMemoryDoc(text);
  const target = doc.entries.find(e => e.id === id);
  if (!target) {
    process.stderr.write(`anatomy memory deprecate: no entry with id ${JSON.stringify(id)}\n`);
    return 1;
  }
  if (target.deprecated_at) {
    process.stderr.write(`anatomy memory deprecate: entry ${id} is already deprecated (reason: ${target.deprecated_reason ?? "<none>"})\n`);
    return 1;
  }
  const at = new Date().toISOString();
  try {
    patchEntryField(repoRoot, id, "deprecated_at", at);
    patchEntryField(repoRoot, id, "deprecated_reason", opts.reason);
  } catch (err) {
    process.stderr.write(`anatomy memory deprecate: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
  process.stdout.write(`✓ deprecated ${id}: ${opts.reason}\n`);
  return 0;
}

function listSub(_args: string[], opts: MemoryOptions): number {
  const repoRoot = process.cwd();
  const text = readMemoryFile(repoRoot);
  if (!text) {
    process.stderr.write(`anatomy memory list: no .anatomy-memory in ${repoRoot}\n`);
    return 1;
  }
  const doc = parseMemoryDoc(text);
  const now = new Date();
  const filtered = doc.entries.filter((e: MemoryEntry) => {
    if (!opts.includeSuperseded && (e.superseded_by || e.deprecated_at)) return false;
    if (opts.kind && e.kind !== opts.kind) return false;
    if (opts.topic && !e.topic.toLowerCase().includes(opts.topic.toLowerCase())) return false;
    if (opts.ref && !(e.refs ?? []).some(r => r.includes(opts.ref!))) return false;
    if (opts.tag && !(e.tags ?? []).includes(opts.tag)) return false;
    if (opts.onlyFresh && decayBucket(e, now) !== "fresh") return false;
    return true;
  });
  if (filtered.length === 0) {
    process.stdout.write("(no entries match)\n");
    return 0;
  }
  process.stdout.write(
    `${"id".padEnd(9)} ${"kind".padEnd(11)} ${"at".padEnd(21)} ${"by".padEnd(20)} ${"decay".padEnd(10)} topic\n`,
  );
  for (const e of filtered) {
    const status = e.superseded_by ? " [superseded]" : e.deprecated_at ? " [deprecated]" : "";
    const bucket = decayBucket(e, now);
    process.stdout.write(
      `${e.id.padEnd(9)} ${e.kind.padEnd(11)} ${e.at.slice(0, 19).padEnd(21)} ${e.by.padEnd(20)} ${bucket.padEnd(10)} ${e.topic}${status}\n`,
    );
  }
  return 0;
}

function grepSub(args: string[], opts: MemoryOptions): number {
  const query = args[0];
  if (!query) {
    process.stderr.write(`anatomy memory grep: usage: anatomy memory grep "<query>"\n`);
    return 1;
  }
  const repoRoot = process.cwd();
  const text = readMemoryFile(repoRoot);
  if (!text) {
    process.stderr.write(`anatomy memory grep: no .anatomy-memory in ${repoRoot}\n`);
    return 1;
  }
  const doc = parseMemoryDoc(text);
  const q = query.toLowerCase();
  const matches = doc.entries
    .filter(e => opts.includeSuperseded || (!e.superseded_by && !e.deprecated_at))
    .filter(e => e.topic.toLowerCase().includes(q) || e.content.toLowerCase().includes(q))
    .reverse(); // newest first
  if (matches.length === 0) {
    process.stdout.write(`(no match for "${query}")\n`);
    return 0;
  }
  process.stdout.write(`## Memory matches for "${query}" (${matches.length})\n\n`);
  for (const e of matches) {
    const status = e.superseded_by ? " [superseded]" : e.deprecated_at ? " [deprecated]" : "";
    process.stdout.write(`[${e.id}] ${e.kind} · ${e.at.slice(0, 10)} · ${e.by} — ${e.topic}${status}\n`);
    process.stdout.write(`  ${e.content}\n\n`);
  }
  return 0;
}

const SEARCH_CONTENT_TRUNCATE = 200;
const SEARCH_DEFAULT_LIMIT = 10;

/** Fingerprint that keys the shared embedding cache. Resolved from .anatomy
 *  identity.fingerprint via the exact same path the MCP tool uses
 *  (src/mcp/memory-tools.ts loadMemory), so CLI and MCP always read/write one
 *  cache file even if .anatomy-memory's repo_fingerprint header has drifted
 *  (stale, hand-edited, or copied between repos). When .anatomy cannot be
 *  resolved (absent or invalid — CLI memory subcommands operate on
 *  .anatomy-memory alone, and MCP cannot run at all without .anatomy so there
 *  is no path to diverge from) fall back to the header, preserving the
 *  pre-resolution behavior.
 *
 *  resolveAnatomy validates and spawns git (staleness) per call, matching the
 *  cost the MCP path already pays — accepted so both derive the key identically. */
async function embeddingCacheFingerprint(
  repoRoot: string,
  memoryHeaderFingerprint: string,
): Promise<string> {
  const r = await resolveAnatomy(repoRoot);
  if ("error" in r) return memoryHeaderFingerprint;
  // Deliberately the same loosely-typed extraction as memory-tools.ts:loadMemory
  // (and validate-tree.ts): the post-validation doc *should* carry a string
  // identity.fingerprint, but the optional-chain + "" fallback is mirrored
  // verbatim so the two code paths cannot diverge in their null handling — that
  // divergence is exactly the class of bug this function exists to prevent.
  return (r.doc as unknown as { identity?: { fingerprint?: string } }).identity?.fingerprint ?? "";
}

async function searchSub(args: string[], opts: MemoryOptions): Promise<number> {
  const query = args[0];
  if (!query) {
    process.stderr.write(`anatomy memory search: usage: anatomy memory search "<query>" [--kind <k>] [--tag <t>] [--ref <s>] [--limit <n>] [--include-superseded]\n`);
    return 1;
  }
  const repoRoot = process.cwd();
  const text = readMemoryFile(repoRoot);
  if (!text) {
    process.stderr.write(`anatomy memory search: no .anatomy-memory in ${repoRoot}\n`);
    return 1;
  }
  const doc = parseMemoryDoc(text);
  const limit = typeof opts.limit === "number" ? opts.limit : SEARCH_DEFAULT_LIMIT;

  // Mirrors the MCP anatomy_memory_search handler (src/mcp/memory-tools.ts) so
  // CLI and MCP rank identically. The embed cache and embedQuery both degrade
  // to "no vectors" when @xenova/transformers is absent (or
  // ANATOMY_DISABLE_EMBEDDINGS is set), so searchMemoryHybrid returns exact
  // legacy BM25F×decay output in that case.
  let vectors: HybridVectors | undefined;
  if (query.trim().length > 0) {
    const fingerprint = await embeddingCacheFingerprint(repoRoot, doc.repo_fingerprint);
    const entryVecs = await buildOrLoadMemoryEmbeddings(
      doc.entries,
      memoryEmbeddingsPath(fingerprint),
    );
    const queryVec = entryVecs.size > 0 ? await embedQuery(query) : null;
    vectors = { queryVec, entryVecs };
  }
  const results = searchMemoryHybrid(doc.entries, {
    query,
    kind: opts.kind,
    topic: opts.topic,
    tag: opts.tag,
    ref: opts.ref,
    includeSuperseded: opts.includeSuperseded,
    limit,
  }, vectors);
  if (results.length === 0) {
    process.stdout.write(`(no match for "${query}")\n`);
    return 0;
  }
  // rrf_score is non-null iff the dense arm engaged; in degraded mode every
  // result is null and the ranking is exactly the legacy BM25F × decay.
  const ranking = results.some(r => r.rrf_score !== null)
    ? "hybrid BM25F+dense RRF × decay"
    : "BM25F × decay";
  process.stdout.write(`## Memory search results for "${query}" (${results.length} matches, ranked by ${ranking})\n\n`);
  for (const r of results) {
    const e = r.entry;
    const status = e.superseded_by ? " [superseded]" : e.deprecated_at ? " [deprecated]" : "";
    const truncated = e.content.length > SEARCH_CONTENT_TRUNCATE
      ? e.content.slice(0, SEARCH_CONTENT_TRUNCATE - 1) + "…"
      : e.content;
    process.stdout.write(
      `[${e.id}] ${e.kind} · ${e.at.slice(0, 10)} · ${e.by} — ${e.topic}${status}  (${r.decay_bucket})\n`,
    );
    process.stdout.write(`  ${truncated}\n\n`);
  }
  return 0;
}

function showSub(args: string[], _opts: MemoryOptions): number {
  const id = args[0];
  if (!id) {
    process.stderr.write(`anatomy memory show: usage: anatomy memory show <id>\n`);
    return 1;
  }
  const repoRoot = process.cwd();
  const text = readMemoryFile(repoRoot);
  if (!text) {
    process.stderr.write(`anatomy memory show: no .anatomy-memory in ${repoRoot}\n`);
    return 1;
  }
  const doc = parseMemoryDoc(text);
  const entry = doc.entries.find(e => e.id === id);
  if (!entry) {
    process.stderr.write(`anatomy memory show: no entry with id ${JSON.stringify(id)}\n`);
    return 1;
  }
  // Full TOML-like dump of the entry plus supersession chain
  const out: string[] = [];
  out.push(`id           = ${entry.id}`);
  out.push(`kind         = ${entry.kind}`);
  out.push(`topic        = ${entry.topic}`);
  out.push(`at           = ${entry.at}`);
  out.push(`by           = ${entry.by}`);
  out.push(`content      = ${entry.content}`);
  if (entry.refs?.length) out.push(`refs         = [${entry.refs.join(", ")}]`);
  if (entry.tags?.length) out.push(`tags         = [${entry.tags.join(", ")}]`);
  if (entry.superseded_by) {
    out.push(`superseded_by = ${entry.superseded_by}`);
    const next = doc.entries.find(e => e.id === entry.superseded_by);
    if (next) out.push(`  → ${next.kind} · ${next.topic}: ${next.content}`);
  }
  if (entry.deprecated_at) out.push(`deprecated_at = ${entry.deprecated_at}`);
  if (entry.deprecated_reason) out.push(`deprecated_reason = ${entry.deprecated_reason}`);
  // Reverse: who supersedes me
  const supersededBy = doc.entries.filter(e => e.superseded_by === entry.id);
  if (supersededBy.length > 0) {
    out.push(`supersedes:`);
    for (const e of supersededBy) out.push(`  ${e.id} (${e.kind}: ${e.topic})`);
  }
  process.stdout.write(out.join("\n") + "\n");
  return 0;
}

function thanksSub(args: string[], _opts: MemoryOptions): number {
  const id = args[0];
  if (!id) {
    process.stderr.write(`anatomy memory thanks: usage: anatomy memory thanks <id>\n`);
    return 1;
  }
  const repoRoot = process.cwd();
  const by = detectBy(repoRoot);
  if (by === "unknown" || by === "claude-session" || by.startsWith("claude-session:")) {
    process.stderr.write(
      `anatomy memory thanks: cannot record thanks from ${JSON.stringify(by)} — set ANATOMY_BY=human:<handle> or configure git user.email\n`,
    );
    return 1;
  }
  const r = recordThanks(repoRoot, id, by);
  if (!r.ok) {
    if (r.reason === "no-memory") {
      process.stderr.write(`anatomy memory thanks: no .anatomy-memory in ${repoRoot}\n`);
    } else {
      process.stderr.write(`anatomy memory thanks: no entry with id ${JSON.stringify(id)}\n`);
    }
    return 1;
  }
  if (r.alreadyThanked) {
    process.stdout.write(`(already thanked ${id} as ${by}; helped_count=${r.helpedCount})\n`);
  } else {
    process.stdout.write(`✓ thanks recorded for ${id} (helped_count=${r.helpedCount})\n`);
  }
  return 0;
}

interface CreditsRow {
  handle: string;        // canonical display, e.g. "@alice" or "claude-session"
  linkable: boolean;     // true → render GitHub URL
  contributions: number; // active entries authored
  helpedOthers: number;  // sum of helped_count across authored entries
  thankedOthers: number; // count of times this handle appears in any helped_by
}

// @alice and human:alice both normalize to @alice and merge in the credits Map.
// The bare `@<handle>` form is accepted (and schema-valid in helped_by) for
// hand-edited entries, but detectBy() never produces it on its own.
function normalizeForCredits(by: string): { handle: string; linkable: boolean } | null {
  if (!by || by === "unknown") return null;
  if (by.startsWith("@")) return { handle: by, linkable: /^@[a-z0-9._-]+$/i.test(by) };
  if (by.startsWith("human:")) {
    const local = by.slice("human:".length);
    return { handle: `@${local}`, linkable: /^[a-z0-9._-]+$/i.test(local) };
  }
  if (by === "claude-session" || by.startsWith("claude-session:")) {
    return { handle: by, linkable: false };
  }
  return null;
}

function creditsSub(_args: string[], _opts: MemoryOptions): number {
  const repoRoot = process.cwd();
  const text = readMemoryFile(repoRoot);
  if (!text) {
    process.stderr.write(`anatomy memory credits: no .anatomy-memory in ${repoRoot}\n`);
    return 1;
  }
  const doc = parseMemoryDoc(text);
  const rows = new Map<string, CreditsRow>();
  function ensure(handle: string, linkable: boolean): CreditsRow {
    let r = rows.get(handle);
    if (!r) {
      r = { handle, linkable, contributions: 0, helpedOthers: 0, thankedOthers: 0 };
      rows.set(handle, r);
    }
    return r;
  }
  for (const e of doc.entries) {
    const isObsolete = !!e.superseded_by || !!e.deprecated_at;
    if (!isObsolete) {
      const author = normalizeForCredits(e.by);
      if (author) {
        const row = ensure(author.handle, author.linkable);
        row.contributions += 1;
        // Use helped_by.length (not helped_count) so credits stays authoritative
        // even if the cached helped_count drifts after a hand-edit.
        row.helpedOthers += (e.helped_by ?? []).length;
      }
    }
    // Thanker counts include obsolete entries: thanks recorded before
    // deprecation represent real activity at the time and shouldn't be erased.
    for (const t of e.helped_by ?? []) {
      const thanker = normalizeForCredits(t);
      if (thanker) {
        const row = ensure(thanker.handle, thanker.linkable);
        row.thankedOthers += 1;
      }
    }
  }
  const sorted = [...rows.values()].sort((a, b) => {
    if (b.helpedOthers !== a.helpedOthers) return b.helpedOthers - a.helpedOthers;
    if (b.contributions !== a.contributions) return b.contributions - a.contributions;
    return a.handle.localeCompare(b.handle);
  });

  const lines: string[] = [];
  lines.push("# Memory Contributors");
  lines.push("");
  lines.push("People who've contributed to this repo's memory file (`.anatomy-memory`).");
  lines.push("Counts include only active entries (deprecated/superseded excluded).");
  lines.push("");
  lines.push("| Contributor | Entries | Helped others | Thanked others |");
  lines.push("|---|---:|---:|---:|");
  for (const r of sorted) {
    const display = r.linkable && r.handle.startsWith("@")
      ? `[${r.handle}](https://github.com/${r.handle.slice(1)})`
      : r.handle;
    lines.push(`| ${display} | ${r.contributions} | ${r.helpedOthers} | ${r.thankedOthers} |`);
  }
  process.stdout.write(lines.join("\n") + "\n");
  return 0;
}

function statsSub(_args: string[], _opts: MemoryOptions): number {
  const repoRoot = process.cwd();
  const text = readMemoryFile(repoRoot);
  if (!text) {
    process.stderr.write(`anatomy memory stats: no .anatomy-memory in ${repoRoot}\n`);
    return 1;
  }
  const doc = parseMemoryDoc(text);
  const kinds: Array<"gotcha" | "decision" | "convention" | "attempt" | "milestone"> =
    ["gotcha", "decision", "convention", "attempt", "milestone"];
  const now = new Date();
  for (const k of kinds) {
    const all = doc.entries.filter(e => e.kind === k);
    const active = all.filter(e => !e.superseded_by && !e.deprecated_at);
    const superseded = all.filter(e => !!e.superseded_by).length;
    const deprecated = all.filter(e => !!e.deprecated_at).length;
    const buckets = bucketCounts(active, now);
    process.stdout.write(`${(k + ":").padEnd(12)} ${active.length} active`);
    if (active.length > 0) {
      const parts: string[] = [];
      if (buckets.fresh > 0) parts.push(`fresh: ${buckets.fresh}`);
      if (buckets.aging > 0) parts.push(`aging: ${buckets.aging}`);
      if (buckets.stale > 0) parts.push(`stale: ${buckets.stale}`);
      if (buckets.untouched > 0) parts.push(`untouched: ${buckets.untouched}`);
      if (parts.length > 0) process.stdout.write(` (${parts.join(", ")})`);
    }
    if (superseded > 0) process.stdout.write(` · ${superseded} superseded`);
    if (deprecated > 0) process.stdout.write(` · ${deprecated} deprecated`);
    process.stdout.write("\n");
  }
  return 0;
}

function verifySub(args: string[], _opts: MemoryOptions): number {
  const id = args[0];
  if (!id) {
    process.stderr.write(`anatomy memory verify: usage: anatomy memory verify <id>\n`);
    return 1;
  }
  const repoRoot = process.cwd();
  const by = detectBy(repoRoot);
  if (by === "unknown") {
    process.stderr.write(
      `anatomy memory verify: cannot record verification from "unknown" — set ANATOMY_BY=human:<handle> or configure git user.email\n`,
    );
    return 1;
  }
  const r = recordVerification(repoRoot, id, by);
  if (!r.ok) {
    if (r.reason === "no-memory") {
      process.stderr.write(`anatomy memory verify: no .anatomy-memory in ${repoRoot}\n`);
    } else {
      process.stderr.write(`anatomy memory verify: no entry with id ${JSON.stringify(id)}\n`);
    }
    return 1;
  }
  process.stdout.write(`✓ verified ${id} as ${by} at ${r.verifiedAt}\n`);
  if (r.bumpedVersion) {
    process.stdout.write(`  (bumped .anatomy-memory header to anatomy_memory_version = "0.2")\n`);
  }
  return 0;
}
