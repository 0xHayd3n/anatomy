// src/memory/io.ts
// Read, parse, append, and patch operations on .anatomy-memory.
// Append-only invariant: appendEntry always appends to the end of the file.
// patchEntryField (used by --supersedes and `memory deprecate`) and
// recordThanks (used by `memory thanks`) mutate existing entries by
// parse → mutate → re-serialize, which is robust to id values that contain
// regex metacharacters and to alternate TOML formattings (bare datetimes,
// multi-line arrays, hand-edited whitespace).

import { existsSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { readAnatomyMemoryFile } from "../io.js";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";

export const MEMORY_FILENAME = ".anatomy-memory";
/** Latest memory schema version; used when creating a new file from scratch. */
export const MEMORY_VERSION = "0.2";
export const MEMORY_SCHEMA_URL = "https://anatomy.dev/spec/memory/0.2/schema.json";
/** Cap on verified_by entries — schema enforces this; LRU-truncate on each verify. */
export const VERIFIED_BY_MAX = 5;

export type EntryKind = "gotcha" | "decision" | "convention" | "attempt" | "milestone";

export interface MemoryEntry {
  id: string;
  kind: EntryKind;
  topic: string;
  content: string;
  at: string;
  by: string;
  refs?: string[];
  tags?: string[];
  superseded_by?: string;
  deprecated_at?: string;
  deprecated_reason?: string;
  helped_count?: number;
  helped_by?: string[];
  /** v0.2: ISO timestamp of the most recent verification. Absent for v0.1 entries
   *  and v0.2 entries that have never been confirmed (treat as "untouched";
   *  fall back to `at` as the verification proxy). */
  last_verified_at?: string;
  /** v0.2: ordered (most-recent-first) attribution strings of recent verifiers.
   *  Capped at VERIFIED_BY_MAX; the CLI auto-truncates on next verify. */
  verified_by?: string[];
}

export interface MemoryDoc {
  anatomy_memory_version: string;
  repo_fingerprint: string;
  entries: MemoryEntry[];
}

export function memoryPath(repoRoot: string): string {
  return join(repoRoot, MEMORY_FILENAME);
}

/** Returns file text, or null if .anatomy-memory does not exist. */
export function readMemoryFile(repoRoot: string): string | null {
  const p = memoryPath(repoRoot);
  if (!existsSync(p)) return null;
  return readAnatomyMemoryFile(p);
}

/** Recursively normalize TomlDate (Date subclass) to ISO 8601 strings.
 *  smol-toml returns Date instances for bare TOML datetime literals; the
 *  rest of the codebase (and the schema's format:date-time) expects strings.
 *  Mirrors anatomy-validate's parseAnatomyToml normalization.
 *
 *  Note: Date#toISOString() always emits milliseconds. Files written with
 *  `at = 2026-05-08T00:00:00Z` (bare, no fractional seconds) round-trip as
 *  `at = "2026-05-08T00:00:00.000Z"` after a patch operation. Both forms
 *  satisfy the schema's format:date-time, so this is a presentational
 *  change only. */
function normalizeDates(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeDates);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = normalizeDates(v);
    return out;
  }
  return value;
}

/** Parse a memory file's text into a typed doc. Throws on invalid TOML.
 *  TomlDate values (bare datetime literals) are normalized to ISO strings
 *  so MemoryEntry.at is always a string at runtime. */
export function parseMemoryDoc(text: string): MemoryDoc {
  const raw = normalizeDates(parseToml(text)) as Record<string, unknown>;
  const entries = Array.isArray(raw.entries) ? (raw.entries as MemoryEntry[]) : [];
  return {
    anatomy_memory_version: String(raw.anatomy_memory_version ?? ""),
    repo_fingerprint: String(raw.repo_fingerprint ?? ""),
    entries,
  };
}

/** Create a new .anatomy-memory file with header only.
 *  Throws if the file already exists. */
