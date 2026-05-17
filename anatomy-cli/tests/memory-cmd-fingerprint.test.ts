// In-process coverage for which fingerprint `anatomy memory search` keys its
// embedding cache by. The MCP path (src/mcp/memory-tools.ts) keys by the
// resolved .anatomy identity.fingerprint; searchSub must use the SAME source
// so CLI and MCP share one cache file. When .anatomy is absent the CLI memory
// subcommands still operate on .anatomy-memory alone, so searchSub must fall
// back to the .anatomy-memory repo_fingerprint header (existing behavior).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { fingerprintFromPillars } from "@anatomy/validate";
import { memoryCommand } from "../src/commands/memory.js";
import { _setEmbedderForTesting } from "../src/embed/index.js";
import { memoryEmbeddingsPath } from "../src/memory/embed.js";
import { buildAnatomyToml } from "./_helpers/fixture.js";

// Unique-per-run, schema-valid (^[a-z0-9]+$, ≤40) so the real ~/.anatomy cache
// file never collides across runs or with other test files.
function uniqueAlnum(prefix = "t"): string {
  return (prefix + Date.now().toString(36) + Math.random().toString(36).slice(2))
    .replace(/[^a-z0-9]/g, "").padEnd(20, "0").slice(0, 20);
}

function memoryToml(fingerprint: string): string {
  return `anatomy_memory_version = "0.2"
repo_fingerprint = "${fingerprint}"

[[entries]]
id = "aaa11111"
kind = "gotcha"
topic = "windows shell"
content = "spawnSync needs shell true on Windows"
at = "2026-05-13T12:00:00Z"
by = "human:test"
`;
}

let tmpDir: string;
let stdoutBuf: string;
let stderrBuf: string;
const origWrite = process.stdout.write.bind(process.stdout);
const origErrWrite = process.stderr.write.bind(process.stderr);
const origCwd = process.cwd();
const cleanupPaths: string[] = [];

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "anat-memfp-"));
  execSync("git init", { cwd: tmpDir, stdio: "ignore", shell: true });
  process.chdir(tmpDir);
  stdoutBuf = "";
  stderrBuf = "";
  process.stdout.write = ((c: string | Uint8Array) => { stdoutBuf += c.toString(); return true; }) as typeof process.stdout.write;
  process.stderr.write = ((c: string | Uint8Array) => { stderrBuf += c.toString(); return true; }) as typeof process.stderr.write;
  _setEmbedderForTesting(async (texts: string[]) => texts.map(() => [1, 0, 0]));
});

afterEach(() => {
  process.chdir(origCwd);
  process.stdout.write = origWrite;
  process.stderr.write = origErrWrite;
  _setEmbedderForTesting(undefined);
  for (const p of cleanupPaths.splice(0)) { try { rmSync(p, { force: true }); } catch { /* best effort */ } }
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
});

describe("anatomy memory search — embedding-cache fingerprint source", () => {
  it("keys the cache by .anatomy identity.fingerprint, not the .anatomy-memory header", async () => {
    const uniqueDomain = uniqueAlnum("dom");
    const anatomyFp = fingerprintFromPillars("javascript", "javascript-library", uniqueDomain, "test");
    const memHeaderFp = uniqueAlnum("mem");
    expect(anatomyFp).not.toBe(memHeaderFp);

    writeFileSync(join(tmpDir, ".anatomy"), buildAnatomyToml({ domain: uniqueDomain }));
    writeFileSync(join(tmpDir, ".anatomy-memory"), memoryToml(memHeaderFp));

    const anatomyCachePath = memoryEmbeddingsPath(anatomyFp)!;
    const memCachePath = memoryEmbeddingsPath(memHeaderFp)!;
    expect(anatomyCachePath).not.toBeNull();
    expect(memCachePath).not.toBeNull();
    cleanupPaths.push(anatomyCachePath, memCachePath);

    const code = await memoryCommand(["search", "windows"], {});
    expect(code).toBe(0);
    expect(stdoutBuf).toContain("aaa11111");

    // Cache must land at the .anatomy-derived path (same as the MCP tool),
    // never at the divergent .anatomy-memory header path.
    expect(existsSync(anatomyCachePath)).toBe(true);
    expect(existsSync(memCachePath)).toBe(false);
  });

  it("falls back to the .anatomy-memory header fingerprint when .anatomy is absent", async () => {
    const memHeaderFp = uniqueAlnum("mem");
    writeFileSync(join(tmpDir, ".anatomy-memory"), memoryToml(memHeaderFp));

    const memCachePath = memoryEmbeddingsPath(memHeaderFp)!;
    cleanupPaths.push(memCachePath);

    const code = await memoryCommand(["search", "windows"], {});
    expect(code).toBe(0);
    expect(stdoutBuf).toContain("aaa11111");
    // No .anatomy to resolve → preserve pre-existing behavior: the CLI keeps
    // keying its cache by the .anatomy-memory header fingerprint.
    expect(existsSync(memCachePath)).toBe(true);
  });
});
