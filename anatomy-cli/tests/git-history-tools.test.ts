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

describe("parseLines", () => {
  it("accepts a single line number", () => {
    expect(_internal.parseLines("42")).toEqual({ start: 42, end: 42 });
  });

  it("accepts a range", () => {
    expect(_internal.parseLines("10-25")).toEqual({ start: 10, end: 25 });
  });

  it("rejects malformed input", () => {
    expect(_internal.parseLines("abc")).toBeNull();
    expect(_internal.parseLines("10-")).toBeNull();
    expect(_internal.parseLines("-10")).toBeNull();
    expect(_internal.parseLines("10-5")).toBeNull(); // end < start
    expect(_internal.parseLines("0")).toBeNull();    // start must be >= 1
    expect(_internal.parseLines("")).toBeNull();
  });
});

describe("parseBlamePorcelain", () => {
  it("parses a single-commit single-line blame", () => {
    const input = [
      "abc1234 1 1 1",
      "author Alice",
      "author-mail <alice@example.com>",
      "author-time 1640000000",
      "author-tz +0000",
      "committer Bob",
      "committer-mail <bob@example.com>",
      "committer-time 1640000000",
      "committer-tz +0000",
      "summary initial commit",
      "filename a.ts",
      "\tconst x = 1;",
    ].join("\n");
    const out = _internal.parseBlamePorcelain(input);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      line: 1,
      commit: "abc1234",
      author: "Alice",
      author_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      summary: "initial commit",
      content: "const x = 1;",
    });
  });

  it("parses multiple lines from the same commit (subsequent lines omit headers)", () => {
    const input = [
      "abc1234 1 1 2",
      "author Alice",
      "author-mail <alice@example.com>",
      "author-time 1640000000",
      "author-tz +0000",
      "committer Alice",
      "committer-mail <alice@example.com>",
      "committer-time 1640000000",
      "committer-tz +0000",
      "summary first",
      "filename a.ts",
      "\tline one",
      "abc1234 2 2",
      "\tline two",
    ].join("\n");
    const out = _internal.parseBlamePorcelain(input);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ line: 1, content: "line one", author: "Alice" });
    expect(out[1]).toMatchObject({ line: 2, content: "line two", author: "Alice", summary: "first" });
  });

  it("handles lines whose content starts with a backslash-t (no double-escaping)", () => {
    const input = [
      "abc1234 1 1 1",
      "author Alice",
      "author-mail <alice@example.com>",
      "author-time 1640000000",
      "author-tz +0000",
      "committer Alice",
      "committer-mail <alice@example.com>",
      "committer-time 1640000000",
      "committer-tz +0000",
      "summary x",
      "filename a.ts",
      "\t\\tab",
    ].join("\n");
    const out = _internal.parseBlamePorcelain(input);
    expect(out[0].content).toBe("\\tab");
  });
});

import { gitHistoryToolHandlers as gitHandlers } from "../src/mcp/git-history-tools.js";

function setupBlameRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "githist-blame-"));
  execSync("git init", { cwd: dir, stdio: "ignore", shell: true });
  execSync('git config user.email "test@example.com"', { cwd: dir, stdio: "ignore", shell: true });
  execSync('git config user.name "Test User"', { cwd: dir, stdio: "ignore", shell: true });
  writeFileSync(join(dir, "a.ts"), "const x = 1;\nconst y = 2;\nconst z = 3;\n");
  execSync("git add a.ts", { cwd: dir, stdio: "ignore", shell: true });
  execSync('git commit -m "initial commit"', { cwd: dir, stdio: "ignore", shell: true });
  return dir;
}

