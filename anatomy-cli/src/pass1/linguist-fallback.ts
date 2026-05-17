// src/pass1/linguist-fallback.ts
//
// Stack-id fallback for the null-manifest / stub-only case. When
// detectManifest can't decide (antirez/sds-shape: Makefile-only C
// project; ohmyzsh-shape: directory of shell scripts), this calls
// linguist-js in an isolated subprocess to read the source file
// extensions, picks the dominant programming language, and maps it to
// a stack id.
//
// Gated by env var ANATOMY_LINGUIST_FALLBACK=1 because the linguist
// subprocess costs 250ms–23s per repo (heuristic mode reads file
// content, not just extensions). The flag protects Pass 1's normal
// fast-path latency while we measure the integration's real value.
//
// Returns null when:
//   - the flag is off (cheap early-out)
//   - the worker crashes / times out / returns no programming language
//   - the dominant language has no entry in LINGUIST_TO_STACK
//
// On null, the caller (deriveStack) falls back to emitting "todo-stack".

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { debug } from "../log.js";

const WORKER = resolve(dirname(fileURLToPath(import.meta.url)), "linguist-worker.js");

// Linguist's display name → anatomy stack id. The stack id is a free-
// form string per spec §4.3; we use the same short-form names anatomy
// already emits from manifest-derived paths ("typescript", "ruby", etc.)
// so fallback-derived stacks don't visually stand out from manifest-
// derived ones. Adds "c" and "shell" — neither has a manifest detector
// because both ecosystems lack a single canonical project-manifest file.
const LINGUIST_TO_STACK = new Map<string, string>([
  ["Swift", "swift"],
  ["Ruby", "ruby"],
  ["Lua", "lua"],
  ["C++", "cpp"], ["C/C++", "cpp"],
  ["C", "c"],
  ["Python", "python"],
  ["TypeScript", "typescript"], ["TSX", "typescript"],
  ["JavaScript", "javascript"], ["JSX", "javascript"],
  ["Rust", "rust"],
  ["Go", "go"],
  ["Java", "java"], ["Kotlin", "kotlin"],
  ["C#", "csharp"], ["F#", "fsharp"], ["Visual Basic .NET", "vbnet"],
  ["Haskell", "haskell"],
  ["Elixir", "elixir"],
  ["Erlang", "erlang"],
  ["PHP", "php"],
  ["Dart", "dart"],
  ["Nim", "nim"],
  ["Shell", "shell"], ["Bash", "shell"], ["Zsh", "shell"],
  ["Clojure", "clojure"],
  ["OCaml", "ocaml"],
  ["Crystal", "crystal"],
  ["R", "r"],
  ["Julia", "julia"],
  ["Scala", "scala"],
  ["Perl", "perl"],
  ["Solidity", "solidity"],
  ["Gleam", "gleam"],
  ["V", "v"],
  ["Zig", "zig"],
]);

// Linguist sometimes emits these names with high byte counts on common
// documentation/build artifacts. They are never the real stack of a
// project, so filter unconditionally before the language→stack lookup.
// GCC Machine Description (.md) and RenderScript (.rs) are the corpus-
// observed false positives; Roff (man pages) and Text are defensive.
const LINGUIST_JUNK = new Set<string>([
  "GCC Machine Description",
  "RenderScript",
  "Roff",
  "Text",
]);

interface WorkerResult {
  ok: boolean;
  elapsedMs?: number;
  languages?: Array<{ name: string; bytes: number }>;
  error?: string;
}

/** Returns a stack id derived from linguist's dominant programming
 *  language, or null when the fallback is disabled, fails, or finds no
 *  mappable language. */
export function linguistStackFallback(repoRoot: string): string | null {
  if (process.env.ANATOMY_LINGUIST_FALLBACK !== "1") return null;

  const proc = spawnSync(
    process.execPath,
    [WORKER, repoRoot],
    { encoding: "utf8", maxBuffer: 50 * 1024 * 1024, timeout: 300_000 },
  );
  if (proc.error) {
    debug(`linguist-fallback: spawn error: ${proc.error.message}`);
    return null;
  }
  if (proc.status !== 0) {
    debug(`linguist-fallback: worker exit=${proc.status}`);
    return null;
  }

  let parsed: WorkerResult;
  try {
    parsed = JSON.parse(proc.stdout.trim()) as WorkerResult;
  } catch {
    debug(`linguist-fallback: parse error`);
    return null;
  }
  if (!parsed.ok || !parsed.languages) {
    debug(`linguist-fallback: worker error: ${parsed.error}`);
    return null;
  }

  for (const entry of parsed.languages) {
    if (LINGUIST_JUNK.has(entry.name)) continue;
    const stack = LINGUIST_TO_STACK.get(entry.name);
    if (stack) {
      debug(`linguist-fallback: ${entry.name} → ${stack} (${entry.bytes} bytes, ${parsed.elapsedMs}ms)`);
      return stack;
    }
  }
  debug(`linguist-fallback: no mappable language in top-${parsed.languages.length}`);
  return null;
}
