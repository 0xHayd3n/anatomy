import { describe, it, expect } from "vitest";
import { classify, parseHits, verifyRulesAtCommit } from "../src/staleness-per-rule.js";
import type { Warning } from "@anatomytool/validate";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function setupRepoWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "anat-perrule-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    const lastSep = full.lastIndexOf("/");
    if (lastSep > dir.length) {
      mkdirSync(full.slice(0, lastSep), { recursive: true });
    }
    writeFileSync(full, content);
  }
  return dir;
}

const W = (code: string, pointer: string, message = ""): Warning => ({
  code: code as Warning["code"],
  message,
  pointer,
});

describe("classify — rule without verify clause", () => {
  it("returns status='unverified' regardless of warnings", () => {
    const rule = { rule: "test rule" };
    expect(classify(0, rule, [])).toEqual({ index: 0, status: "unverified" });
    // Even if some unrelated warning exists at this pointer (shouldn't happen,
    // but defensive), unverified wins because the rule has no verify field.
    expect(classify(0, rule, [W("verify-pattern-not-matched", "/rules/0/verify")]))
      .toEqual({ index: 0, status: "unverified" });
  });
});

describe("classify — rule with verify, no warnings for this rule", () => {
  it("returns status='passing'", () => {
    const rule = { rule: "test", verify: { kind: "glob_exists", path: "x" } };
    expect(classify(0, rule, [])).toEqual({ index: 0, status: "passing" });
  });

  it("ignores warnings for other rule indices", () => {
    const rule = { rule: "test", verify: { kind: "glob_exists", path: "x" } };
    const warnings = [W("verify-pattern-not-matched", "/rules/1/verify")];
    expect(classify(0, rule, warnings)).toEqual({ index: 0, status: "passing" });
  });
});

describe("classify — failing codes", () => {
  const rule = { rule: "test", verify: { kind: "glob_exists", path: "x" } };

  it("verify-glob-empty → failing", () => {
    const w = W("verify-glob-empty", "/rules/0/verify", "no files");
    expect(classify(0, rule, [w]).status).toBe("failing");
  });

  it("verify-glob-unexpected-files → failing", () => {
    const w = W("verify-glob-unexpected-files", "/rules/0/verify", "matched 1");
    expect(classify(0, rule, [w]).status).toBe("failing");
  });

  it("verify-glob-outside-container → failing", () => {
    const w = W("verify-glob-outside-container", "/rules/0/verify", "outside");
    expect(classify(0, rule, [w]).status).toBe("failing");
  });

  it("verify-pattern-not-matched → failing", () => {
    const w = W("verify-pattern-not-matched", "/rules/0/verify", "no match");
    expect(classify(0, rule, [w]).status).toBe("failing");
  });

  it("verify-pattern-found-where-forbidden → failing", () => {
    const w = W("verify-pattern-found-where-forbidden", "/rules/0/verify", "found at lib/foo.ts:42");
    expect(classify(0, rule, [w]).status).toBe("failing");
  });
});

describe("classify — error codes", () => {
  const rule = { rule: "test", verify: { kind: "ast_pattern", lang: "ts", pattern: "x", expect_in: "**/*.ts" } };

  it("verify-ast-grep-unavailable → error with message", () => {
    const w = W("verify-ast-grep-unavailable", "/rules/0/verify", "Install @ast-grep/napi");
    const result = classify(0, rule, [w]);
    expect(result.status).toBe("error");
    expect(result.error).toBe("Install @ast-grep/napi");
  });

  it("verify-semgrep-unavailable → error", () => {
    const w = W("verify-semgrep-unavailable", "/rules/0/verify", "semgrep not on PATH");
    expect(classify(0, rule, [w]).status).toBe("error");
  });

  it("verify-invalid-pattern → error", () => {
    const w = W("verify-invalid-pattern", "/rules/0/verify", "bad regex");
    expect(classify(0, rule, [w]).status).toBe("error");
  });

  it("verify-invalid-rule-file → error", () => {
    const w = W("verify-invalid-rule-file", "/rules/0/verify", "bad yaml");
    expect(classify(0, rule, [w]).status).toBe("error");
  });

  it("verify-rule-file-missing → error", () => {
    const w = W("verify-rule-file-missing", "/rules/0/verify", "no such file");
    expect(classify(0, rule, [w]).status).toBe("error");
  });

  it("verify-no-files-matched → error", () => {
    const w = W("verify-no-files-matched", "/rules/0/verify", "empty file list");
    expect(classify(0, rule, [w]).status).toBe("error");
  });

  it("unknown verify-* code → error (defensive)", () => {
    const w = W("verify-some-new-code", "/rules/0/verify", "future warning");
    expect(classify(0, rule, [w]).status).toBe("error");
  });
});