describe("git_blame — end-to-end", () => {
  it("returns one record per line of the file by default", async () => {
    const dir = setupBlameRepo();
    const oldCwd = process.cwd();
    try {
      process.chdir(dir);
      const r = await gitHandlers.git_blame({ file_path: "a.ts" });
      const data = JSON.parse(r.content[0].text);
      expect(r.isError).toBeFalsy();
      expect(data.matches).toHaveLength(3);
      expect(data.matches[0]).toMatchObject({
        line: 1,
        author: "Test User",
        summary: "initial commit",
        content: "const x = 1;",
      });
      expect(data.matches[0].commit).toMatch(/^[0-9a-f]{40}$/);
      expect(data.file).toBe("a.ts");
      expect(data.truncated).toBe(false);
    } finally {
      process.chdir(oldCwd);
    }
  });

  it("scopes to a line range when `lines` is provided", async () => {
    const dir = setupBlameRepo();
    const oldCwd = process.cwd();
    try {
      process.chdir(dir);
      const r = await gitHandlers.git_blame({ file_path: "a.ts", lines: "2-3" });
      const data = JSON.parse(r.content[0].text);
      expect(data.matches).toHaveLength(2);
      expect(data.matches[0].line).toBe(2);
      expect(data.matches[1].line).toBe(3);
    } finally {
      process.chdir(oldCwd);
    }
  });

  it("returns file_not_found for a missing file", async () => {
    const dir = setupBlameRepo();
    const oldCwd = process.cwd();
    try {
      process.chdir(dir);
      const r = await gitHandlers.git_blame({ file_path: "nope.ts" });
      const data = JSON.parse(r.content[0].text);
      expect(r.isError).toBe(true);
      expect(data.error).toBe("file_not_found");
    } finally {
      process.chdir(oldCwd);
    }
  });

  it("returns invalid_input for malformed lines", async () => {
    const dir = setupBlameRepo();
    const oldCwd = process.cwd();
    try {
      process.chdir(dir);
      const r = await gitHandlers.git_blame({ file_path: "a.ts", lines: "abc" });
      const data = JSON.parse(r.content[0].text);
      expect(r.isError).toBe(true);
      expect(data.error).toBe("invalid_input");
      expect(data.field).toBe("lines");
    } finally {
      process.chdir(oldCwd);
    }
  });
});

describe("parseLogOutput", () => {
  it("parses a single commit with one file", () => {
    const input = "abc1234567890abcdef1234567890abcdef123456\nAlice\n2026-01-01T12:00:00Z\nfirst\nfile1.ts\n\0";
    const out = _internal.parseLogOutput(input);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      commit: "abc1234567890abcdef1234567890abcdef123456",
      author: "Alice",
      date: "2026-01-01T12:00:00Z",
      summary: "first",
      files: ["file1.ts"],
    });
  });

  it("parses multiple commits with multiple files each", () => {
    const input =
      "aaa1\nAlice\n2026-01-02T12:00:00Z\nsecond\nfile1.ts\nfile2.ts\n\0" +
      "bbb2\nBob\n2026-01-01T12:00:00Z\nfirst\nfile1.ts\n\0";
    const out = _internal.parseLogOutput(input);
    expect(out).toHaveLength(2);
    expect(out[0].files).toEqual(["file1.ts", "file2.ts"]);
    expect(out[1].author).toBe("Bob");
  });

  it("caps the per-commit file list", () => {
    const files = Array.from({ length: 30 }, (_, i) => `f${i}.ts`).join("\n");
    const input = `aaa1\nAlice\n2026-01-01T12:00:00Z\nfirst\n${files}\n\0`;
    const out = _internal.parseLogOutput(input);
    expect(out[0].files.length).toBeLessThanOrEqual(20);
  });

  it("handles empty input (no matches)", () => {
    expect(_internal.parseLogOutput("")).toEqual([]);
  });
});

function setupLogRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "githist-log-"));
  execSync("git init", { cwd: dir, stdio: "ignore", shell: true });
  execSync('git config user.email "test@example.com"', { cwd: dir, stdio: "ignore", shell: true });
  execSync('git config user.name "Test User"', { cwd: dir, stdio: "ignore", shell: true });
  writeFileSync(join(dir, "a.ts"), "const x = 1;\n");
  execSync("git add a.ts", { cwd: dir, stdio: "ignore", shell: true });
  execSync('git commit -m "add a.ts"', { cwd: dir, stdio: "ignore", shell: true });
  writeFileSync(join(dir, "a.ts"), "const x = 1;\nconst y = 2;\n");
  execSync("git add a.ts", { cwd: dir, stdio: "ignore", shell: true });
  execSync('git commit -m "feat: add y to a.ts"', { cwd: dir, stdio: "ignore", shell: true });
  writeFileSync(join(dir, "b.ts"), "const z = 3;\n");
  execSync("git add b.ts", { cwd: dir, stdio: "ignore", shell: true });
  execSync('git commit -m "fix: introduce b.ts"', { cwd: dir, stdio: "ignore", shell: true });
  return dir;
}

