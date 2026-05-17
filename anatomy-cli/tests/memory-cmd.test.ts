import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const BIN = resolve(import.meta.dirname, "../dist/bin.js");

// ANATOMY_DISABLE_EMBEDDINGS=1 forces lexical-only ranking: the built
// dist/bin.js runs in a separate process the in-process _setEmbedderForTesting
// hook cannot reach, and @xenova/transformers is an installed optional dep, so
// without this `anatomy memory search` would load the real model
// (slow/networked/nondeterministic). Degraded mode is byte-identical to the
// pre-hybrid BM25F×decay output, so every assertion below stays valid.
function run(args: string[], cwd: string) {
  const r = spawnSync("node", [BIN, ...args], {
    cwd, encoding: "utf8",
    env: { ...process.env, ANATOMY_BY: "human:test", ANATOMY_DISABLE_EMBEDDINGS: "1" },
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", code: r.status ?? 1 };
}

function makeRepoWithMemory(): { root: string; ids: string[] } {
  const root = mkdtempSync(join(tmpdir(), "anat-mem-"));
  writeFileSync(join(root, ".anatomy"), `anatomy_version = "0.7"
tagline = "test"
[identity]
stack = "typescript"
form = "library"
domain = "test"
function = "test"
fingerprint = "abcdefghijklmnopqrst"
[generated]
at = 2026-05-08T00:00:00Z
by = "test"
model = "none"
schema = "https://anatomy.dev/spec/0.7/schema.json"
`);
  const ids: string[] = [];
  for (const [kind, topic, content] of [
    ["gotcha", "g1", "g1 content"],
    ["decision", "d1", "d1 content"],
    ["convention", "c1", "c1 content"],
  ] as const) {
    const r = run(["add", kind, topic, content], root);
    expect(r.code).toBe(0);
    const m = r.stdout.match(/entry ([a-z0-9]{8}) /);
    expect(m).not.toBeNull();
    ids.push(m![1]);
  }
  return { root, ids };
}

describe("anatomy memory deprecate", () => {
  it("sets deprecated_at and deprecated_reason on existing entry", () => {
    const { root, ids } = makeRepoWithMemory();
    const r = run(["memory", "deprecate", ids[0], "--reason", "no longer relevant"], root);
    expect(r.code).toBe(0);
    const text = readFileSync(join(root, ".anatomy-memory"), "utf8");
    expect(text).toContain("deprecated_reason");
    expect(text).toContain("no longer relevant");
  });

  it("errors on unknown id", () => {
    const { root } = makeRepoWithMemory();
    const r = run(["memory", "deprecate", "zzzzzzzz", "--reason", "x"], root);
    expect(r.code).not.toBe(0);
  });

  it("errors when --reason is missing", () => {
    const { root, ids } = makeRepoWithMemory();
    const r = run(["memory", "deprecate", ids[0]], root);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/reason/i);
  });

  it("errors when deprecate is called on already-deprecated entry", () => {
    const { root, ids } = makeRepoWithMemory();
    const r1 = run(["memory", "deprecate", ids[0], "--reason", "first reason"], root);
    expect(r1.code).toBe(0);
    const r2 = run(["memory", "deprecate", ids[0], "--reason", "second reason"], root);
    expect(r2.code).not.toBe(0);
    expect(r2.stderr).toMatch(/already deprecated/);
    // Original reason still in file
    const text = readFileSync(join(root, ".anatomy-memory"), "utf8");
    expect(text).toContain("first reason");
    expect(text).not.toContain("second reason");
  });
});

describe("anatomy memory list", () => {
  it("lists entries in tabular form", () => {
    const { root } = makeRepoWithMemory();
    const r = run(["memory", "list"], root);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("g1");
    expect(r.stdout).toContain("d1");
    expect(r.stdout).toContain("c1");
  });

  it("filters by --kind", () => {
    const { root, ids } = makeRepoWithMemory();
    const r = run(["memory", "list", "--kind", "gotcha"], root);
    expect(r.code).toBe(0);
    // Assert on full 8-char entry ids, not 2-char topics: the list table has
    // a generated Crockford-base32 id column, so a 2-char substring like "d1"
    // collides with a random id ~0.7%/run (flaked once on macOS CI). ids =
    // [gotcha, decision, convention] per makeRepoWithMemory's seed order.
    expect(r.stdout).toContain(ids[0]);
    expect(r.stdout).not.toContain(ids[1]);
    expect(r.stdout).not.toContain(ids[2]);
  });

  it("filters by --topic substring", () => {
    const { root, ids } = makeRepoWithMemory();
    const r = run(["memory", "list", "--topic", "d"], root);
    expect(r.code).toBe(0);
    // Same id-collision hazard as --kind above: assert on full ids.
    expect(r.stdout).toContain(ids[1]);
    expect(r.stdout).not.toContain(ids[0]);
  });

  it("hides deprecated entries by default; shows with --include-superseded", () => {
    const { root, ids } = makeRepoWithMemory();
    run(["memory", "deprecate", ids[0], "--reason", "x"], root);
    const without = run(["memory", "list"], root);
    expect(without.stdout).not.toContain(ids[0]);
    const withFlag = run(["memory", "list", "--include-superseded"], root);
    expect(withFlag.stdout).toContain(ids[0]);
  });
});

describe("anatomy memory grep", () => {
  it("matches substring in topic and content", () => {
    const { root } = makeRepoWithMemory();
    const r = run(["memory", "grep", "g1"], root);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("g1");
    expect(r.stdout).not.toContain("d1");
  });

  it("returns no-match output when nothing matches", () => {
    const { root } = makeRepoWithMemory();
    const r = run(["memory", "grep", "nonexistent-xyz-zzz"], root);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/no match/i);
  });
});