describe("parseHits — verify-pattern-found-where-forbidden messages", () => {
  it("extracts single hit", () => {
    const msg = `ast-grep pattern "X" matched 1 occurrence(s) in forbidden glob "**/*.ts": lib/foo.ts:42`;
    expect(parseHits(msg)).toEqual([{ file: "lib/foo.ts", line: 42 }]);
  });

  it("extracts multiple comma-separated hits", () => {
    const msg = `matched 3 occurrence(s) in forbidden glob "**/*.ts": lib/a.ts:1, lib/b.ts:7, sub/c.ts:99`;
    expect(parseHits(msg)).toEqual([
      { file: "lib/a.ts", line: 1 },
      { file: "lib/b.ts", line: 7 },
      { file: "sub/c.ts", line: 99 },
    ]);
  });

  it("ignores trailing ellipsis", () => {
    const msg = `matched 25 occurrence(s) in forbidden glob "**/*.ts": a.ts:1, b.ts:2, c.ts:3, ...`;
    const hits = parseHits(msg);
    expect(hits.length).toBe(3);
    expect(hits).toEqual([
      { file: "a.ts", line: 1 },
      { file: "b.ts", line: 2 },
      { file: "c.ts", line: 3 },
    ]);
  });

  it("caps at 10 hits", () => {
    const pairs = Array.from({ length: 25 }, (_, i) => `f${i}.ts:${i + 1}`).join(", ");
    const msg = `matched 25 occurrence(s) in forbidden glob "**/*.ts": ${pairs}`;
    expect(parseHits(msg).length).toBe(10);
  });

  it("returns empty array on unparseable message (no colon-separated pairs after colon)", () => {
    expect(parseHits(`ast-grep pattern "X" did not match any occurrence`)).toEqual([]);
    expect(parseHits(`matched 0 occurrences`)).toEqual([]);
    expect(parseHits("")).toEqual([]);
  });

  it("handles paths with multiple dots and slashes", () => {
    const msg = `matched 1 occurrence(s) in forbidden glob "**/*.ts": packages/foo/src/bar.test.ts:123`;
    expect(parseHits(msg)).toEqual([{ file: "packages/foo/src/bar.test.ts", line: 123 }]);
  });
});

describe("classify — attaches hits for verify-pattern-found-where-forbidden", () => {
  it("includes hits when message is parseable", () => {
    const rule = { rule: "t", verify: { kind: "ast_pattern", lang: "ts", pattern: "x", forbid_in: "**/*.ts" } };
    const w = W("verify-pattern-found-where-forbidden", "/rules/0/verify",
      `matched 2 occurrence(s) in forbidden glob "**/*.ts": lib/a.ts:1, lib/b.ts:2`);
    const result = classify(0, rule, [w]);
    expect(result.status).toBe("failing");
    expect(result.hits).toEqual([
      { file: "lib/a.ts", line: 1 },
      { file: "lib/b.ts", line: 2 },
    ]);
  });

  it("omits hits when message is not parseable", () => {
    const rule = { rule: "t", verify: { kind: "glob_exists", path: "x" } };
    const w = W("verify-glob-empty", "/rules/0/verify", "glob matched no files");
    const result = classify(0, rule, [w]);
    expect(result.status).toBe("failing");
    expect(result.hits).toBeUndefined();
  });
});