export function createMemoryFile(repoRoot: string, fingerprint: string): void {
  const p = memoryPath(repoRoot);
  if (existsSync(p)) {
    throw new Error(`${p} already exists`);
  }
  const header =
    `anatomy_memory_version = "${MEMORY_VERSION}"\n` +
    `repo_fingerprint = "${fingerprint}"\n`;
  writeFileSync(p, header, "utf8");
}

function escapeTomlString(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[\x00-\x1f]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

function tomlString(s: string): string {
  return `"${escapeTomlString(s)}"`;
}

function tomlStringArray(items: string[]): string {
  return `[${items.map(tomlString).join(", ")}]`;
}

function renderEntry(entry: MemoryEntry): string {
  const lines: string[] = ["[[entries]]"];
  lines.push(`id = ${tomlString(entry.id)}`);
  lines.push(`kind = ${tomlString(entry.kind)}`);
  lines.push(`topic = ${tomlString(entry.topic)}`);
  lines.push(`content = ${tomlString(entry.content)}`);
  lines.push(`at = ${tomlString(entry.at)}`);
  lines.push(`by = ${tomlString(entry.by)}`);
  if (entry.refs && entry.refs.length > 0) lines.push(`refs = ${tomlStringArray(entry.refs)}`);
  if (entry.tags && entry.tags.length > 0) lines.push(`tags = ${tomlStringArray(entry.tags)}`);
  if (entry.superseded_by) lines.push(`superseded_by = ${tomlString(entry.superseded_by)}`);
  if (entry.deprecated_at) lines.push(`deprecated_at = ${tomlString(entry.deprecated_at)}`);
  if (entry.deprecated_reason) lines.push(`deprecated_reason = ${tomlString(entry.deprecated_reason)}`);
  if (typeof entry.helped_count === "number") lines.push(`helped_count = ${entry.helped_count}`);
  if (entry.helped_by && entry.helped_by.length > 0) lines.push(`helped_by = ${tomlStringArray(entry.helped_by)}`);
  if (entry.last_verified_at) lines.push(`last_verified_at = ${tomlString(entry.last_verified_at)}`);
  if (entry.verified_by && entry.verified_by.length > 0) lines.push(`verified_by = ${tomlStringArray(entry.verified_by)}`);
  return lines.join("\n") + "\n";
}

/** Serialize a complete MemoryDoc back to TOML text. The header is two
 *  required lines; each entry is an [[entries]] block separated by a
 *  blank line. Used by patchEntryField and recordThanks for safe
 *  re-serialization after in-memory mutation. */
function serializeMemoryDoc(doc: MemoryDoc): string {
  const header =
    `anatomy_memory_version = "${doc.anatomy_memory_version}"\n` +
    `repo_fingerprint = "${doc.repo_fingerprint}"\n`;
  if (doc.entries.length === 0) return header;
  return header + "\n" + doc.entries.map(renderEntry).join("\n");
}

function writeAtomic(path: string, content: string): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, content, "utf8");
  try {
    renameSync(tmp, path);
  } catch (err) {
    try { unlinkSync(tmp); } catch {}
    throw err;
  }
}

export function appendEntry(repoRoot: string, entry: MemoryEntry): void {
  const p = memoryPath(repoRoot);
  if (!existsSync(p)) {
    throw new Error(`${p} does not exist; create with createMemoryFile() first`);
  }
  const existing = readAnatomyMemoryFile(p);
  const sep = existing.endsWith("\n") ? "\n" : "\n\n";
  const block = renderEntry(entry);
  writeAtomic(p, existing + sep + block);
}

const PATCHABLE_FIELDS = new Set(["superseded_by", "deprecated_at", "deprecated_reason"]);

