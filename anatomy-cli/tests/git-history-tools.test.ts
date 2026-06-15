import { describe, it, expect } from "vitest";
import { recordTelemetry } from "../src/telemetry.js";
import { gitHistoryToolDefinitions, gitHistoryToolHandlers, _internal, resolveGitBin, probeRepo } from "../src/mcp/git-history-tools.js";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

describe("git_history_call telemetry shape", () => {
  it("accepts a git_history_call record", () => {
    expect(() =>
      recordTelemetry({
        kind: "git_history_call",
        ts: new Date().toISOString(),
        tool: "git_blame",
        duration_ms: 47,
        truncated: false,
        outcome: "ok",
      })
    ).not.toThrow();
  });
});

describe("git-history-tools scaffold", () => {
  it("exports three tool definitions: git_blame, git_log_search, git_show", () => {
    expect(gitHistoryToolDefinitions).toHaveLength(3);
    const names = gitHistoryToolDefinitions.map((d) => d.name).sort();
    expect(names).toEqual(["git_blame", "git_log_search", "git_show"]);
    for (const def of gitHistoryToolDefinitions) {
      expect(typeof def.description).toBe("string");
      expect(def.inputSchema).toBeDefined();
    }
  });

  it("git_blame requires file_path", () => {
    const def = gitHistoryToolDefinitions.find((d) => d.name === "git_blame")!;
    const schema = def.inputSchema as { required?: string[]; properties: Record<string, unknown> };
    expect(schema.required).toEqual(["file_path"]);
    expect(Object.keys(schema.properties).sort()).toEqual(["file_path", "follow", "lines"]);
  });

  it("git_log_search requires kind", () => {
    const def = gitHistoryToolDefinitions.find((d) => d.name === "git_log_search")!;
    const schema = def.inputSchema as { required?: string[]; properties: Record<string, unknown> };
    expect(schema.required).toEqual(["kind"]);
    expect(Object.keys(schema.properties).sort()).toEqual(
      ["author", "kind", "limit", "query", "since", "until"],
    );
  });

  it("git_show requires commit", () => {
    const def = gitHistoryToolDefinitions.find((d) => d.name === "git_show")!;
    const schema = def.inputSchema as { required?: string[]; properties: Record<string, unknown> };
    expect(schema.required).toEqual(["commit"]);
    expect(Object.keys(schema.properties).sort()).toEqual(["commit", "with_diff"]);
  });

  it("exports handlers under matching names", () => {
    expect(gitHistoryToolHandlers).toHaveProperty("git_blame");
    expect(gitHistoryToolHandlers).toHaveProperty("git_log_search");
    expect(gitHistoryToolHandlers).toHaveProperty("git_show");
    expect(typeof gitHistoryToolHandlers.git_blame).toBe("function");
    expect(typeof gitHistoryToolHandlers.git_log_search).toBe("function");
    expect(typeof gitHistoryToolHandlers.git_show).toBe("function");
  });
});

describe("resolveGitBin", () => {
  it("returns a path when git is on PATH", () => {
    const bin = resolveGitBin();
    expect(bin).toBeTruthy();
    expect(existsSync(bin!)).toBe(true);
  });

  it("honors ANATOMY_GIT_BIN if it points at an existing file", () => {
    const bin = resolveGitBin();
    expect(bin).toBeTruthy();
    const oldEnv = process.env.ANATOMY_GIT_BIN;
    try {
      process.env.ANATOMY_GIT_BIN = bin!;
      expect(resolveGitBin()).toBe(bin);
    } finally {
      if (oldEnv === undefined) delete process.env.ANATOMY_GIT_BIN;
      else process.env.ANATOMY_GIT_BIN = oldEnv;
    }
  });

  it("returns null if ANATOMY_GIT_BIN points at a missing file", () => {
    const oldEnv = process.env.ANATOMY_GIT_BIN;
    try {
      process.env.ANATOMY_GIT_BIN = "C:/definitely/not/git.exe";
      expect(resolveGitBin()).toBeNull();
    } finally {
      if (oldEnv === undefined) delete process.env.ANATOMY_GIT_BIN;
      else process.env.ANATOMY_GIT_BIN = oldEnv;
    }
  });

  it("returns null when ANATOMY_GIT_DISABLE is truthy", () => {
    const oldEnv = process.env.ANATOMY_GIT_DISABLE;
    try {
      process.env.ANATOMY_GIT_DISABLE = "1";
      expect(resolveGitBin()).toBeNull();
    } finally {
      if (oldEnv === undefined) delete process.env.ANATOMY_GIT_DISABLE;
      else process.env.ANATOMY_GIT_DISABLE = oldEnv;
    }
  });
});

describe("probeRepo", () => {
  it("returns true inside a git work-tree", () => {
    const bin = resolveGitBin()!;
    const dir = mkdtempSync(join(tmpdir(), "githist-probe-"));
    execSync("git init", { cwd: dir, stdio: "ignore", shell: true });
    expect(probeRepo(bin, dir)).toBe(true);
  });

  it("returns false outside a git work-tree", () => {
    const bin = resolveGitBin()!;
    const dir = mkdtempSync(join(tmpdir(), "githist-noprobe-"));
    expect(probeRepo(bin, dir)).toBe(false);
  });
});

describe("runGit", () => {
  it("returns stdout + exit 0 for a successful command", () => {
    const bin = resolveGitBin()!;
    const dir = mkdtempSync(join(tmpdir(), "githist-run-"));
    execSync("git init", { cwd: dir, stdio: "ignore", shell: true });
    const r = _internal.runGit(bin, ["rev-parse", "--is-inside-work-tree"], dir);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe("true");
    expect(r.timedOut).toBe(false);
  });

  it("captures stderr + non-zero exit for a failing command", () => {
    const bin = resolveGitBin()!;
    const dir = mkdtempSync(join(tmpdir(), "githist-fail-"));
    const r = _internal.runGit(bin, ["rev-parse", "--is-inside-work-tree"], dir);
    expect(r.code).not.toBe(0);
    expect(r.stderr.length).toBeGreaterThan(0);
  });
});