describe("verifyRulesAtCommit — integration", () => {
  it("returns empty array when doc has no rules", async () => {
    const dir = setupRepoWith({ "package.json": "{}" });
    const result = await verifyRulesAtCommit(dir, { rules: [] });
    expect(result).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns unverified for every rule when none have verify clauses", async () => {
    const dir = setupRepoWith({ "package.json": "{}" });
    const result = await verifyRulesAtCommit(dir, {
      rules: [{ rule: "r1" }, { rule: "r2", why: "because" }],
    });
    expect(result).toEqual([
      { index: 0, status: "unverified" },
      { index: 1, status: "unverified" },
    ]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns passing for a glob_exists rule whose path exists", async () => {
    const dir = setupRepoWith({ "package.json": "{}" });
    const result = await verifyRulesAtCommit(dir, {
      rules: [{ rule: "must have package.json", verify: { kind: "glob_exists", path: "package.json" } }],
    });
    expect(result).toEqual([{ index: 0, status: "passing" }]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns failing for a glob_exists rule whose path is missing", async () => {
    const dir = setupRepoWith({ "package.json": "{}" });
    const result = await verifyRulesAtCommit(dir, {
      rules: [{ rule: "needs README", verify: { kind: "glob_exists", path: "README.md" } }],
    });
    expect(result).toEqual([{ index: 0, status: "failing" }]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("mixes statuses across rules", async () => {
    const dir = setupRepoWith({ "package.json": "{}" });
    const result = await verifyRulesAtCommit(dir, {
      rules: [
        { rule: "has pkg", verify: { kind: "glob_exists", path: "package.json" } },
        { rule: "needs README", verify: { kind: "glob_exists", path: "README.md" } },
        { rule: "no verifier" },
      ],
    });
    expect(result).toEqual([
      { index: 0, status: "passing" },
      { index: 1, status: "failing" },
      { index: 2, status: "unverified" },
    ]);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("verifyRulesAtCommit — timeout", () => {
  it("returns error status for verifiable rules and unverified for the rest when verifyCheck exceeds the timeout", async () => {
    process.env.ANATOMY_PER_RULE_TIMEOUT_MS = "1";
    try {
      const dir = setupRepoWith({ "a.ts": "x", "b.ts": "y", "c.ts": "z" });
      const result = await verifyRulesAtCommit(dir, {
        rules: [
          { rule: "r1", verify: { kind: "ast_pattern", lang: "ts", pattern: "console.log($X)", forbid_in: "**/*.ts" } },
          { rule: "r2" },
        ],
      });
      expect(result[0]).toEqual({ index: 0, status: "error", error: "verification timed out" });
      expect(result[1]).toEqual({ index: 1, status: "unverified" });
      rmSync(dir, { recursive: true, force: true });
    } finally {
      delete process.env.ANATOMY_PER_RULE_TIMEOUT_MS;
    }
  });
});

import { _resetMemo } from "../src/staleness-per-rule.js";

describe("verifyRulesAtCommit — memo", () => {
  it("returns the same array reference on a second call with the same headCommit", async () => {
    _resetMemo();
    const dir = setupRepoWith({ "package.json": "{}" });
    const doc = {
      rules: [{ rule: "must have pkg", verify: { kind: "glob_exists", path: "package.json" } }],
    };
    const first = await verifyRulesAtCommit(dir, doc, "abc1234");
    const second = await verifyRulesAtCommit(dir, doc, "abc1234");
    expect(second).toBe(first);
    rmSync(dir, { recursive: true, force: true });
  });

  it("re-runs on a different headCommit", async () => {
    _resetMemo();
    const dir = setupRepoWith({ "package.json": "{}" });
    const doc = {
      rules: [{ rule: "must have pkg", verify: { kind: "glob_exists", path: "package.json" } }],
    };
    const first = await verifyRulesAtCommit(dir, doc, "abc1234");
    const second = await verifyRulesAtCommit(dir, doc, "def5678");
    expect(second).not.toBe(first);
    expect(second).toEqual(first);
    rmSync(dir, { recursive: true, force: true });
  });

  it("evicts the oldest entry when the cache exceeds 8 distinct keys", async () => {
    _resetMemo();
    const dir = setupRepoWith({ "package.json": "{}" });
    const doc = {
      rules: [{ rule: "x", verify: { kind: "glob_exists", path: "package.json" } }],
    };
    const refs: unknown[] = [];
    for (let i = 0; i < 8; i++) {
      refs.push(await verifyRulesAtCommit(dir, doc, `commit${i}`));
    }
    expect(await verifyRulesAtCommit(dir, doc, "commit0")).toBe(refs[0]);
    await verifyRulesAtCommit(dir, doc, "commit8");
    expect(await verifyRulesAtCommit(dir, doc, "commit1")).not.toBe(refs[1]);
    rmSync(dir, { recursive: true, force: true });
  });
});