export function patchEntryField(
  repoRoot: string,
  id: string,
  field: string,
  value: string,
): void {
  if (!PATCHABLE_FIELDS.has(field)) {
    throw new Error(`patchEntryField: field ${JSON.stringify(field)} is not patchable`);
  }
  const p = memoryPath(repoRoot);
  if (!existsSync(p)) throw new Error(`${p} does not exist`);
  const doc = parseMemoryDoc(readAnatomyMemoryFile(p));
  const target = doc.entries.find(e => e.id === id);
  if (!target) {
    throw new Error(`patchEntryField: no entry with id ${JSON.stringify(id)}`);
  }
  switch (field) {
    case "superseded_by":     target.superseded_by = value; break;
    case "deprecated_at":     target.deprecated_at = value; break;
    case "deprecated_reason": target.deprecated_reason = value; break;
    default: throw new Error(`patchEntryField: unreachable field ${field}`);
  }
  writeAtomic(p, serializeMemoryDoc(doc));
}

export type RecordVerificationResult =
  | { ok: true; verifiedAt: string; verifiedBy: string[]; bumpedVersion: boolean }
  | { ok: false; reason: "no-memory" | "no-entry" };

/** Record a "still relevant" confirmation against entry `id` from identity `by`.
 *  Idempotent on `by` within VERIFIED_BY_MAX: re-adds at the front of the LRU
 *  list (most-recent-first) and truncates the tail to MAX. Always updates
 *  `last_verified_at` to the current time even when `by` was already at the
 *  head of the list — re-affirmation by the same identity is signal too.
 *
 *  Bumps the memory file's version header to MEMORY_VERSION (currently "0.2")
 *  if it was on an older version, so v0.1 files automatically migrate the
 *  first time anyone verifies an entry. */
export function recordVerification(repoRoot: string, id: string, by: string): RecordVerificationResult {
  const p = memoryPath(repoRoot);
  if (!existsSync(p)) return { ok: false, reason: "no-memory" };
  const doc = parseMemoryDoc(readAnatomyMemoryFile(p));
  const target = doc.entries.find(e => e.id === id);
  if (!target) return { ok: false, reason: "no-entry" };

  const now = new Date().toISOString();
  const prev = target.verified_by ?? [];
  // Dedupe: drop any prior occurrence of `by`, then unshift to head.
  const without = prev.filter(v => v !== by);
  const next = [by, ...without].slice(0, VERIFIED_BY_MAX);
  target.verified_by = next;
  target.last_verified_at = now;

  const bumpedVersion = doc.anatomy_memory_version !== MEMORY_VERSION;
  doc.anatomy_memory_version = MEMORY_VERSION;
  writeAtomic(p, serializeMemoryDoc(doc));
  return { ok: true, verifiedAt: now, verifiedBy: next, bumpedVersion };
}

export type RecordThanksResult =
  | { ok: true; alreadyThanked: boolean; helpedCount: number }
  | { ok: false; reason: "no-memory" | "no-entry" };

/** Record a "thanks" against entry `id` from identity `by`. Idempotent: if `by`
 *  is already in helped_by, returns alreadyThanked=true without modifying the
 *  file. Updates both helped_by (append) and helped_count (= helped_by.length). */
export function recordThanks(repoRoot: string, id: string, by: string): RecordThanksResult {
  const p = memoryPath(repoRoot);
  if (!existsSync(p)) return { ok: false, reason: "no-memory" };
  const doc = parseMemoryDoc(readAnatomyMemoryFile(p));
  const target = doc.entries.find(e => e.id === id);
  if (!target) return { ok: false, reason: "no-entry" };

  const helpedBy = target.helped_by ?? [];
  if (helpedBy.includes(by)) {
    return { ok: true, alreadyThanked: true, helpedCount: helpedBy.length };
  }
  const next = [...helpedBy, by];
  target.helped_by = next;
  target.helped_count = next.length;
  writeAtomic(p, serializeMemoryDoc(doc));
  return { ok: true, alreadyThanked: false, helpedCount: next.length };
}
