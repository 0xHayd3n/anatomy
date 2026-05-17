import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { fingerprintFromPillars } from "@anatomytool/validate";
import { memoryToolHandlers } from "../src/mcp/memory-tools.js";
import { buildAnatomyToml } from "./_helpers/fixture.js";

const ANATOMY = buildAnatomyToml({ tagline: "test" });
const FP = fingerprintFromPillars("javascript", "javascript-library", "test", "test");

const MEMORY = `anatomy_memory_version = "0.2"
repo_fingerprint = "${FP}"

[[entries]]
id = "aaa11111"
kind = "gotcha"
topic = "windows-shell"
content = "spawnSync needs shell:true on Windows"
at = "2026-02-01T00:00:00.000Z"
by = "human:test"
refs = ["A.ts"]

[[entries]]
id = "bbb22222"
kind = "decision"
topic = "no refs"
content = "entry with no refs at all"
at = "2026-02-01T00:00:00.000Z"
by = "human:test"
`;

function commitAt(dir: string, msg: string, date: string): void {
  const env = { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
  execSync("git add .", { cwd: dir, stdio: "ignore", shell: true, env });
  execSync(`git commit -m "${msg}"`, { cwd: dir, stdio: "ignore", shell: true, env });
}

let tmpDir: string;
const origCwd = process.cwd();

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "anat-mcp-reverify-"));
  execSync("git init", { cwd: tmpDir, stdio: "ignore", shell: true });
  execSync('git config user.email "t@t.com"', { cwd: tmpDir, stdio: "ignore", shell: true });
  execSync('git config user.name "T"', { cwd: tmpDir, stdio: "ignore", shell: true });
  writeFileSync(join(tmpDir, "A.ts"), "original\n");
  commitAt(tmpDir, "c1", "2026-01-15T00:00:00Z");
  writeFileSync(join(tmpDir, ".anatomy"), ANATOMY);
  writeFileSync(join(tmpDir, ".anatomy-memory"), MEMORY);
  commitAt(tmpDir, "c2 anatomy+memory", "2026-02-15T00:00:00Z");
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(origCwd);
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

describe("anatomy_memory_reverify", () => {
  it("returns the full envelope for a valid id", async () => {
    const out = await memoryToolHandlers.anatomy_memory_reverify({ id: "aaa11111" });
    if ("error" in out) throw new Error(`unexpected error: ${JSON.stringify(out)}`);
    expect(out.anatomy_path).toMatch(/\.anatomy$/);
    expect(out.repo_fingerprint).toBe(FP);
    const data = out.data as { entry: { id: string }; endorsement: { last_endorsed_at: string; base_commit: string | null }; ref_status: unknown[] };
    expect(data.entry.id).toBe("aaa11111");
    expect(data.endorsement.last_endorsed_at).toBe("2026-02-01T00:00:00.000Z");
    expect(Array.isArray(data.ref_status)).toBe(true);
    expect(data.ref_status).toHaveLength(1);
  });

  it("returns entry_not_found for a well-formed id with no matching entry", async () => {
    const out = await memoryToolHandlers.anatomy_memory_reverify({ id: "zzz99999" });
    expect(out).toEqual({ error: "entry_not_found", id: "zzz99999" });
  });

  it("returns invalid_id for a malformed id string", async () => {
    const out = await memoryToolHandlers.anatomy_memory_reverify({ id: "BAD!!" });
    expect(out).toMatchObject({ error: "invalid_id" });
  });

  it("returns invalid_id when id is missing", async () => {
    const out = await memoryToolHandlers.anatomy_memory_reverify({});
    expect(out).toMatchObject({ error: "invalid_id" });
  });

  it("returns empty ref_status for an entry without refs", async () => {
    const out = await memoryToolHandlers.anatomy_memory_reverify({ id: "bbb22222" });
    if ("error" in out) throw new Error("expected success");
    const data = out.data as { ref_status: unknown[] };
    expect(data.ref_status).toEqual([]);
  });

  it("populates staleness.significance when staleness is non-null", async () => {
    // Rewrite the fixture's .anatomy with a fake commit field that won't
    // match HEAD, then commit a NEW source file (forces staleness != null
    // AND a non-allowlisted change → significance must be present, value 'unknown').
    const stalerAnatomy = ANATOMY.replace(
      "[generated]",
      `[generated]\ncommit = "deadbee"`,
    );
    writeFileSync(join(tmpDir, ".anatomy"), stalerAnatomy);
    writeFileSync(join(tmpDir, "newcode.ts"), "const y = 2;\n");
    commitAt(tmpDir, "c3 force staleness", "2026-03-01T00:00:00Z");

    const out = await memoryToolHandlers.anatomy_memory_reverify({ id: "aaa11111" });
    if ("error" in out) throw new Error(`unexpected error: ${JSON.stringify(out)}`);
    expect(out.staleness).not.toBeNull();
    expect(out.staleness?.significance).toBe("unknown");
  });
});