describe("anatomy memory show <id>", () => {
  it("displays full entry detail for an id", () => {
    const { root, ids } = makeRepoWithMemory();
    const r = run(["memory", "show", ids[0]], root);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(ids[0]);
    expect(r.stdout).toContain("g1");
    expect(r.stdout).toContain("g1 content");
  });

  it("errors on unknown id", () => {
    const { root } = makeRepoWithMemory();
    const r = run(["memory", "show", "zzzzzzzz"], root);
    expect(r.code).not.toBe(0);
  });
});

describe("anatomy memory stats", () => {
  it("emits per-kind counts", () => {
    const { root } = makeRepoWithMemory();
    const r = run(["memory", "stats"], root);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/gotcha:.*1.*active/);
    expect(r.stdout).toMatch(/decision:.*1.*active/);
    expect(r.stdout).toMatch(/convention:.*1.*active/);
    expect(r.stdout).toMatch(/attempt:.*0.*active/);
  });
});

function runAs(args: string[], cwd: string, by: string) {
  const r = spawnSync("node", [BIN, ...args], {
    cwd, encoding: "utf8",
    env: { ...process.env, ANATOMY_BY: by, ANATOMY_DISABLE_EMBEDDINGS: "1" },
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", code: r.status ?? 1 };
}

describe("anatomy memory thanks", () => {
  it("records helped_count and helped_by on the entry", () => {
    const { root, ids } = makeRepoWithMemory();
    const r = runAs(["memory", "thanks", ids[0]], root, "human:bob");
    expect(r.code).toBe(0);
    const text = readFileSync(join(root, ".anatomy-memory"), "utf8");
    expect(text).toMatch(/helped_count\s*=\s*1/);
    expect(text).toContain('"human:bob"');
  });

  it("is idempotent: same identity thanking twice does not double-count", () => {
    const { root, ids } = makeRepoWithMemory();
    runAs(["memory", "thanks", ids[0]], root, "human:bob");
    const r2 = runAs(["memory", "thanks", ids[0]], root, "human:bob");
    expect(r2.code).toBe(0);
    const text = readFileSync(join(root, ".anatomy-memory"), "utf8");
    expect(text).toMatch(/helped_count\s*=\s*1/);
    // helped_by should contain "human:bob" exactly once
    const matches = text.match(/"human:bob"/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("accumulates distinct thankers", () => {
    const { root, ids } = makeRepoWithMemory();
    runAs(["memory", "thanks", ids[0]], root, "human:bob");
    runAs(["memory", "thanks", ids[0]], root, "human:carol");
    runAs(["memory", "thanks", ids[0]], root, "human:dana");
    const text = readFileSync(join(root, ".anatomy-memory"), "utf8");
    expect(text).toMatch(/helped_count\s*=\s*3/);
    expect(text).toContain('"human:bob"');
    expect(text).toContain('"human:carol"');
    expect(text).toContain('"human:dana"');
  });

  it("errors on unknown id", () => {
    const { root } = makeRepoWithMemory();
    const r = runAs(["memory", "thanks", "zzzzzzzz"], root, "human:bob");
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/no entry/);
  });

  it("errors when no .anatomy-memory exists", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-mem-empty-"));
    writeFileSync(join(root, ".anatomy"), `anatomy_version = "0.7"
tagline = "test"
[identity]
stack = "typescript"
form = "library"
domain = "test"
function = "test"
fingerprint = "abcdefghijklmnopqrst"
[generated]
at = 2026-05-08T00:00:00Z
by = "test"
model = "none"
schema = "https://anatomy.dev/spec/0.7/schema.json"
`);
    const r = runAs(["memory", "thanks", "abcdefgh"], root, "human:bob");
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/no \.anatomy-memory/);
  });

  it("does not credit unknown or claude-session thankers", () => {
    const { root, ids } = makeRepoWithMemory();
    // Skip ANATOMY_BY override; default detectBy will hit git config or fall through.
    // Force "unknown" via empty override and unset CLAUDECODE.
    const r = spawnSync("node", [BIN, "memory", "thanks", ids[0]], {
      cwd: root, encoding: "utf8",
      env: { ...process.env, ANATOMY_BY: "unknown", CLAUDECODE: "" },
    });
    expect(r.status).not.toBe(0);
    expect((r.stderr ?? "")).toMatch(/cannot record thanks/);
  });
});

describe("anatomy memory credits", () => {
  it("emits a markdown table with handle, contributions, helped counts", () => {
    const { root, ids } = makeRepoWithMemory();
    runAs(["memory", "thanks", ids[0]], root, "human:bob");
    runAs(["memory", "thanks", ids[0]], root, "human:carol");
    const r = run(["memory", "credits"], root);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/# Memory Contributors/);
    expect(r.stdout).toContain("| Contributor |");
    // human:test is the author of all 3 seed entries
    expect(r.stdout).toContain("@test");
    expect(r.stdout).toContain("https://github.com/test");
  });

  it("links GitHub profiles for human: contributors", () => {
    const { root, ids } = makeRepoWithMemory();
    runAs(["memory", "thanks", ids[0]], root, "human:bob");
    const r = run(["memory", "credits"], root);
    expect(r.stdout).toContain("[@bob](https://github.com/bob)");
  });

  it("excludes deprecated/superseded entries from the contribution count", () => {
    const { root, ids } = makeRepoWithMemory();
    // Deprecate one of human:test's entries
    run(["memory", "deprecate", ids[0], "--reason", "obsolete"], root);
    const r = run(["memory", "credits"], root);
    expect(r.code).toBe(0);
    // human:test still has 2 active entries (decision + convention)
    const testRow = r.stdout.split("\n").find(l => l.includes("@test"));
    expect(testRow).toMatch(/\|\s*2\s*\|/);
  });

  it("counts thanker activity in a separate column", () => {
    const { root, ids } = makeRepoWithMemory();
    runAs(["memory", "thanks", ids[0]], root, "human:bob");
    runAs(["memory", "thanks", ids[1]], root, "human:bob");
    const r = run(["memory", "credits"], root);
    // bob has thanked 2 entries, contributed 0
    const bobRow = r.stdout.split("\n").find(l => l.includes("@bob"));
    expect(bobRow).toBeDefined();
    expect(bobRow).toMatch(/@bob.*\|\s*0\s*\|\s*0\s*\|\s*2/);
  });

  it("errors when no .anatomy-memory exists", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-mem-cred-empty-"));
    const r = run(["memory", "credits"], root);
    expect(r.code).not.toBe(0);
  });

  it("uses helped_by.length, not the cached helped_count, as authoritative", () => {
    const { root, ids } = makeRepoWithMemory();
    runAs(["memory", "thanks", ids[0]], root, "human:bob");
    // Hand-edit: inflate helped_count to 99, leaving helped_by = ["human:bob"]
    const memPath = join(root, ".anatomy-memory");
    const tampered = readFileSync(memPath, "utf8")
      .replace(/helped_count\s*=\s*\d+/, "helped_count = 99");
    writeFileSync(memPath, tampered, "utf8");
    const r = run(["memory", "credits"], root);
    expect(r.code).toBe(0);
    const testRow = r.stdout.split("\n").find(l => l.includes("@test"));
    // Helped others column should be 1, not 99
    expect(testRow).toContain("| 1 | 0 |");
    expect(testRow).not.toContain("| 99 |");
  });
});

describe("anatomy memory search", () => {
  it("ranks entries by BM25F × decay", () => {
    const { root } = makeRepoWithMemory();
    const r = run(["memory", "search", "g1"], root);
    expect(r.code).toBe(0);
    // g1 is the gotcha topic; ranked first.
    expect(r.stdout).toMatch(/\bg1\b/);
    expect(r.stdout).toMatch(/Memory search results for/);
    expect(r.stdout).toMatch(/ranked by BM25F/);
  });

  it("respects --kind filter", () => {
    const { root } = makeRepoWithMemory();
    const r = run(["memory", "search", "content", "--kind", "decision"], root);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("d1");
    expect(r.stdout).not.toContain("g1 content");
  });

  it("respects --limit", () => {
    const { root } = makeRepoWithMemory();
    const r = run(["memory", "search", "content", "--limit", "1"], root);
    expect(r.code).toBe(0);
    const matches = r.stdout.match(/^\[[a-z0-9]{8}\]/gm) ?? [];
    expect(matches.length).toBe(1);
  });

  it("default limit is 10", () => {
    const { root } = makeRepoWithMemory();
    const r = run(["memory", "search", "content"], root);
    expect(r.code).toBe(0);
    // 3 entries in fixture all contain "content"; all show up.
    const matches = r.stdout.match(/^\[[a-z0-9]{8}\]/gm) ?? [];
    expect(matches.length).toBe(3);
  });

  it("annotates each result with a decay bucket", () => {
    const { root } = makeRepoWithMemory();
    const r = run(["memory", "search", "content"], root);
    expect(r.code).toBe(0);
    // Each result line ends with " (untouched)" since none has last_verified_at.
    expect(r.stdout).toMatch(/\(untouched\)/);
  });

  it("errors with usage when query positional is missing", () => {
    const { root } = makeRepoWithMemory();
    const r = run(["memory", "search"], root);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/usage/i);
  });

  it("errors with usage when query is empty string", () => {
    const { root } = makeRepoWithMemory();
    const r = run(["memory", "search", ""], root);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/usage/i);
  });

  it("prints '(no match)' when nothing matches", () => {
    const { root } = makeRepoWithMemory();
    const r = run(["memory", "search", "zzzunknownword"], root);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/no match/);
  });

  it("listed as a known subcommand", () => {
    const { root } = makeRepoWithMemory();
    const r = run(["memory", "unknown"], root);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("search");
  });

  it("respects --tag filter", () => {
    const { root } = makeRepoWithMemory();
    // Append a tagged entry directly to the fixture's memory file.
    const memPath = join(root, ".anatomy-memory");
    const text = readFileSync(memPath, "utf8");
    writeFileSync(memPath, text + `\n[[entries]]\nid = "ttt77777"\nkind = "convention"\ntopic = "tagged entry"\ncontent = "has a tag"\nat = "2026-05-13T00:00:00Z"\nby = "human:test"\ntags = ["bm25-target"]\n`);
    const r = run(["memory", "search", "tagged", "--tag", "bm25-target"], root);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("ttt77777");
  });

  it("respects --ref filter", () => {
    const { root } = makeRepoWithMemory();
    const memPath = join(root, ".anatomy-memory");
    const text = readFileSync(memPath, "utf8");
    writeFileSync(memPath, text + `\n[[entries]]\nid = "rrr88888"\nkind = "convention"\ntopic = "ref entry"\ncontent = "has a ref"\nat = "2026-05-13T00:00:00Z"\nby = "human:test"\nrefs = ["docs/spec.md"]\n`);
    const r = run(["memory", "search", "ref", "--ref", "docs/spec.md"], root);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("rrr88888");
  });
});