describe("git_log_search — end-to-end", () => {
  it("kind=message: finds commits whose message matches the query", async () => {
    const dir = setupLogRepo();
    const oldCwd = process.cwd();
    try {
      process.chdir(dir);
      const r = await gitHandlers.git_log_search({ kind: "message", query: "feat:" });
      const data = JSON.parse(r.content[0].text);
      expect(r.isError).toBeFalsy();
      expect(data.commits).toHaveLength(1);
      expect(data.commits[0].summary).toContain("add y to a.ts");
      expect(data.commits[0].commit).toMatch(/^[0-9a-f]{40}$/);
    } finally {
      process.chdir(oldCwd);
    }
  });

  it("kind=path: finds commits touching a path", async () => {
    const dir = setupLogRepo();
    const oldCwd = process.cwd();
    try {
      process.chdir(dir);
      const r = await gitHandlers.git_log_search({ kind: "path", query: "a.ts" });
      const data = JSON.parse(r.content[0].text);
      expect(data.commits.length).toBeGreaterThanOrEqual(2);
      // Newest first.
      expect(data.commits[0].summary).toContain("add y to a.ts");
    } finally {
      process.chdir(oldCwd);
    }
  });

  it("kind=pickaxe: finds commits where the string appears or disappears", async () => {
    const dir = setupLogRepo();
    const oldCwd = process.cwd();
    try {
      process.chdir(dir);
      const r = await gitHandlers.git_log_search({ kind: "pickaxe", query: "const y" });
      const data = JSON.parse(r.content[0].text);
      expect(data.commits).toHaveLength(1);
      expect(data.commits[0].summary).toContain("add y to a.ts");
    } finally {
      process.chdir(oldCwd);
    }
  });

  it("respects the limit and sets truncated when capped", async () => {
    const dir = setupLogRepo();
    const oldCwd = process.cwd();
    try {
      process.chdir(dir);
      const r = await gitHandlers.git_log_search({ kind: "message", query: ".", limit: 1 });
      const data = JSON.parse(r.content[0].text);
      expect(data.commits).toHaveLength(1);
      expect(data.truncated).toBe(true);
      expect(data.truncation_reason).toBe("max_commits");
    } finally {
      process.chdir(oldCwd);
    }
  });

  it("rejects missing query for pickaxe", async () => {
    const dir = setupLogRepo();
    const oldCwd = process.cwd();
    try {
      process.chdir(dir);
      const r = await gitHandlers.git_log_search({ kind: "pickaxe" });
      const data = JSON.parse(r.content[0].text);
      expect(r.isError).toBe(true);
      expect(data.error).toBe("invalid_input");
      expect(data.field).toBe("query");
    } finally {
      process.chdir(oldCwd);
    }
  });
});

describe("parseShowMetadata", () => {
  it("parses NUL-delimited metadata into structured fields", () => {
    const input = [
      "abc1234567890abcdef1234567890abcdef123456",
      "parent111111111111111111111111111111111111",
      "Alice",
      "2026-01-01T12:00:00Z",
      "feat: add x\n\nlonger body line 1\nlonger body line 2",
    ].join("\0");
    const out = _internal.parseShowMetadata(input);
    expect(out).toMatchObject({
      commit: "abc1234567890abcdef1234567890abcdef123456",
      parents: ["parent111111111111111111111111111111111111"],
      author: "Alice",
      date: "2026-01-01T12:00:00Z",
      message: "feat: add x\n\nlonger body line 1\nlonger body line 2",
    });
  });

  it("parses multiple parents (merge commit)", () => {
    const input = [
      "abc1234567890abcdef1234567890abcdef123456",
      "parent111111111111111111111111111111111111 parent222222222222222222222222222222222222",
      "Alice",
      "2026-01-01T12:00:00Z",
      "Merge branch x",
    ].join("\0");
    const out = _internal.parseShowMetadata(input);
    expect(out!.parents).toHaveLength(2);
  });

  it("returns null on malformed input", () => {
    expect(_internal.parseShowMetadata("only-one-field")).toBeNull();
  });
});

describe("parseShowFiles", () => {
  it("combines --name-status and --numstat output", () => {
    const input = "M\tfile1.ts\nA\tfile2.ts\n10\t5\tfile1.ts\n3\t0\tfile2.ts\n";
    const out = _internal.parseShowFiles(input);
    expect(out).toEqual([
      { path: "file1.ts", status: "M", additions: 10, deletions: 5 },
      { path: "file2.ts", status: "A", additions: 3, deletions: 0 },
    ]);
  });

  it("handles renames (R<percent>\\told\\tnew)", () => {
    const input = "R100\told.ts\tnew.ts\n0\t0\tnew.ts\n";
    const out = _internal.parseShowFiles(input);
    expect(out).toEqual([
      { path: "new.ts", status: "R", additions: 0, deletions: 0 },
    ]);
  });

  it("handles binary files (numstat = -\\t-)", () => {
    const input = "M\tfoo.bin\n-\t-\tfoo.bin\n";
    const out = _internal.parseShowFiles(input);
    expect(out).toEqual([
      { path: "foo.bin", status: "M", additions: 0, deletions: 0 },
    ]);
  });

  it("handles renames where numstat-side path differs (brace notation)", () => {
    // git show --numstat may emit renames as "<adds>\t<dels>\t{old => new}".
    // The name-status side reports the new path; if numstat's path doesn't
    // match exactly, stats default to 0/0 (graceful degradation rather than
    // mis-attribution). Documents the current behavior and guards against
    // a regression that would crash on the brace form.
    const input = "R100\told.ts\tnew.ts\n5\t3\t{old.ts => new.ts}\n";
    const out = _internal.parseShowFiles(input);
    expect(out).toEqual([
      { path: "new.ts", status: "R", additions: 0, deletions: 0 },
    ]);
  });
});

