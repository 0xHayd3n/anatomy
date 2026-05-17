import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(),
}));

import { spawnSync } from "node:child_process";
import { verifySemgrepRuleFile } from "../src/checks/verify/semgrep-rule-file-verifier.js";
import { _resetSemgrepCache } from "../src/checks/verify/detect-semgrep.js";
import type { SemgrepRuleFileConfig } from "../src/checks/verify/types.js";

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

const RULE_YAML = `rules:
  - id: test-rule
    pattern: foo()
    message: foo() is forbidden
    severity: WARNING
    languages: [python]
`;

async function makeRepo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "anatomy-semgrep-rf-test-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    await mkdir(join(abs, ".."), { recursive: true });
    await writeFile(abs, content);
  }
  return root;
}

describe("verifySemgrepRuleFile", () => {
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

    const repo = await makeRepo({ ".semgrep/r.yml": RULE_YAML, "src/x.py": "foo()" });
    const cfg: SemgrepRuleFileConfig = {
      kind: "semgrep", rule_file: ".semgrep/r.yml", forbid_in: "src/**/*.py",
    };

    const { errors, warnings } = await verifySemgrepRuleFile(repo, cfg, "/rules/0/verify");
    expect(errors).toEqual([]);
    expect(warnings[0].code).toBe("verify-semgrep-unavailable");
    await rm(repo, { recursive: true, force: true });
  });

  it("emits verify-rule-file-missing when rule_file does not exist", async () => {
    mockSpawn.mockReturnValueOnce(versionOk() as any);

    const repo = await makeRepo({ "src/x.py": "foo()" });
    const cfg: SemgrepRuleFileConfig = {
      kind: "semgrep", rule_file: ".semgrep/missing.yml", forbid_in: "src/**/*.py",
    };

    const { errors, warnings } = await verifySemgrepRuleFile(repo, cfg, "/rules/0/verify");
    expect(errors).toEqual([]);
    expect(warnings[0].code).toBe("verify-rule-file-missing");
    await rm(repo, { recursive: true, force: true });
  });

  it("emits verify-rule-file-outside-repo ERROR when rule_file escapes repo", async () => {
    mockSpawn.mockReturnValueOnce(versionOk() as any);

    const repo = await makeRepo({ "src/x.py": "foo()" });
    const cfg: SemgrepRuleFileConfig = {
      kind: "semgrep", rule_file: "../escape.yml", forbid_in: "src/**/*.py",
    };

    const { errors, warnings } = await verifySemgrepRuleFile(repo, cfg, "/rules/0/verify");
    expect(warnings).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("verify-rule-file-outside-repo");
    await rm(repo, { recursive: true, force: true });
  });

  it("emits verify-invalid-rule-file when semgrep rejects the YAML", async () => {
    mockSpawn
      .mockReturnValueOnce(versionOk() as any)
      .mockReturnValueOnce(semgrepResult([], 2, "Invalid rule: missing required field 'pattern'") as any);

    const repo = await makeRepo({ ".semgrep/r.yml": "garbage", "src/x.py": "foo()" });
    const cfg: SemgrepRuleFileConfig = {
      kind: "semgrep", rule_file: ".semgrep/r.yml", forbid_in: "src/**/*.py",
    };

    const { errors, warnings } = await verifySemgrepRuleFile(repo, cfg, "/rules/0/verify");
    expect(errors).toEqual([]);
    expect(warnings.some(w => w.code === "verify-invalid-rule-file")).toBe(true);
    await rm(repo, { recursive: true, force: true });
  });

  it("emits no warning when expect_in matches", async () => {
    mockSpawn
      .mockReturnValueOnce(versionOk() as any)
      .mockReturnValueOnce(semgrepResult([
        { path: "src/x.py", start: { line: 1 } },
      ]) as any);

    const repo = await makeRepo({ ".semgrep/r.yml": RULE_YAML, "src/x.py": "foo()" });
    const cfg: SemgrepRuleFileConfig = {
      kind: "semgrep", rule_file: ".semgrep/r.yml", expect_in: "src/**/*.py",
    };

    const { errors, warnings } = await verifySemgrepRuleFile(repo, cfg, "/rules/0/verify");
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    await rm(repo, { recursive: true, force: true });
  });

  it("emits verify-pattern-not-matched when expect_in misses", async () => {
    mockSpawn
      .mockReturnValueOnce(versionOk() as any)
      .mockReturnValueOnce(semgrepResult([]) as any);

    const repo = await makeRepo({ ".semgrep/r.yml": RULE_YAML, "src/x.py": "# no foo" });
    const cfg: SemgrepRuleFileConfig = {
      kind: "semgrep", rule_file: ".semgrep/r.yml", expect_in: "src/**/*.py",
    };

    const { warnings } = await verifySemgrepRuleFile(repo, cfg, "/rules/0/verify");
    expect(warnings.some(w => w.code === "verify-pattern-not-matched")).toBe(true);
    await rm(repo, { recursive: true, force: true });
  });

  it("emits per-hit verify-pattern-found-where-forbidden when forbid_in matches", async () => {
    mockSpawn
      .mockReturnValueOnce(versionOk() as any)
      .mockReturnValueOnce(semgrepResult([
        { path: "src/a.py", start: { line: 1 } },
        { path: "src/b.py", start: { line: 2 } },
      ]) as any);

    const repo = await makeRepo({
      ".semgrep/r.yml": RULE_YAML,
      "src/a.py": "foo()",
      "src/b.py": "foo()",
    });
    const cfg: SemgrepRuleFileConfig = {
      kind: "semgrep", rule_file: ".semgrep/r.yml", forbid_in: "src/**/*.py",
    };

    const { warnings } = await verifySemgrepRuleFile(repo, cfg, "/rules/0/verify");
    expect(warnings).toHaveLength(2);
    expect(warnings.every(w => w.code === "verify-pattern-found-where-forbidden")).toBe(true);
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

    const repo = await makeRepo({ ".semgrep/r.yml": RULE_YAML, "src/x.py": "foo()" });
    const cfg: SemgrepRuleFileConfig = {
      kind: "semgrep", rule_file: ".semgrep/r.yml", forbid_in: "src/**/*.py",
    };

    const { warnings } = await verifySemgrepRuleFile(repo, cfg, "/rules/0/verify");
    expect(warnings.some(w => w.code === "verify-semgrep-unavailable")).toBe(true);
    await rm(repo, { recursive: true, force: true });
  });

  it("emits verify-no-files-matched when glob expansion is empty", async () => {
    mockSpawn.mockReturnValueOnce(versionOk() as any);

    const repo = await makeRepo({ ".semgrep/r.yml": RULE_YAML, "README.md": "no python" });
    const cfg: SemgrepRuleFileConfig = {
      kind: "semgrep", rule_file: ".semgrep/r.yml", forbid_in: "src/**/*.py",
    };

    const { warnings } = await verifySemgrepRuleFile(repo, cfg, "/rules/0/verify");
    expect(warnings.some(w => w.code === "verify-no-files-matched")).toBe(true);
    await rm(repo, { recursive: true, force: true });
  });
});
