import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const BIN = resolve(import.meta.dirname, "../dist/bin.js");

function run(args: string[], cwd: string, input?: string) {
  const r = spawnSync("node", [BIN, ...args], {
    cwd, encoding: "utf8", input,
    env: { ...process.env, ANATOMY_BY: "human:test", EDITOR: "" },
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", code: r.status ?? 1 };
}

function makeRepoWithAnatomy(): string {
  const root = mkdtempSync(join(tmpdir(), "anat-add-"));
  // Use any valid 20-char fingerprint — for tests we don't need the real one
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
  return root;
}

describe("anatomy add", () => {
  it("creates .anatomy-memory on first add and appends entry", () => {
    const root = makeRepoWithAnatomy();
    const r = run(["add", "gotcha", "test-topic", "test content here"], root);
    expect(r.code).toBe(0);
    const mem = readFileSync(join(root, ".anatomy-memory"), "utf8");
    expect(mem).toContain('repo_fingerprint = "abcdefghijklmnopqrst"');
    expect(mem).toContain("[[entries]]");
    expect(mem).toContain('kind = "gotcha"');
    expect(mem).toContain('topic = "test-topic"');
    expect(mem).toContain('content = "test content here"');
    expect(mem).toContain('by = "human:test"');
  });

  it("errors when .anatomy does not exist", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-add-"));
    const r = run(["add", "gotcha", "x", "y"], root);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/anatomy generate/);
  });

  it("rejects unknown kind", () => {
    const root = makeRepoWithAnatomy();
    const r = run(["add", "lesson", "x", "y"], root);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/kind/i);
  });

  it("accepts milestone kind", () => {
    const root = makeRepoWithAnatomy();
    const r = run(["add", "milestone", "v1-release", "cut v1.0 release"], root);
    expect(r.code).toBe(0);
    const mem = readFileSync(join(root, ".anatomy-memory"), "utf8");
    expect(mem).toContain('kind = "milestone"');
    expect(mem).toContain('topic = "v1-release"');
  });

  it("appends second entry without modifying first", () => {
    const root = makeRepoWithAnatomy();
    run(["add", "gotcha", "first", "first content"], root);
    run(["add", "decision", "second", "second content"], root);
    const mem = readFileSync(join(root, ".anatomy-memory"), "utf8");
    expect(mem.match(/\[\[entries\]\]/g)?.length).toBe(2);
    expect(mem).toContain('topic = "first"');
    expect(mem).toContain('topic = "second"');
  });

  it("--supersedes patches the old entry's superseded_by", () => {
    const root = makeRepoWithAnatomy();
    const r1 = run(["add", "gotcha", "topic-a", "old"], root);
    expect(r1.code).toBe(0);
    // Extract id from output
    const idMatch = r1.stdout.match(/[a-z0-9]{8}/);
    expect(idMatch).not.toBeNull();
    const oldId = idMatch![0];
    const r2 = run(["add", "gotcha", "topic-a", "new", "--supersedes", oldId], root);
    expect(r2.code).toBe(0);
    const mem = readFileSync(join(root, ".anatomy-memory"), "utf8");
    expect(mem).toContain(`superseded_by`);
  });

  it("--supersedes does not append a ghost entry if target id is unknown", () => {
    const root = makeRepoWithAnatomy();
    run(["add", "gotcha", "first", "first content"], root);
    const r = run(["add", "gotcha", "second", "second content", "--supersedes", "zzzzzzzz"], root);
    expect(r.code).not.toBe(0);
    const mem = readFileSync(join(root, ".anatomy-memory"), "utf8");
    // Only the first entry should be present
    expect(mem.match(/\[\[entries\]\]/g)?.length).toBe(1);
    expect(mem).not.toContain("second content");
  });

  it("reads content from stdin when content arg is '-'", () => {
    const root = makeRepoWithAnatomy();
    const r = run(["add", "gotcha", "stdin-topic", "-"], root, "stdin content here\n");
    expect(r.code).toBe(0);
    const mem = readFileSync(join(root, ".anatomy-memory"), "utf8");
    expect(mem).toContain("stdin content here");
  });

  it("--refs sets refs as csv", () => {
    const root = makeRepoWithAnatomy();
    run(["add", "convention", "t", "c", "--refs", "src/foo.ts,git:abc1234"], root);
    const mem = readFileSync(join(root, ".anatomy-memory"), "utf8");
    expect(mem).toContain("src/foo.ts");
    expect(mem).toContain("git:abc1234");
  });

  it("--tags sets tags as csv", () => {
    const root = makeRepoWithAnatomy();
    run(["add", "convention", "t", "c", "--tags", "alpha,beta"], root);
    const mem = readFileSync(join(root, ".anatomy-memory"), "utf8");
    expect(mem).toMatch(/tags = \[.*"alpha".*"beta".*\]/);
  });
});