describe("git_show — end-to-end", () => {
  it("returns metadata + file list for HEAD", async () => {
    const dir = setupLogRepo();
    const oldCwd = process.cwd();
    try {
      process.chdir(dir);
      const r = await gitHandlers.git_show({ commit: "HEAD" });
      const data = JSON.parse(r.content[0].text);
      expect(r.isError).toBeFalsy();
      expect(data.commit).toMatch(/^[0-9a-f]{40}$/);
      expect(data.author).toBe("Test User");
      expect(data.message).toContain("introduce b.ts");
      expect(data.files).toHaveLength(1);
      expect(data.files[0]).toMatchObject({
        path: "b.ts",
        status: "A",
        additions: 1,
      });
      expect(data.diff).toBeUndefined();
    } finally {
      process.chdir(oldCwd);
    }
  });

  it("includes a truncated patch when with_diff is true", async () => {
    const dir = setupLogRepo();
    const oldCwd = process.cwd();
    try {
      process.chdir(dir);
      const r = await gitHandlers.git_show({ commit: "HEAD", with_diff: true });
      const data = JSON.parse(r.content[0].text);
      expect(r.isError).toBeFalsy();
      expect(typeof data.diff).toBe("string");
      expect(data.diff).toContain("const z = 3");
    } finally {
      process.chdir(oldCwd);
    }
  });

  it("returns invalid_ref for a bogus commit", async () => {
    const dir = setupLogRepo();
    const oldCwd = process.cwd();
    try {
      process.chdir(dir);
      const r = await gitHandlers.git_show({ commit: "nonexistent-sha-xxxxxxxxxxxx" });
      const data = JSON.parse(r.content[0].text);
      expect(r.isError).toBe(true);
      expect(data.error).toBe("invalid_ref");
    } finally {
      process.chdir(oldCwd);
    }
  });

  it("returns invalid_input when commit is empty", async () => {
    const dir = setupLogRepo();
    const oldCwd = process.cwd();
    try {
      process.chdir(dir);
      const r = await gitHandlers.git_show({ commit: "" });
      const data = JSON.parse(r.content[0].text);
      expect(r.isError).toBe(true);
      expect(data.error).toBe("invalid_input");
      expect(data.field).toBe("commit");
    } finally {
      process.chdir(oldCwd);
    }
  });
});

describe("git-history-tools — error paths", () => {
  it("returns git_unavailable when ANATOMY_GIT_DISABLE=1", async () => {
    const oldEnv = process.env.ANATOMY_GIT_DISABLE;
    try {
      process.env.ANATOMY_GIT_DISABLE = "1";
      const r = await gitHandlers.git_blame({ file_path: "a.ts" });
      const data = JSON.parse(r.content[0].text);
      expect(r.isError).toBe(true);
      expect(data.error).toBe("git_unavailable");
    } finally {
      if (oldEnv === undefined) delete process.env.ANATOMY_GIT_DISABLE;
      else process.env.ANATOMY_GIT_DISABLE = oldEnv;
    }
  });

  it("returns invalid_input for git_log_search with unknown kind", async () => {
    const r = await gitHandlers.git_log_search({ kind: "bogus" });
    const data = JSON.parse(r.content[0].text);
    expect(r.isError).toBe(true);
    expect(data.error).toBe("invalid_input");
    expect(data.field).toBe("kind");
  });

  it("file_path missing → invalid_input for git_blame", async () => {
    const r = await gitHandlers.git_blame({});
    const data = JSON.parse(r.content[0].text);
    expect(r.isError).toBe(true);
    expect(data.error).toBe("invalid_input");
    expect(data.field).toBe("file_path");
  });
});
