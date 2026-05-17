import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(),
}));

import { spawnSync } from "node:child_process";
import { verifySemgrepPattern } from "../src/checks/verify/semgrep-pattern-verifier.js";
import { _resetSemgrepCache } from "../src/checks/verify/detect-semgrep.js";
import type { SemgrepPatternConfig } from "../src/checks/verify/types.js";

const mockSpawn = vi.mocked(spawnSync);

const versionOk = () => ({
  status: 0,
  stdout: Buffer.from("1.45.0"),
  stderr: Buffer.from(""),
  pid: 0,
  output: [] as Buffer[],
  signal: null,
});

const semgrepResult = (results: object[], status = 0, stderr = "") => ({
  status,
  stdout: Buffer.from(JSON.stringify({ results })),
  stderr: Buffer.from(stderr),
  pid: 0,
  output: [] as Buffer[],
  signal: null,
});

async function makeRepo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "anatomy-semgrep-test-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    await mkdir(join(abs, ".."), { recursive: true });
    await writeFile(abs, content);
  }
  return root;
}

describe("verifySemgrepPattern", () => {
  beforeEach(() => {
    _resetSemgrepCache();
    mockSpawn.mockReset();
  });

  it("emits verify-semgrep-unavailable when binary is missing", async () => {
    mockSpawn.mockReturnValue({
      status: null, stdout: Buffer.from(""), stderr: Buffer.from(""),
      pid: 0, output: [], signal: null,
      error: Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
    } as any);

    const repo = await makeRepo({ "src/handlers/auth.py": "request.body" });
    const cfg: SemgrepPatternConfig = {
      kind: "semgrep", lang: "py", pattern: "request.body",
      forbid_in: "src/**/*.py",
    };

    const warnings = await verifySemgrepPattern(repo, cfg, "/rules/0/verify");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe("verify-semgrep-unavailable");
    await rm(repo, { recursive: true, force: true });
  });

  it("emits no warning when expect_in matches", async () => {
    mockSpawn
      .mockReturnValueOnce(versionOk() as any)
      .mockReturnValueOnce(semgrepResult([
        { path: "src/api.py", start: { line: 12 }, check_id: "anonymous" },
      ]) as any);

    const repo = await makeRepo({ "src/api.py": "do_thing()" });
    const cfg: SemgrepPatternConfig = {
      kind: "semgrep", lang: "py", pattern: "do_thing(...)",
      expect_in: "src/**/*.py",
    };

    const warnings = await verifySemgrepPattern(repo, cfg, "/rules/0/verify");
    expect(warnings).toEqual([]);
    await rm(repo, { recursive: true, force: true });
  });

  it("emits verify-pattern-not-matched when expect_in misses", async () => {
    mockSpawn
      .mockReturnValueOnce(versionOk() as any)
      .mockReturnValueOnce(semgrepResult([]) as any);

    const repo = await makeRepo({ "src/api.py": "# empty" });
    const cfg: SemgrepPatternConfig = {
      kind: "semgrep", lang: "py", pattern: "do_thing(...)",
      expect_in: "src/**/*.py",
    };

    const warnings = await verifySemgrepPattern(repo, cfg, "/rules/0/verify");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe("verify-pattern-not-matched");
    await rm(repo, { recursive: true, force: true });
  });

  it("emits no warning when forbid_in misses", async () => {
    mockSpawn
      .mockReturnValueOnce(versionOk() as any)
      .mockReturnValueOnce(semgrepResult([]) as any);

    const repo = await makeRepo({ "src/api.py": "# clean" });
    const cfg: SemgrepPatternConfig = {
      kind: "semgrep", lang: "py", pattern: "eval(...)",
      forbid_in: "src/**/*.py",
    };

    const warnings = await verifySemgrepPattern(repo, cfg, "/rules/0/verify");
    expect(warnings).toEqual([]);
    await rm(repo, { recursive: true, force: true });
  });

  it("emits per-hit verify-pattern-found-where-forbidden when forbid_in matches", async () => {
    mockSpawn
      .mockReturnValueOnce(versionOk() as any)
      .mockReturnValueOnce(semgrepResult([
        { path: "src/a.py", start: { line: 1 }, check_id: "x" },
        { path: "src/b.py", start: { line: 7 }, check_id: "x" },
      ]) as any);

    const repo = await makeRepo({ "src/a.py": "eval(1)", "src/b.py": "eval(2)" });
    const cfg: SemgrepPatternConfig = {
      kind: "semgrep", lang: "py", pattern: "eval(...)",
      forbid_in: "src/**/*.py",
    };

    const warnings = await verifySemgrepPattern(repo, cfg, "/rules/0/verify");
    expect(warnings).toHaveLength(2);
    expect(warnings.every(w => w.code === "verify-pattern-found-where-forbidden")).toBe(true);
    await rm(repo, { recursive: true, force: true });
  });

  it("emits verify-invalid-pattern when stderr signals pattern parse error", async () => {
    mockSpawn
      .mockReturnValueOnce(versionOk() as any)
      .mockReturnValueOnce(semgrepResult([], 1, "Invalid pattern: syntax error at column 7") as any);

    const repo = await makeRepo({ "src/api.py": "x" });
    const cfg: SemgrepPatternConfig = {
      kind: "semgrep", lang: "py", pattern: "eval((((",
      forbid_in: "src/**/*.py",
    };

    const warnings = await verifySemgrepPattern(repo, cfg, "/rules/0/verify");
    expect(warnings.some(w => w.code === "verify-invalid-pattern")).toBe(true);
    await rm(repo, { recursive: true, force: true });
  });

  it("emits verify-semgrep-unavailable on timeout (SIGTERM)", async () => {
    mockSpawn
      .mockReturnValueOnce(versionOk() as any)
      .mockReturnValueOnce({
        status: null, stdout: Buffer.from(""), stderr: Buffer.from(""),
        pid: 0, output: [], signal: "SIGTERM",
        error: Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }),
      } as any);

    const repo = await makeRepo({ "src/api.py": "x" });
    const cfg: SemgrepPatternConfig = {
      kind: "semgrep", lang: "py", pattern: "x",
      forbid_in: "src/**/*.py",
    };

    const warnings = await verifySemgrepPattern(repo, cfg, "/rules/0/verify");
    expect(warnings.some(w => w.code === "verify-semgrep-unavailable")).toBe(true);
    await rm(repo, { recursive: true, force: true });
  });

  it("emits verify-semgrep-unavailable on invalid JSON output", async () => {
    mockSpawn
      .mockReturnValueOnce(versionOk() as any)
      .mockReturnValueOnce({
        status: 0,
        stdout: Buffer.from("not json at all"),
        stderr: Buffer.from(""),
        pid: 0, output: [], signal: null,
      } as any);

    const repo = await makeRepo({ "src/api.py": "x" });
    const cfg: SemgrepPatternConfig = {
      kind: "semgrep", lang: "py", pattern: "x",
      forbid_in: "src/**/*.py",
    };

    const warnings = await verifySemgrepPattern(repo, cfg, "/rules/0/verify");
    expect(warnings.some(w => w.code === "verify-semgrep-unavailable")).toBe(true);
    await rm(repo, { recursive: true, force: true });
  });

  it("emits verify-no-files-matched when glob expansion is empty", async () => {
    mockSpawn.mockReturnValueOnce(versionOk() as any);

    const repo = await makeRepo({ "README.md": "x" });
    const cfg: SemgrepPatternConfig = {
      kind: "semgrep", lang: "py", pattern: "x",
      forbid_in: "src/**/*.py",
    };

    const warnings = await verifySemgrepPattern(repo, cfg, "/rules/0/verify");
    expect(warnings.some(w => w.code === "verify-no-files-matched")).toBe(true);
    await rm(repo, { recursive: true, force: true });
  });
});