describe("anatomy show --prose with memory", () => {
  it("includes memory section after .anatomy section when memory exists", () => {
    const root = makeRepoWithAnatomy();
    run(["add", "convention", "test-conv", "convention content"], root);
    const r = run(["show", "--prose"], root);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("## Memory");
    expect(r.stdout).toContain("test-conv");
  });

  it("--no-memory suppresses memory section", () => {
    const root = makeRepoWithAnatomy();
    run(["add", "convention", "test-conv", "convention content"], root);
    const r = run(["show", "--prose", "--no-memory"], root);
    expect(r.code).toBe(0);
    expect(r.stdout).not.toContain("## Memory");
  });

  it("--memory-only emits only the memory section", () => {
    const root = makeRepoWithAnatomy();
    run(["add", "convention", "test-conv", "convention content"], root);
    const r = run(["show", "--prose", "--memory-only"], root);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("## Memory");
    expect(r.stdout).not.toMatch(/^Stack:/m);
  });

  it("ignores non-numeric --memory-limit-gotcha (treats as default)", () => {
    const root = makeRepoWithAnatomy();
    run(["add", "gotcha", "g1", "g1 content"], root);
    const r = run(["show", "--prose", "--memory-limit-gotcha", "all"], root);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("g1");
    expect(r.stdout).not.toMatch(/NaN/);
  });

  it("--memory-limit-milestone caps the milestones section", () => {
    const root = makeRepoWithAnatomy();
    run(["add", "milestone", "m1", "m1 content"], root);
    run(["add", "milestone", "m2", "m2 content"], root);
    run(["add", "milestone", "m3", "m3 content"], root);
    const r = run(["show", "--prose", "--memory-limit-milestone", "1"], root);
    expect(r.code).toBe(0);
    // Newest first: m3 shown, m1 + m2 hidden
    expect(r.stdout).toContain("m3");
    expect(r.stdout).not.toContain("m2 content");
    expect(r.stdout).toMatch(/2 older entries not shown/);
  });

  it("--memory-limit-convention caps the conventions section (default is uncapped)", () => {
    const root = makeRepoWithAnatomy();
    run(["add", "convention", "c1", "c1 content"], root);
    run(["add", "convention", "c2", "c2 content"], root);
    run(["add", "convention", "c3", "c3 content"], root);
    // Default: all 3 shown (uncapped)
    const r1 = run(["show", "--prose"], root);
    expect(r1.stdout).toContain("c1 content");
    expect(r1.stdout).toContain("c2 content");
    expect(r1.stdout).toContain("c3 content");
    // With --memory-limit-convention=1: only newest shown
    const r2 = run(["show", "--prose", "--memory-limit-convention", "1"], root);
    expect(r2.code).toBe(0);
    expect(r2.stdout).toContain("c3");
    expect(r2.stdout).not.toContain("c1 content");
    expect(r2.stdout).toMatch(/2 older entries not shown/);
  });
});
