import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { reverifyEntry, resolveEndorsementBase } from "../src/memory/reverify.js";
import type { MemoryEntry } from "../src/memory/io.js";

function setupRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "anat-reverify-"));
  execSync("git init", { cwd: dir, stdio: "ignore", shell: true });
  execSync('git config user.email "t@t.com"', { cwd: dir, stdio: "ignore", shell: true });
  execSync('git config user.name "T"', { cwd: dir, stdio: "ignore", shell: true });
  return dir;
}

function commitAt(dir: string, msg: string, date: string): string {
  const env = { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
  execSync("git add .", { cwd: dir, stdio: "ignore", shell: true, env });
  execSync(`git commit -m "${msg}"`, { cwd: dir, stdio: "ignore", shell: true, env });
  return execSync("git rev-parse --short HEAD", { cwd: dir, encoding: "utf8", shell: true }).trim();
}

function makeEntry(overrides: Partial<MemoryEntry>): MemoryEntry {
  return {
    id: "aaa11111",
    kind: "gotcha",
    topic: "t",
    content: "c",
    at: "2026-01-01T00:00:00.000Z",
    by: "human:test",
    ...overrides,
  };
}

let dir: string;
beforeEach(() => { dir = setupRepo(); });
afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

describe("resolveEndorsementBase", () => {
  it("returns the commit that was HEAD at the endorsement time", () => {
    writeFileSync(join(dir, "A.ts"), "x");
    const sha1 = commitAt(dir, "c1", "2026-02-01T00:00:00Z");
    writeFileSync(join(dir, "B.ts"), "y");
    commitAt(dir, "c2", "2026-04-01T00:00:00Z");

    const base = resolveEndorsementBase(dir, "2026-03-01T00:00:00.000Z");
    expect(base).toBe(sha1);
  });

  it("returns null when endorsement predates all commits", () => {
    writeFileSync(join(dir, "A.ts"), "x");
    commitAt(dir, "c1", "2026-02-01T00:00:00Z");

    const base = resolveEndorsementBase(dir, "2025-01-01T00:00:00.000Z");
    expect(base).toBeNull();
  });
});

describe("reverifyEntry — unchanged + not_in_repo", () => {
  it("returns status='unchanged' when the ref is untouched since endorsement", () => {
    writeFileSync(join(dir, "A.ts"), "x");
    commitAt(dir, "c1", "2026-02-01T00:00:00Z");
    writeFileSync(join(dir, "B.ts"), "y");
    commitAt(dir, "c2", "2026-04-01T00:00:00Z");

    const entry = makeEntry({ refs: ["A.ts"], at: "2026-03-01T00:00:00.000Z" });
    const result = reverifyEntry(dir, entry);

    expect(result.ref_status).toHaveLength(1);
    expect(result.ref_status[0]).toEqual({ path: "A.ts", status: "unchanged" });
  });

  it("returns status='not_in_repo' for a path that exists nowhere in history", () => {
    writeFileSync(join(dir, "A.ts"), "x");
    commitAt(dir, "c1", "2026-02-01T00:00:00Z");

    const entry = makeEntry({ refs: ["nonexistent.ts"], at: "2026-03-01T00:00:00.000Z" });
    const result = reverifyEntry(dir, entry);

    expect(result.ref_status[0]).toEqual({ path: "nonexistent.ts", status: "not_in_repo" });
  });

  it("populates endorsement.last_endorsed_at from max(at, last_verified_at)", () => {
    writeFileSync(join(dir, "A.ts"), "x");
    commitAt(dir, "c1", "2026-02-01T00:00:00Z");

    const entry = makeEntry({
      refs: [],
      at: "2026-01-01T00:00:00.000Z",
      last_verified_at: "2026-05-01T00:00:00.000Z",
    });
    const result = reverifyEntry(dir, entry);

    expect(result.endorsement.last_endorsed_at).toBe("2026-05-01T00:00:00.000Z");
  });

  it("returns empty ref_status for an entry with no refs", () => {
    writeFileSync(join(dir, "A.ts"), "x");
    commitAt(dir, "c1", "2026-02-01T00:00:00Z");

    const entry = makeEntry({ at: "2026-03-01T00:00:00.000Z" });
    const result = reverifyEntry(dir, entry);

    expect(result.ref_status).toEqual([]);
  });
});

describe("reverifyEntry — changed", () => {
  it("returns status='changed' with a stripped unified diff for small edits", () => {
    writeFileSync(join(dir, "A.ts"), "line1\nline2\nline3\n");
    commitAt(dir, "c1", "2026-02-01T00:00:00Z");
    writeFileSync(join(dir, "A.ts"), "line1\nLINE2\nline3\n");
    commitAt(dir, "c2", "2026-04-01T00:00:00Z");

    const entry = makeEntry({ refs: ["A.ts"], at: "2026-03-01T00:00:00.000Z" });
    const result = reverifyEntry(dir, entry);

    expect(result.ref_status[0].status).toBe("changed");
    const rs = result.ref_status[0] as { status: "changed"; diff: string };
    expect(rs.diff.startsWith("@@")).toBe(true);
    expect(rs.diff).toContain("-line2");
    expect(rs.diff).toContain("+LINE2");
  });

  it("falls back to truncated content when the diff exceeds the line cap", () => {
    writeFileSync(join(dir, "A.ts"), "x\n");
    commitAt(dir, "c1", "2026-02-01T00:00:00Z");
    writeFileSync(join(dir, "A.ts"), Array.from({ length: 500 }, (_, i) => `line${i}`).join("\n") + "\n");
    commitAt(dir, "c2", "2026-04-01T00:00:00Z");

    const entry = makeEntry({ refs: ["A.ts"], at: "2026-03-01T00:00:00.000Z" });
    const result = reverifyEntry(dir, entry);

    expect(result.ref_status[0].status).toBe("changed");
    const rs = result.ref_status[0] as { status: "changed"; content: string; truncated: true };
    expect(rs.truncated).toBe(true);
    expect(rs.content).toContain("line0");
    expect(rs.content).toContain("line499");
    expect("diff" in rs).toBe(false);
  });

  it("applies the 10240-byte content cap when the diff overflows AND content is large", () => {
    // 500 lines of 50 chars each = ~25KB → diff > 400 lines AND content > 10KB.
    const big = Array.from({ length: 500 }, (_, i) => `line${String(i).padStart(40, "0")}`).join("\n") + "\n";
    writeFileSync(join(dir, "A.ts"), "x\n");
    commitAt(dir, "c1", "2026-02-01T00:00:00Z");
    writeFileSync(join(dir, "A.ts"), big);
    commitAt(dir, "c2", "2026-04-01T00:00:00Z");

    const entry = makeEntry({ refs: ["A.ts"], at: "2026-03-01T00:00:00.000Z" });
    const result = reverifyEntry(dir, entry);

    const rs = result.ref_status[0] as { status: "changed"; content: string; truncated: true };
    expect(rs.status).toBe("changed");
    expect(rs.truncated).toBe(true);
    expect(rs.content.length).toBeLessThanOrEqual(10_240 + 50);
    expect(rs.content).toContain("truncated at 10240 bytes");
  });

  it("handles ref paths containing spaces (shell-quoting smoke test)", () => {
    writeFileSync(join(dir, "with space.ts"), "alpha\n");
    commitAt(dir, "c1", "2026-02-01T00:00:00Z");
    writeFileSync(join(dir, "with space.ts"), "ALPHA\n");
    commitAt(dir, "c2", "2026-04-01T00:00:00Z");

    const entry = makeEntry({ refs: ["with space.ts"], at: "2026-03-01T00:00:00.000Z" });
    const result = reverifyEntry(dir, entry);

    expect(result.ref_status[0].status).toBe("changed");
    const rs = result.ref_status[0] as { status: "changed"; diff: string };
    expect(rs.diff).toContain("-alpha");
    expect(rs.diff).toContain("+ALPHA");
  });
});

describe("reverifyEntry — new_since_endorsement + deleted", () => {
  it("returns 'new_since_endorsement' with current content when ref postdates endorsement", () => {
    writeFileSync(join(dir, "A.ts"), "x");
    commitAt(dir, "c1", "2026-02-01T00:00:00Z");
    writeFileSync(join(dir, "D.ts"), "fresh content\n");
    commitAt(dir, "c2", "2026-04-01T00:00:00Z");

    const entry = makeEntry({ refs: ["D.ts"], at: "2026-03-01T00:00:00.000Z" });
    const result = reverifyEntry(dir, entry);

    expect(result.ref_status[0].status).toBe("new_since_endorsement");
    const rs = result.ref_status[0] as { status: "new_since_endorsement"; content: string };
    expect(rs.content).toBe("fresh content\n");
  });

  it("returns 'deleted' when ref existed at endorsement but is gone at HEAD", () => {
    writeFileSync(join(dir, "B.md"), "doomed\n");
    commitAt(dir, "c1", "2026-02-01T00:00:00Z");
    execSync("git rm B.md", { cwd: dir, stdio: "ignore", shell: true });
    commitAt(dir, "c2", "2026-04-01T00:00:00Z");

    const entry = makeEntry({ refs: ["B.md"], at: "2026-03-01T00:00:00.000Z" });
    const result = reverifyEntry(dir, entry);

    expect(result.ref_status[0]).toEqual({ path: "B.md", status: "deleted" });
  });

  it("caps content at 10240 bytes and marks truncated for large new files", () => {
    writeFileSync(join(dir, "A.ts"), "x");
    commitAt(dir, "c1", "2026-02-01T00:00:00Z");
    writeFileSync(join(dir, "big.ts"), "y".repeat(15_000));
    commitAt(dir, "c2", "2026-04-01T00:00:00Z");

    const entry = makeEntry({ refs: ["big.ts"], at: "2026-03-01T00:00:00.000Z" });
    const result = reverifyEntry(dir, entry);

    const rs = result.ref_status[0] as { status: "new_since_endorsement"; content: string; truncated: boolean };
    expect(rs.status).toBe("new_since_endorsement");
    expect(rs.truncated).toBe(true);
    expect(rs.content.length).toBeLessThanOrEqual(10_240 + 50);
    expect(rs.content).toContain("truncated at 10240 bytes");
  });
});

describe("reverifyEntry — pre-history endorsement", () => {
  it("reports 'new_since_endorsement' for all extant refs when base_commit is null", () => {
    writeFileSync(join(dir, "A.ts"), "alpha\n");
    writeFileSync(join(dir, "B.ts"), "beta\n");
    commitAt(dir, "c1", "2026-02-01T00:00:00Z");

    const entry = makeEntry({
      refs: ["A.ts", "B.ts"],
      at: "2025-01-01T00:00:00.000Z",
    });
    const result = reverifyEntry(dir, entry);

    expect(result.endorsement.base_commit).toBeNull();
    expect(result.ref_status).toHaveLength(2);
    expect(result.ref_status[0]).toMatchObject({ path: "A.ts", status: "new_since_endorsement" });
    expect(result.ref_status[1]).toMatchObject({ path: "B.ts", status: "new_since_endorsement" });
  });
});
