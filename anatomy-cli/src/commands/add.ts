// src/commands/add.ts
// `anatomy add <kind> <topic> [content] [--refs ...] [--tags ...] [--supersedes <id>]`
// Appends a memory entry. Reads content from stdin if "-" passed, or opens
// $EDITOR if content arg omitted. Auto-populates id, at, by.

import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { parse as parseToml } from "smol-toml";
import { readAnatomyFile } from "../io.js";
import { makeEntryId } from "../memory/id.js";
import { detectBy } from "../memory/attribution.js";
import {
  appendEntry, createMemoryFile, parseMemoryDoc, patchEntryField,
  readMemoryFile, type EntryKind, type MemoryEntry,
} from "../memory/io.js";

export interface AddOptions {
  supersedes?: string;
  refs?: string;
  tags?: string;
}

const VALID_KINDS = new Set<EntryKind>(["gotcha", "decision", "convention", "attempt", "milestone"]);

function readStdinSync(): string {
  // Read all of stdin synchronously. readFileSync(0, "utf8") consumes the
  // whole stream in one call; no looping needed on Node ≥22.
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function readEditor(): string {
  const editor = process.env.EDITOR;
  if (!editor) {
    throw new Error("$EDITOR is not set; pass content as a positional arg or use '-' for stdin");
  }
  const tmp = join(tmpdir(), `anatomy-add-${process.pid}.txt`);
  writeFileSync(tmp, "# Write your entry content above this line.\n# Lines starting with # are ignored.\n", "utf8");
  const r = spawnSync(editor, [tmp], { stdio: "inherit", shell: true });
  if (r.status !== 0) {
    try { unlinkSync(tmp); } catch {}
    throw new Error(`editor exited with status ${r.status}`);
  }
  const content = readFileSync(tmp, "utf8")
    .split("\n")
    .filter(line => !line.trimStart().startsWith("#"))
    .join("\n")
    .trim();
  try { unlinkSync(tmp); } catch {}
  if (!content) throw new Error("empty content from editor");
  return content;
}

function parseCsv(s: string | undefined): string[] | undefined {
  if (!s) return undefined;
  const parts = s.split(",").map(x => x.trim()).filter(Boolean);
  return parts.length === 0 ? undefined : parts;
}

function readAnatomyFingerprint(repoRoot: string): string | null {
  const p = join(repoRoot, ".anatomy");
  if (!existsSync(p)) return null;
  try {
    const doc = parseToml(readAnatomyFile(p)) as { identity?: { fingerprint?: unknown } };
    const fp = doc.identity?.fingerprint;
    return typeof fp === "string" ? fp : null;
  } catch {
    return null;
  }
}

export function addCommand(positional: string[], opts: AddOptions): number {
  const repoRoot = process.cwd();
  const [kind, topic, contentArg] = positional;

  if (!kind || !topic) {
    process.stderr.write(`anatomy add: usage: anatomy add <kind> <topic> [content] [--refs ...] [--tags ...] [--supersedes <id>]\n`);
    return 1;
  }
  if (!VALID_KINDS.has(kind as EntryKind)) {
    process.stderr.write(`anatomy add: unknown kind ${JSON.stringify(kind)} (valid: gotcha | decision | convention | attempt | milestone)\n`);
    return 1;
  }

  // Resolve content
  let content: string;
  try {
    if (contentArg === undefined) {
      content = readEditor();
    } else if (contentArg === "-") {
      content = readStdinSync().trim();
      if (!content) {
        process.stderr.write(`anatomy add: empty content from stdin\n`);
        return 1;
      }
    } else {
      content = contentArg;
    }
  } catch (err) {
    process.stderr.write(`anatomy add: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }

  // Read paired .anatomy fingerprint
  const fingerprint = readAnatomyFingerprint(repoRoot);
  if (!fingerprint) {
    process.stderr.write(`anatomy add: .anatomy not found or invalid in ${repoRoot} — run \`anatomy generate\` first\n`);
    return 1;
  }

  // Build entry
  const at = new Date().toISOString();
  const entry: MemoryEntry = {
    id: makeEntryId(at, content),
    kind: kind as EntryKind,
    topic,
    content,
    at,
    by: detectBy(repoRoot),
  };
  const refs = parseCsv(opts.refs);
  if (refs) entry.refs = refs;
  const tags = parseCsv(opts.tags);
  if (tags) entry.tags = tags;

  // If --supersedes is set, verify the target exists and is eligible BEFORE
  // appending the new entry — otherwise we'd leave a ghost entry in the file
  // when verification fails.
  if (opts.supersedes) {
    const text = readMemoryFile(repoRoot);
    if (!text) {
      process.stderr.write(`anatomy add: --supersedes: no entry with id ${JSON.stringify(opts.supersedes)} — .anatomy-memory does not exist\n`);
      return 1;
    }
    const doc = parseMemoryDoc(text);
    const target = doc.entries.find(e => e.id === opts.supersedes);
    if (!target) {
      process.stderr.write(`anatomy add: --supersedes: no entry with id ${JSON.stringify(opts.supersedes)}\n`);
      return 1;
    }
    if (target.superseded_by) {
      process.stderr.write(`anatomy add: --supersedes: entry ${opts.supersedes} is already superseded by ${target.superseded_by}\n`);
      return 1;
    }
    if (target.deprecated_at) {
      process.stderr.write(`anatomy add: --supersedes: entry ${opts.supersedes} is already deprecated\n`);
      return 1;
    }
  }

  // Create memory file if absent
  if (readMemoryFile(repoRoot) === null) {
    createMemoryFile(repoRoot, fingerprint);
  }

  // Append
  try {
    appendEntry(repoRoot, entry);
  } catch (err) {
    process.stderr.write(`anatomy add: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }

  // Patch the superseded entry's superseded_by field
  if (opts.supersedes) {
    try {
      patchEntryField(repoRoot, opts.supersedes, "superseded_by", entry.id);
    } catch (err) {
      process.stderr.write(`anatomy add: --supersedes: ${err instanceof Error ? err.message : String(err)}\n`);
      return 1;
    }
  }

  process.stdout.write(`✓ added ${entry.kind} entry ${entry.id} (${entry.topic})\n`);
  return 0;
}
