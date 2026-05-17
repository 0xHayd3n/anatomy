// In-process coverage for `anatomy memory search` routed through the hybrid
// path (searchSub → searchMemoryHybrid). The subprocess suite in
// memory-cmd.test.ts forces ANATOMY_DISABLE_EMBEDDINGS=1, so it only exercises
// the degraded (BM25F-only) branch; these tests inject a fake embedder via the
// in-process _setEmbedderForTesting hook to exercise the RRF-engaged branch the
// subprocess harness cannot reach.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memoryCommand } from "../src/commands/memory.js";
import { _setEmbedderForTesting } from "../src/embed/index.js";
import { memoryEmbeddingsPath } from "../src/memory/embed.js";

// Unique per run so buildOrLoadMemoryEmbeddings always cache-misses (→ calls
// the injected fake) and never reads a stale ~/.anatomy cache file.
function uniqueFingerprint(): string {
  return ("t" + Date.now().toString(36) + Math.random().toString(36).slice(2))
    .replace(/[^a-z0-9]/g, "")
    .padEnd(20, "0")
    .slice(0, 20);
}

let tmpDir: string;
let fp: string;
let stdoutBuf: string;
let stderrBuf: string;
const origWrite = process.stdout.write.bind(process.stdout);
const origErrWrite = process.stderr.write.bind(process.stderr);
const origCwd = process.cwd();

// "parallelism deadlock" shares no token with ccc33333's text, so pure BM25F
// cannot surface it. The fake embedder aligns the query and ccc33333 onto the
// same axis so the dense arm must.
const MEMORY = (fingerprint: string) => `anatomy_memory_version = "0.2"
repo_fingerprint = "${fingerprint}"

[[entries]]
id = "aaa11111"
kind = "gotcha"
topic = "windows shell"
content = "spawnSync needs shell true on Windows"
at = "2026-05-13T12:00:00Z"
by = "human:test"

[[entries]]
id = "bbb22222"
kind = "decision"
topic = "render toml"
content = "hand-roll TOML output"
at = "2026-05-13T12:00:00Z"
by = "human:test"

[[entries]]
id = "ccc33333"
kind = "gotcha"
topic = "concurrency note"
content = "async await race condition fix"
at = "2026-05-13T12:00:00Z"
by = "human:test"
`;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "anat-memhyb-"));
  fp = uniqueFingerprint();
  writeFileSync(join(tmpDir, ".anatomy-memory"), MEMORY(fp));
  process.chdir(tmpDir);
  stdoutBuf = "";
  stderrBuf = "";
  process.stdout.write = ((chunk: string | Uint8Array) => { stdoutBuf += chunk.toString(); return true; }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => { stderrBuf += chunk.toString(); return true; }) as typeof process.stderr.write;
});

afterEach(() => {
  process.chdir(origCwd);
  process.stdout.write = origWrite;
  process.stderr.write = origErrWrite;
  _setEmbedderForTesting(undefined);
  const cachePath = memoryEmbeddingsPath(fp);
  if (cachePath) { try { rmSync(cachePath, { force: true }); } catch { /* no cache written */ } }
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
});

describe("anatomy memory search — hybrid path (in-process)", () => {
  it("surfaces a lexically-divergent entry the dense arm aligns with", async () => {
    _setEmbedderForTesting(async (texts: string[]) =>
      texts.map(t =>
        /concurrency note|async await race|parallelism deadlock/i.test(t) ? [1, 0, 0] : [0, 1, 0],
      ),
    );
    const code = await memoryCommand(["search", "parallelism deadlock"], {});
    expect(code).toBe(0);
    // Pure BM25F shares no token with ccc33333 here; only the dense arm can
    // surface it, so its presence proves searchSub wired vectors into hybrid.
    expect(stdoutBuf).toContain("ccc33333");
  });

  it("labels the result header as hybrid when the dense arm engaged", async () => {
    _setEmbedderForTesting(async (texts: string[]) =>
      texts.map(t =>
        /concurrency note|async await race|parallelism deadlock/i.test(t) ? [1, 0, 0] : [0, 1, 0],
      ),
    );
    const code = await memoryCommand(["search", "parallelism deadlock"], {});
    expect(code).toBe(0);
    expect(stdoutBuf).toMatch(/ranked by hybrid BM25F\+dense RRF × decay/);
  });

  it("keeps the legacy header in degraded mode (no embedder)", async () => {
    _setEmbedderForTesting(null);
    const code = await memoryCommand(["search", "windows"], {});
    expect(code).toBe(0);
    expect(stdoutBuf).toContain("aaa11111");
    expect(stdoutBuf).toMatch(/ranked by BM25F × decay/);
    expect(stdoutBuf).not.toMatch(/hybrid/);
  });
});
