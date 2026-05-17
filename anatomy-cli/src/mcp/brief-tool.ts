// src/mcp/brief-tool.ts
// Handler for anatomy_brief — primary discovery MCP tool. Returns rules,
// memory entries, and flows scoped to query/file_path/both in one envelope.
// See docs/superpowers/specs/2026-05-14-anatomy-brief-tool-design.md.

import { resolve as pathResolve, matchesGlob } from "node:path";
import { resolveAnatomy } from "../resolve.js";
import { wrapError, type SuccessEnvelope, type ErrorEnvelope } from "./envelope.js";
import { recordTelemetry } from "../telemetry.js";
import { loadEmbedder, embedQuery, cosine } from "../embed/index.js";
import { readMemoryFile, parseMemoryDoc } from "../memory/io.js";
import { searchMemory } from "../memory/search.js";
import type { Rule, Flow } from "../types.js";

/** Extract glob strings from a rule's verify block. Returns [] for rules
 *  without a verify clause or with no glob-bearing fields. */
function extractGlobs(rule: Rule): string[] {
  const v = rule.verify as Record<string, unknown> | undefined;
  if (!v || typeof v !== "object") return [];
  const out: string[] = [];
  for (const key of ["path", "expect_in", "forbid_in", "match", "container"] as const) {
    const val = v[key];
    if (typeof val === "string" && val.length > 0) out.push(val);
  }
  return out;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

/** True if `file_path` matches any of `globs`. Uses Node 22's path.matchesGlob. */
function anyGlobMatches(file_path: string, globs: string[]): boolean {
  const norm = normalizePath(file_path);
  for (const g of globs) {
    if (matchesGlob(norm, g)) return true;
  }
  return false;
}

type Args = Record<string, unknown>;
type ToolResult<T> = SuccessEnvelope<T> | ErrorEnvelope;

export interface BriefRule {
  rule: string;
  why?: string;
  score: number;
  reason: "glob" | "embed" | "default";
}

export interface BriefMemory {
  id: string;
  kind: string;
  topic: string;
  content: string;
  at: string;
  last_verified_at?: string;
  bm25_score: number;
  decay_bucket: "fresh" | "aging" | "untouched" | "stale";
}

export interface BriefFlow {
  name: string;
  summary: string;
  score?: number;
}

// v0.15 section entries — surfacing logic lands in tasks 8-11; for now these
// types lock the response shape so consumers can rely on the surface area.
// Note: anti_patterns already has an entry-level `reason` field, so its
// score-explanation field is named `reason_kind` to avoid collision.
export interface BriefVocabulary {
  term: string;
  meaning: string;
  aliases?: string[];
  contrast?: string[];
  score: number;
  reason: "exact-token" | "embed";
}

export interface BriefInvariant {
  invariant: string;
  triggered_by?: string[];
  affected_paths?: string[];
  why?: string;
  score: number;
  reason: "file_path" | "embed";
}

export interface BriefAntiPattern {
  pattern: string;
  reason: string;
  instead?: string;
  keywords?: string[];
  score: number;
  reason_kind: "keyword" | "embed";
}

export interface BriefPrerequisite {
  topic: string;
  why: string;
  link?: string;
  score: number;
  reason: "onboarding";
}

export interface BriefData {
  identity: unknown;
  tagline: string;
  rules: BriefRule[];
  memory: BriefMemory[];
  flows: BriefFlow[];
  vocabulary?: BriefVocabulary[];
  invariants?: BriefInvariant[];
  anti_patterns?: BriefAntiPattern[];
  prerequisites?: BriefPrerequisite[];
  hint?: string;
}

const DEFAULT_RULE_LIMIT = 5;
const DEFAULT_MEMORY_LIMIT = 5;
const DEFAULT_FLOW_LIMIT = 3;
const DEFAULT_VOCAB_LIMIT = 5;
const DEFAULT_INVARIANT_LIMIT = 5;
const DEFAULT_ANTI_PATTERN_LIMIT = 3;
const DEFAULT_PREREQUISITE_LIMIT = 3;

// EMBED_THRESHOLD: minimum cosine similarity for a rule/flow to be returned
// via the embed path. 0.4 is the initial value; calibrated against this
// repo's rules in tests/mcp-brief-tool.test.ts ("calibration" suite) with
// queries like "semgrep windows", "how do tests work".
const EMBED_THRESHOLD = 0.4;

// PLANNING_LEXICON: lowercase phrases that signal an agent is about to make
// a design choice (rather than describing existing code). Anti-patterns
// surface aggressively when this lexicon hits — that's the whole point of
// the section, catching "should I wrap req in a class" before it ships. The
// list is intentionally short; expansion is data-driven from telemetry.
const PLANNING_LEXICON: readonly string[] = [
  "should i",
  "plan to",
  "thinking about",
  "considering",
  "going to",
  "implementing",
  "adding",
  "want to use",
  "replace with",
  "looking at",
  "trying to",
];

/** True if `query` (case-insensitive) contains any planning-language phrase
 *  from PLANNING_LEXICON as a substring. Gates the anti_patterns threshold
 *  and the *1.4 score multiplier in rankAntiPatterns. */
function hasPlanningLanguage(query: string): boolean {
  const q = query.toLowerCase();
  for (const phrase of PLANNING_LEXICON) {
    if (q.includes(phrase)) return true;
  }
  return false;
}

// ONBOARDING_LEXICON: lowercase phrases that signal a "what is this repo /
// where do I start" question. Gates the prerequisites slot — prerequisites
// surface only on these phrases (or empty/missing query) to save tokens on
// task-specific responses. Intentionally permissive: prerequisites are
// valuable when shown, and the file_path branch already suppresses them
// for edit-time work.
const ONBOARDING_LEXICON: readonly string[] = [
  "overview",
  "getting started",
  "first time",
  "new to",
  "explain this repo",
  "what is this",
  "introduction",
];

/** True if `query` is empty/missing OR contains any ONBOARDING_LEXICON
 *  phrase as a case-insensitive substring. Gates the prerequisites slot. */
function isOnboardingQuery(query: string | undefined): boolean {
  if (!query || query.trim() === "") return true;
  const q = query.toLowerCase();
  for (const phrase of ONBOARDING_LEXICON) {
    if (q.includes(phrase)) return true;
  }
  return false;
}

interface RuleEmbedded {
  rule: Rule;
  globs: string[];
  vec: number[] | null;
}

interface FlowEmbedded {
  flow: Flow;
  vec: number[] | null;
}

interface VocabEntry {
  term: string;
  meaning: string;
  aliases?: string[];
  contrast?: string[];
}

interface VocabEmbedded {
  entry: VocabEntry;
  vec: number[] | null;
}

interface InvariantEntry {
  invariant: string;
  triggered_by?: string[];
  affected_paths?: string[];
  why?: string;
}

interface InvariantEmbedded {
  entry: InvariantEntry;
  vec: number[] | null;
}

interface AntiPatternEntry {
  pattern: string;
  reason: string;
  instead?: string;
  keywords?: string[];
}

interface AntiPatternEmbedded {
  entry: AntiPatternEntry;
  vec: number[] | null;
}

interface PrerequisiteEntry {
  topic: string;
  why: string;
  link?: string;
}

interface AnatomyEmbedCache {
  rules: RuleEmbedded[];
  flows: FlowEmbedded[];
  vocab: VocabEmbedded[];
  invariants: InvariantEmbedded[];
  anti_patterns: AntiPatternEmbedded[];
  // Prerequisites are intent-gated and not embedded — handler reads them
  // directly from the doc and passes to rankPrerequisites, so they live
  // outside this cache.
}

const cache = new Map<string, AnatomyEmbedCache>();

function cacheKey(anatomy_path: string, repo_fingerprint: string): string {
  return `${anatomy_path}::${repo_fingerprint}`;
}

async function buildCache(
  rules: Rule[],
  flows: Flow[],
  vocab: VocabEntry[],
  invariants: InvariantEntry[],
  antiPatterns: AntiPatternEntry[],
): Promise<AnatomyEmbedCache> {
  const embedder = await loadEmbedder();
  const ruleTexts = rules.map(r => `${r.rule}\n${r.why ?? ""}`);
  const flowTexts = flows.map(f => `${f.name}\n${f.summary}`);
  // Vocabulary embedding text: term + meaning + aliases joined. Mirrors the
  // surfacing-model spec — the embed pipeline ranks against this combined
  // representation so a query like "router node" can hit a Layer entry whose
  // term alone wouldn't match but whose meaning does.
  const vocabTexts = vocab.map(v => `${v.term}\n${v.meaning}${v.aliases?.length ? "\n" + v.aliases.join(" ") : ""}`);
  // Invariant embedding text: just the `invariant` field. `triggered_by` is
  // for glob-matching against file_path, not semantic — embedding raw glob
  // strings would pollute the vector.
  const invariantTexts = invariants.map(inv => inv.invariant);
  // Anti-pattern embedding text: pattern + reason + instead + keywords. All
  // four contribute semantic content; keywords help when the entry's prose
  // doesn't say the same thing the user's query does.
  const antiTexts = antiPatterns.map(a =>
    `${a.pattern}\n${a.reason}\n${a.instead ?? ""}\n${a.keywords?.join(" ") ?? ""}`,
  );
  const ruleVecs: (number[] | null)[] = embedder
    ? await embedder(ruleTexts)
    : ruleTexts.map(() => null);
  const flowVecs: (number[] | null)[] = embedder
    ? await embedder(flowTexts)
    : flowTexts.map(() => null);
  const vocabVecs: (number[] | null)[] = embedder
    ? await embedder(vocabTexts)
    : vocabTexts.map(() => null);
  const invariantVecs: (number[] | null)[] = embedder
    ? await embedder(invariantTexts)
    : invariantTexts.map(() => null);
  const antiVecs: (number[] | null)[] = embedder
    ? await embedder(antiTexts)
    : antiTexts.map(() => null);
  return {
    rules: rules.map((rule, i) => ({ rule, globs: extractGlobs(rule), vec: ruleVecs[i] })),
    flows: flows.map((flow, i) => ({ flow, vec: flowVecs[i] })),
    vocab: vocab.map((entry, i) => ({ entry, vec: vocabVecs[i] })),
    invariants: invariants.map((entry, i) => ({ entry, vec: invariantVecs[i] })),
    anti_patterns: antiPatterns.map((entry, i) => ({ entry, vec: antiVecs[i] })),
  };
}

async function getCache(
  key: string,
  rules: Rule[],
  flows: Flow[],
  vocab: VocabEntry[],
  invariants: InvariantEntry[],
  antiPatterns: AntiPatternEntry[],
): Promise<AnatomyEmbedCache> {
  const hit = cache.get(key);
  if (hit) return hit;
  const built = await buildCache(rules, flows, vocab, invariants, antiPatterns);
  cache.set(key, built);
  return built;
}

/** Test helper — clear the embedding cache between tests. */
export function _clearBriefCacheForTesting(): void {
  cache.clear();
}

function getPath(args: Args): string {
  const p = args.path;
  return typeof p === "string" ? pathResolve(p) : process.cwd();
}

function getLimit(args: Args, key: string, fallback: number): number {
  const v = args[key];
  return typeof v === "number" && v >= 0 ? v : fallback;
}

/** Rank vocabulary entries against a query. Mirrors the rules embed path:
 *  cosine-similarity above EMBED_THRESHOLD passes through with reason "embed".
 *  An additional +0.5 boost (and reason "exact-token") fires when the query
 *  contains the entry's term or any alias as a case-insensitive substring —
 *  this guarantees exact-term lookups beat fuzzy semantic neighbors, per the
 *  surfacing-model spec.
 *
 *  Returns undefined when no entries pass the threshold so the JSON serializer
 *  omits the key entirely; empty arrays are never returned. */
function rankVocabulary(
  query: string,
  qvec: number[] | null,
  entries: VocabEmbedded[],
  limit: number,
): BriefVocabulary[] | undefined {
  if (entries.length === 0) return undefined;
  const qLower = query.toLowerCase();
  const scored: BriefVocabulary[] = [];
  for (const { entry, vec } of entries) {
    // Exact-token match: query contains the term or any alias as a
    // case-insensitive substring. Substring (not whole-word) per spec —
    // "the Application is busy" should hit the Application entry.
    const termHit = qLower.includes(entry.term.toLowerCase());
    const aliasHit = !termHit && (entry.aliases ?? []).some(a => qLower.includes(a.toLowerCase()));
    const exact = termHit || aliasHit;
    const embedScore = vec && qvec ? cosine(qvec, vec) : 0;
    // Boost applies on top of the embed score; without a vector available
    // (no embedder installed), exact-token alone still surfaces the entry.
    const score = exact ? embedScore + 0.5 : embedScore;
    if (score < EMBED_THRESHOLD) continue;
    scored.push({
      term: entry.term,
      meaning: entry.meaning,
      ...(entry.aliases ? { aliases: entry.aliases } : {}),
      ...(entry.contrast ? { contrast: entry.contrast } : {}),
      score,
      reason: exact ? "exact-token" : "embed",
    });
  }
  if (scored.length === 0) return undefined;
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/** Rank invariants against a query and/or file_path. Per the surfacing-model
 *  spec: file_path is the PRIMARY signal (full score 1.0, reason "file_path");
 *  semantic is fallback. When file_path is provided, ONLY glob-match against
 *  `triggered_by` — do not also run semantic. When file_path matches nothing,
 *  do NOT silently fall back to query either (the agent's edit-time intent is
 *  file-specific). Returns undefined when neither signal is provided, when
 *  there are no invariants to rank, or when the chosen mode yields zero.
 */
function rankInvariants(
  query: string | undefined,
  qvec: number[] | null,
  filePath: string | undefined,
  allInvariants: InvariantEntry[],
  embedded: InvariantEmbedded[],
  limit: number,
): BriefInvariant[] | undefined {
  if (!query && !filePath) return undefined;
  if (allInvariants.length === 0) return undefined;

  // PRIMARY: file_path glob match against triggered_by entries. When file_path
  // is provided, this is the only mode — no semantic fallback even if zero
  // entries match.
  if (filePath) {
    const matched: BriefInvariant[] = [];
    for (const entry of allInvariants) {
      const globs = entry.triggered_by ?? [];
      if (globs.length === 0) continue;
      if (anyGlobMatches(filePath, globs)) {
        matched.push({
          invariant: entry.invariant,
          ...(entry.triggered_by ? { triggered_by: entry.triggered_by } : {}),
          ...(entry.affected_paths ? { affected_paths: entry.affected_paths } : {}),
          ...(entry.why !== undefined ? { why: entry.why } : {}),
          score: 1.0,
          reason: "file_path",
        });
      }
    }
    if (matched.length === 0) return undefined;
    return matched.slice(0, limit);
  }

  // FALLBACK: semantic match. Only reached when query is set and file_path is not.
  const scored: BriefInvariant[] = [];
  for (const { entry, vec } of embedded) {
    if (!vec || !qvec) continue;
    const score = cosine(qvec, vec);
    if (score < EMBED_THRESHOLD) continue;
    scored.push({
      invariant: entry.invariant,
      ...(entry.triggered_by ? { triggered_by: entry.triggered_by } : {}),
      ...(entry.affected_paths ? { affected_paths: entry.affected_paths } : {}),
      ...(entry.why !== undefined ? { why: entry.why } : {}),
      score,
      reason: "embed",
    });
  }
  if (scored.length === 0) return undefined;
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/** Rank anti_patterns against a query. Surfacing model per the v0.15 spec:
 *
 *   1. Cosine-similarity against the joined haystack (pattern + reason +
 *      instead + keywords) is the embed baseline.
 *   2. If query contains any of the entry's `keywords` as a case-insensitive
 *      substring, add +0.3 (reason_kind "keyword"); otherwise reason_kind is
 *      "embed".
 *   3. If query contains planning-language (PLANNING_LEXICON), multiply the
 *      whole score by 1.4. Both boosts compound.
 *   4. Threshold gate: EMBED_THRESHOLD (0.4) when planning-language present,
 *      EMBED_THRESHOLD + 0.2 (0.6) otherwise. The raised bar keeps
 *      anti_patterns from leaking into descriptive queries.
 *
 *  Returns undefined when query is absent, when there are no entries to rank,
 *  or when no entry clears the effective threshold. anti_patterns is a
 *  query-driven (intent) signal — file_path alone does not surface it. */
function rankAntiPatterns(
  query: string | undefined,
  qvec: number[] | null,
  embedded: AntiPatternEmbedded[],
  limit: number,
): BriefAntiPattern[] | undefined {
  if (!query) return undefined;
  if (embedded.length === 0) return undefined;

  const qLower = query.toLowerCase();
  const planning = hasPlanningLanguage(query);
  const planningMult = planning ? 1.4 : 1.0;
  const threshold = planning ? EMBED_THRESHOLD : EMBED_THRESHOLD + 0.2;

  const scored: BriefAntiPattern[] = [];
  for (const { entry, vec } of embedded) {
    const embedScore = vec && qvec ? cosine(qvec, vec) : 0;
    const keywords = entry.keywords ?? [];
    const keywordHit = keywords.some(k => qLower.includes(k.toLowerCase()));
    const keywordBoost = keywordHit ? 0.3 : 0;
    const score = (embedScore + keywordBoost) * planningMult;
    if (score < threshold) continue;
    scored.push({
      pattern: entry.pattern,
      reason: entry.reason,
      ...(entry.instead !== undefined ? { instead: entry.instead } : {}),
      ...(entry.keywords ? { keywords: entry.keywords } : {}),
      score,
      reason_kind: keywordHit ? "keyword" : "embed",
    });
  }
  if (scored.length === 0) return undefined;
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/** Surface prerequisites when the query has onboarding shape. Unlike the
 *  other v0.15 slots, this one does no semantic ranking — entries pass
 *  through verbatim in source order with a flat score of 1.0 and reason
 *  "onboarding". The slot is gated on intent, not content:
 *
 *   - file_path set → always undefined (task-specific work).
 *   - non-onboarding query → undefined (save tokens).
 *   - empty/missing query OR onboarding-lexicon hit → top `limit` entries. */
function rankPrerequisites(
  query: string | undefined,
  filePath: string | undefined,
  prerequisites: PrerequisiteEntry[],
  limit: number,
): BriefPrerequisite[] | undefined {
  if (filePath) return undefined;
  if (!isOnboardingQuery(query)) return undefined;
  if (prerequisites.length === 0) return undefined;
  return prerequisites.slice(0, limit).map(entry => ({
    topic: entry.topic,
    why: entry.why,
    ...(entry.link !== undefined ? { link: entry.link } : {}),
    score: 1.0,
    reason: "onboarding",
  }));
}

async function briefTool(args: Args): Promise<ToolResult<BriefData>> {
  const r = await resolveAnatomy(getPath(args));
  if ("error" in r) return wrapError(r);

  const doc = r.doc as unknown as {
    identity?: unknown;
    tagline?: string;
    rules?: Rule[];
    flows?: Flow[];
    vocabulary?: VocabEntry[];
    invariants?: InvariantEntry[];
    anti_patterns?: AntiPatternEntry[];
    prerequisites?: PrerequisiteEntry[];
  };
  const ruleLimit = getLimit(args, "rule_limit", DEFAULT_RULE_LIMIT);
  const flowLimit = getLimit(args, "flow_limit", DEFAULT_FLOW_LIMIT);
  // v0.15 section limits — one per surfacing model.
  const vocabLimit = getLimit(args, "vocab_limit", DEFAULT_VOCAB_LIMIT);
  const invariantLimit = getLimit(args, "invariant_limit", DEFAULT_INVARIANT_LIMIT);
  const antiPatternLimit = getLimit(args, "anti_pattern_limit", DEFAULT_ANTI_PATTERN_LIMIT);
  const prerequisiteLimit = getLimit(args, "prerequisite_limit", DEFAULT_PREREQUISITE_LIMIT);
  const file_path = typeof args.file_path === "string" ? args.file_path : undefined;
  const query = typeof args.query === "string" ? args.query : undefined;

  const allRules = doc.rules ?? [];
  const allVocab = doc.vocabulary ?? [];
  const allInvariants = doc.invariants ?? [];
  const allAntiPatterns = doc.anti_patterns ?? [];
  const allPrerequisites = doc.prerequisites ?? [];
  const rules: BriefRule[] = [];
  const globMatched = new Set<number>();

  // Glob path: file_path scoping via verify-block globs.
  if (file_path) {
    for (let i = 0; i < allRules.length; i++) {
      const globs = extractGlobs(allRules[i]);
      if (globs.length > 0 && anyGlobMatches(file_path, globs)) {
        globMatched.add(i);
        rules.push({
          rule: allRules[i].rule,
          why: allRules[i].why,
          score: 1.0,
          reason: "glob",
        });
      }
    }
  }

  // Embed path: query semantic match against rule vectors.
  const repo_fingerprint = (doc as { identity?: { fingerprint?: string } }).identity?.fingerprint ?? "";
  const needEmbed = !!(query || file_path);
  const embedCache = needEmbed ? await getCache(cacheKey(r.anatomy_path, repo_fingerprint), allRules, doc.flows ?? [], allVocab, allInvariants, allAntiPatterns) : null;

  // Compute the query embedding once and reuse for both rules and flows.
  const qvec = query && embedCache ? await embedQuery(query) : null;

  if (qvec && embedCache) {
    for (let i = 0; i < embedCache.rules.length; i++) {
      if (globMatched.has(i)) continue;
      const rvec = embedCache.rules[i].vec;
      if (!rvec) continue;
      const score = cosine(qvec, rvec);
      if (score >= EMBED_THRESHOLD) {
        rules.push({
          rule: embedCache.rules[i].rule.rule,
          why: embedCache.rules[i].rule.why,
          score,
          reason: "embed",
        });
      }
    }
  }

  // Sort rules: glob (score 1.0) first, then embed by score desc.
  rules.sort((a, b) => b.score - a.score);

  // Default fallback: only when neither query nor file_path is supplied.
  if (!file_path && !query) {
    for (let i = 0; i < allRules.length && rules.length < ruleLimit; i++) {
      rules.push({
        rule: allRules[i].rule,
        why: allRules[i].why,
        score: 0,
        reason: "default",
      });
    }
  }

  rules.splice(ruleLimit);

  // Flows: query-embed when query supplied, otherwise source-order.
  const allFlows = doc.flows ?? [];
  const flows: BriefFlow[] = [];
  if (qvec && embedCache) {
    const scored: { flow: Flow; score: number }[] = [];
    for (let i = 0; i < embedCache.flows.length; i++) {
      const fvec = embedCache.flows[i].vec;
      if (!fvec) continue;
      const score = cosine(qvec, fvec);
      if (score >= EMBED_THRESHOLD) {
        scored.push({ flow: embedCache.flows[i].flow, score });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    for (const s of scored.slice(0, flowLimit)) {
      flows.push({ name: s.flow.name, summary: s.flow.summary, score: s.score });
    }
  } else if (!query) {
    for (const f of allFlows.slice(0, flowLimit)) {
      flows.push({ name: f.name, summary: f.summary });
    }
  }
  // When query is set but qvec/embedCache is null (no embedder), flows is empty.

  // Memory: BM25F+decay rank when query supplied; empty otherwise.
  const memoryLimit = getLimit(args, "memory_limit", DEFAULT_MEMORY_LIMIT);
  const memory: BriefMemory[] = [];
  if (query) {
    const memText = readMemoryFile(r.anatomy_dir);
    if (memText !== null) {
      try {
        const entries = parseMemoryDoc(memText).entries;
        const ranked = searchMemory(entries, { query, limit: memoryLimit });
        for (const item of ranked) {
          memory.push({
            id: item.entry.id,
            kind: item.entry.kind,
            topic: item.entry.topic,
            content: item.entry.content,
            at: item.entry.at,
            last_verified_at: item.entry.last_verified_at,
            bm25_score: item.bm25_score,
            decay_bucket: item.decay_bucket,
          });
        }
      } catch {
        // Malformed memory file → return no memory entries, don't fail the call.
      }
    }
  }

  // Vocabulary: semantic match with exact-token boost when query supplied.
  // Surfaces top vocab_limit (default 5) above EMBED_THRESHOLD. Omitted
  // entirely when no entries match — JSON serializer drops the undefined key.
  let vocabulary: BriefVocabulary[] | undefined;
  if (query && allVocab.length > 0 && embedCache) {
    vocabulary = rankVocabulary(query, qvec, embedCache.vocab, vocabLimit);
  }

  // Invariants: file_path glob (primary, score 1.0) or semantic fallback when
  // only query is supplied. Omitted when both signals are absent OR when the
  // chosen mode yields zero matches (no cross-mode fallback).
  const invariants = rankInvariants(
    query,
    qvec,
    file_path,
    allInvariants,
    embedCache?.invariants ?? [],
    invariantLimit,
  );

  // Anti-patterns: query-driven only (file_path alone does not surface them).
  // Cosine baseline + keyword substring boost (+0.3) + planning-language
  // multiplier (*1.4). Threshold rises by 0.2 when planning language is
  // absent. Omitted when no entries pass the effective threshold.
  let anti_patterns: BriefAntiPattern[] | undefined;
  if (query && allAntiPatterns.length > 0 && embedCache) {
    anti_patterns = rankAntiPatterns(query, qvec, embedCache.anti_patterns, antiPatternLimit);
  }

  // Prerequisites: onboarding-gated only. Surface when query is empty/missing
  // or matches ONBOARDING_LEXICON; suppress when file_path is set or query
  // looks task-specific. No embed — entries pass through verbatim with
  // score 1.0, reason "onboarding".
  const prerequisites = rankPrerequisites(query, file_path, allPrerequisites, prerequisiteLimit);

  // Hint: when an arg was supplied but nothing matched, redirect to Grep.
  let hint: string | undefined;
  const argSupplied = !!(query || file_path);
  const allEmpty = rules.length === 0 && memory.length === 0 && flows.length === 0 && !vocabulary && !invariants && !anti_patterns && !prerequisites;
  if (argSupplied && allEmpty) {
    hint = "No anatomy context matched. For literal-string questions, prefer Grep. For broader context, try anatomy_memory_search with looser terms.";
  }

  return {
    anatomy_path: r.anatomy_path,
    staleness: r.staleness,
    repo_fingerprint,
    data: {
      identity: doc.identity,
      tagline: doc.tagline ?? "",
      rules,
      memory,
      flows,
      ...(vocabulary ? { vocabulary } : {}),
      ...(invariants ? { invariants } : {}),
      ...(anti_patterns ? { anti_patterns } : {}),
      ...(prerequisites ? { prerequisites } : {}),
      ...(hint !== undefined ? { hint } : {}),
    },
  };
}

function instrument(fn: (args: Args) => Promise<ToolResult<BriefData>>): (args: Args) => Promise<ToolResult<BriefData>> {
  return async (args) => {
    const t0 = Date.now();
    let result: ToolResult<BriefData>;
    try {
      result = await fn(args);
    } catch (e) {
      result = { error: "validation_failed", code: "internal", pointer: "", message: e instanceof Error ? e.message : String(e) };
    }
    const elapsed = Date.now() - t0;
    const json = JSON.stringify(result);
    const returned_ids = "data" in result ? {
      rules: result.data.rules.map(r => ruleIdHash(r.rule)),
      memory: result.data.memory.map(m => m.id),
      flows: result.data.flows.map(f => f.name),
    } : undefined;
    recordTelemetry({
      kind: "mcp_call",
      ts: new Date().toISOString(),
      tool: "anatomy_brief",
      args,
      repo_fingerprint: "data" in result ? result.repo_fingerprint : "",
      result_bytes: json.length,
      error: "error" in result ? result.error : null,
      latency_ms: elapsed,
      returned_ids,
    });
    return result;
  };
}

function ruleIdHash(rule: string): string {
  // FNV-1a-style 32-bit hex hash — stable across regenerates, bounded
  // length. Not cryptographic; collisions only confuse analysis grouping,
  // which is acceptable for telemetry.
  let h = 0x811c9dc5;
  for (let i = 0; i < rule.length; i++) {
    h ^= rule.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export const briefToolHandler = instrument(briefTool);

export const briefToolDefinition = {
  name: "anatomy_brief",
  description:
    "Primary discovery tool for repo context. Returns rules, memory entries, " +
    "and flows relevant to the current task in a single call. Pass `query` " +
    "for semantic match, `file_path` for the file being edited (uses rule " +
    "verify-block globs for scoping), or both. When nothing matches, returns " +
    "an explicit `hint` field — fall back to Grep. Use this in preference to " +
    "Read-ing .anatomy directly.",
  inputSchema: {
    type: "object",
    properties: {
      query:              { type: "string",  description: "Free-text query for semantic match against rules and BM25F search against memory." },
      file_path:          { type: "string",  description: "Exact file path. Matched against each rule's verify-block globs (expect_in, forbid_in, match, container)." },
      path:               { type: "string",  description: "Path to resolve nearest .anatomy from. Defaults to cwd." },
      rule_limit:         { type: "number",  description: "Max rules to return. Default 5." },
      memory_limit:       { type: "number",  description: "Max memory entries to return. Default 5." },
      flow_limit:         { type: "number",  description: "Max flows to return. Default 3." },
      vocab_limit:        { type: "number",  description: "Max vocabulary entries to return. Default 5." },
      invariant_limit:    { type: "number",  description: "Max invariants to return. Default 5." },
      anti_pattern_limit: { type: "number",  description: "Max anti-patterns to return. Default 3." },
      prerequisite_limit: { type: "number",  description: "Max prerequisites to return. Default 3." },
    },
  },
};