describe("anatomy memory verify (v0.2)", () => {
  /** Force the makeRepoWithMemory fixture's auto-created file back to v0.1
   *  so we can test the v0.1 → v0.2 bump on first verify. (Fresh `anatomy add`
   *  files are written with v0.2 from the start since the CLI's MEMORY_VERSION
   *  constant is now "0.2".) */
  function downgradeMemoryToV01(root: string): void {
    const memPath = join(root, ".anatomy-memory");
    const text = readFileSync(memPath, "utf8")
      .replace(/^anatomy_memory_version = "0.2"/, 'anatomy_memory_version = "0.1"');
    writeFileSync(memPath, text, "utf8");
  }

  it("happy path against a v0.1 file: bumps to v0.2 and confirms entry", () => {
    const { root, ids } = makeRepoWithMemory();
    downgradeMemoryToV01(root);
    const r = run(["memory", "verify", ids[0]], root);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(`✓ verified ${ids[0]}`);
    expect(r.stdout).toContain(`bumped .anatomy-memory header to anatomy_memory_version = "0.2"`);
    const text = readFileSync(join(root, ".anatomy-memory"), "utf8");
    expect(text).toContain('anatomy_memory_version = "0.2"');
    expect(text).toContain("last_verified_at");
    expect(text).toContain('verified_by = ["human:test"]');
  });

  it("happy path against a v0.2 file: confirms entry without bump-message", () => {
    const { root, ids } = makeRepoWithMemory();
    // Fresh `anatomy add` already produced v0.2; verify on a fresh entry adds fields without re-bumping.
    const r = run(["memory", "verify", ids[0]], root);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(`✓ verified ${ids[0]}`);
    expect(r.stdout).not.toContain("bumped .anatomy-memory header");
    const text = readFileSync(join(root, ".anatomy-memory"), "utf8");
    expect(text).toContain("last_verified_at");
  });

  it("second verify on already-v0.2 file does not re-emit the version-bump message", () => {
    const { root, ids } = makeRepoWithMemory();
    downgradeMemoryToV01(root);
    run(["memory", "verify", ids[0]], root);
    const r2 = run(["memory", "verify", ids[1]], root);
    expect(r2.code).toBe(0);
    expect(r2.stdout).not.toContain("bumped .anatomy-memory header");
  });

  it("errors with no .anatomy-memory file", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-mem-"));
    const r = run(["memory", "verify", "abcd1234"], root);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/no \.anatomy-memory/);
  });

  it("errors with unknown id", () => {
    const { root } = makeRepoWithMemory();
    const r = run(["memory", "verify", "zzzzzzzz"], root);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/no entry with id/);
  });

  it("memory list shows decay column with `fresh` after verify", () => {
    const { root, ids } = makeRepoWithMemory();
    // Pre-verify: untouched.
    const before = run(["memory", "list", "--kind", "gotcha"], root);
    expect(before.stdout).toMatch(/untouched/);
    // Verify, then re-list.
    run(["memory", "verify", ids[0]], root);
    const after = run(["memory", "list", "--kind", "gotcha"], root);
    expect(after.stdout).toMatch(/fresh/);
  });

  it("memory stats shows untouched count before verify, fresh count after", () => {
    const { root, ids } = makeRepoWithMemory();
    const before = run(["memory", "stats"], root);
    expect(before.stdout).toMatch(/untouched/);
    run(["memory", "verify", ids[0]], root);
    const after = run(["memory", "stats"], root);
    expect(after.stdout).toMatch(/fresh: 1/);
  });
});
