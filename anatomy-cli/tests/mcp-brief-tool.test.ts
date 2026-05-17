import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { sectionToolHandlers } from "../src/mcp/section-tools.js";
import { _setEmbedderForTesting } from "../src/embed/index.js";
import { _clearBriefCacheForTesting } from "../src/mcp/brief-tool.js";
import { buildAnatomyToml } from "./_helpers/fixture.js";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "brief-"));
  execSync("git init -q", { cwd: tmp });
  execSync('git config user.email "t@t" && git config user.name "t"', { cwd: tmp });
  _setEmbedderForTesting(null);
  _clearBriefCacheForTesting();
});
afterEach(() => {
  _setEmbedderForTesting(undefined);
  _clearBriefCacheForTesting();
  rmSync(tmp, { recursive: true, force: true });
});

function writeRepo(toml: string): void {
  writeFileSync(join(tmp, ".anatomy"), toml);
  execSync("git add .anatomy && git commit -q -m init", { cwd: tmp });
}

type BriefData = {
  rules: Array<{ rule: string; why?: string; score: number; reason: "glob" | "embed" | "default" }>;
  memory: Array<{ id: string; bm25_score: number }>;
  flows: Array<{ name: string; summary: string; score?: number }>;
  hint?: string;
  identity: unknown;
  tagline: string;
};

describe("anatomy_brief — default response (no args)", () => {
  it("returns identity, tagline, all rules (default reason), empty memory, all flows", async () => {
    const toml = buildAnatomyToml({
      extraToml: `[[flows]]
name = "f1"
summary = "flow one summary"
`,
    });
    writeRepo(toml);

    const handler = sectionToolHandlers.anatomy_brief;
    expect(handler).toBeDefined();
    const res = await handler({ path: tmp });
    expect("error" in res).toBe(false);
    if ("error" in res) return;
    const data = res.data as BriefData;

    expect(data.identity).toBeDefined();
    expect(typeof data.tagline).toBe("string");
    expect(Array.isArray(data.rules)).toBe(true);
    expect(data.rules.every(r => r.reason === "default")).toBe(true);
    expect(data.memory).toEqual([]);
    expect(data.flows.length).toBeGreaterThan(0);
    expect(data.hint).toBeUndefined();
  });
});

describe("anatomy_brief — rules ranking (glob)", () => {
  it("matches file_path against rule verify.expect_in glob (ast_pattern)", async () => {
    const toml = buildAnatomyToml({
      version: "0.14",
      extraToml: `[[rules]]
rule = "always memoize React components"
verify = { kind = "ast_pattern", lang = "tsx", pattern = "export function $X(...): $$", expect_in = "src/components/**/*.tsx" }

[[rules]]
rule = "unrelated rule about backend"
why = "unrelated"
`,
    });
    writeRepo(toml);

    const res = await sectionToolHandlers.anatomy_brief({ path: tmp, file_path: "src/components/Card.tsx" });
    if ("error" in res) throw new Error("unexpected error");
    const data = res.data as BriefData;
    const matched = data.rules.filter(r => r.reason === "glob");
    expect(matched.length).toBe(1);
    expect(matched[0].rule).toMatch(/memoize React components/);
    expect(matched[0].score).toBe(1.0);
  });

  it("matches file_path against verify.path (glob_exists)", async () => {
    const toml = buildAnatomyToml({
      version: "0.14",
      extraToml: `[[rules]]
rule = "tests live in tests/"
verify = { kind = "glob_exists", path = "anatomy-cli/tests/*.test.ts" }
`,
    });
    writeRepo(toml);

    const res = await sectionToolHandlers.anatomy_brief({ path: tmp, file_path: "anatomy-cli/tests/foo.test.ts" });
    if ("error" in res) throw new Error("unexpected error");
    const data = res.data as BriefData;
    const matched = data.rules.filter(r => r.reason === "glob");
    expect(matched.length).toBe(1);
    expect(matched[0].score).toBe(1.0);
  });

  it("does not match file_path that doesn't fit any glob", async () => {
    const toml = buildAnatomyToml({
      version: "0.14",
      extraToml: `[[rules]]
rule = "tsx rule"
verify = { kind = "ast_pattern", lang = "tsx", pattern = "$X", expect_in = "src/**/*.tsx" }
`,
    });
    writeRepo(toml);

    const res = await sectionToolHandlers.anatomy_brief({ path: tmp, file_path: "src/main.go" });
    if ("error" in res) throw new Error("unexpected error");
    const data = res.data as BriefData;
    expect(data.rules.filter(r => r.reason === "glob").length).toBe(0);
  });
});

describe("anatomy_brief — rules ranking (embed)", () => {
  it("returns query-matched rules with reason embed when embedder is available", async () => {
    _setEmbedderForTesting(async (texts: string[]) =>
      texts.map(t => /memoize|react performance/i.test(t) ? [1, 0, 0] : [0, 1, 0])
    );

    const toml = buildAnatomyToml({
      extraToml: `[[rules]]
rule = "always memoize React components"
why = "perf"

[[rules]]
rule = "unrelated backend convention"
why = "n/a"
`,
    });
    writeRepo(toml);

    const res = await sectionToolHandlers.anatomy_brief({ path: tmp, query: "react performance optimization" });
    if ("error" in res) throw new Error("unexpected error");
    const data = res.data as BriefData;
    const matched = data.rules.filter(r => r.reason === "embed");
    expect(matched.length).toBe(1);
    expect(matched[0].rule).toMatch(/memoize/);
    expect(matched[0].score).toBeGreaterThanOrEqual(0.4);
  });

  it("returns no embed matches when scores are below threshold", async () => {
    // Rule embeds to [1,0,0]; query embeds to [0,1,0] → cosine 0 → below threshold.
    _setEmbedderForTesting(async (texts: string[]) =>
      texts.map(t => /unrelated rule alpha/.test(t) ? [1, 0, 0] : [0, 1, 0])
    );

    const toml = buildAnatomyToml({
      extraToml: `[[rules]]
rule = "unrelated rule alpha"
`,
    });
    writeRepo(toml);

    const res = await sectionToolHandlers.anatomy_brief({ path: tmp, query: "totally different topic" });
    if ("error" in res) throw new Error("unexpected error");
    const data = res.data as BriefData;
    expect(data.rules.filter(r => r.reason === "embed").length).toBe(0);
  });
});

describe("anatomy_brief — memory wiring", () => {
  it("returns BM25F-ranked memory entries when query is supplied", async () => {
    _setEmbedderForTesting(null);
    const { fingerprintFromPillars } = await import("@anatomy/validate");
    const fp = fingerprintFromPillars("javascript", "javascript-library", "test", "test");
    const toml = buildAnatomyToml({});
    writeRepo(toml);
    writeFileSync(join(tmp, ".anatomy-memory"), `anatomy_memory_version = "0.2"
repo_fingerprint = "${fp}"

[[entries]]
id = "abc12345"
at = "2026-05-01T00:00:00Z"
kind = "gotcha"
topic = "windows-spawn"
content = "spawnSync needs shell true on Windows for cmd shims"
attribution = "human:test"

[[entries]]
id = "def67890"
at = "2026-05-01T00:00:00Z"
kind = "decision"
topic = "unrelated"
content = "completely different content here"
attribution = "human:test"
`);

    const res = await sectionToolHandlers.anatomy_brief({ path: tmp, query: "spawnSync windows shell" });
    if ("error" in res) throw new Error("unexpected error");
    const data = res.data as BriefData;
    expect(data.memory.length).toBeGreaterThanOrEqual(1);
    expect(data.memory[0].id).toBe("abc12345");
  });

  it("returns empty memory when no query is supplied", async () => {
    _setEmbedderForTesting(null);
    const { fingerprintFromPillars } = await import("@anatomy/validate");
    const fp = fingerprintFromPillars("javascript", "javascript-library", "test", "test");
    const toml = buildAnatomyToml({});
    writeRepo(toml);
    writeFileSync(join(tmp, ".anatomy-memory"), `anatomy_memory_version = "0.2"
repo_fingerprint = "${fp}"

[[entries]]
id = "abc12345"
at = "2026-05-01T00:00:00Z"
kind = "gotcha"
topic = "x"
content = "y"
attribution = "human:test"
`);
    const res = await sectionToolHandlers.anatomy_brief({ path: tmp });
    if ("error" in res) throw new Error("unexpected error");
    const data = res.data as BriefData;
    expect(data.memory).toEqual([]);
  });
});

describe("anatomy_brief — flows ranking", () => {
  it("returns query-matched flows with reason embed", async () => {
    // generate-* flows embed to [1,0,0]; validate-* flows + query embed to mixed.
    _setEmbedderForTesting(async (texts: string[]) =>
      texts.map(t => /^generate-/m.test(t) || /generate a/i.test(t) ? [1, 0, 0] : [0, 1, 0])
    );
    const toml = buildAnatomyToml({
      extraToml: `[[flows]]
name = "generate-pipeline"
summary = "Pass 1 then Pass 2 then render"

[[flows]]
name = "validate-pipeline"
summary = "validate stuff"
`,
    });
    writeRepo(toml);

    const res = await sectionToolHandlers.anatomy_brief({ path: tmp, query: "how do I generate a pipeline" });
    if ("error" in res) throw new Error("unexpected error");
    const data = res.data as BriefData;
    expect(data.flows.length).toBe(1);
    expect(data.flows[0].name).toBe("generate-pipeline");
    expect(data.flows[0].score).toBeGreaterThanOrEqual(0.4);
  });

  it("returns all flows in source order when no query is supplied", async () => {
    _setEmbedderForTesting(null);
    const toml = buildAnatomyToml({
      extraToml: `[[flows]]
name = "f1"
summary = "one"

[[flows]]
name = "f2"
summary = "two"
`,
    });
    writeRepo(toml);

    const res = await sectionToolHandlers.anatomy_brief({ path: tmp });
    if ("error" in res) throw new Error("unexpected error");
    const data = res.data as BriefData;
    expect(data.flows.map(f => f.name)).toEqual(["f1", "f2"]);
    expect(data.flows[0].score).toBeUndefined();
  });
});

describe("anatomy_brief — hint logic", () => {
  it("sets hint when query supplied but nothing matches", async () => {
    // rule embeds to [1,0,0]; query embeds to [0,1,0] → no match
    _setEmbedderForTesting(async (texts: string[]) =>
      texts.map(t => /irrelevant rule/.test(t) ? [1, 0, 0] : [0, 1, 0])
    );
    const toml = buildAnatomyToml({
      extraToml: `[[rules]]
rule = "irrelevant rule"
`,
    });
    writeRepo(toml);

    const res = await sectionToolHandlers.anatomy_brief({ path: tmp, query: "query that matches nothing" });
    if ("error" in res) throw new Error("unexpected error");
    const data = res.data as BriefData;
    expect(data.rules).toEqual([]);
    expect(data.flows).toEqual([]);
    expect(data.memory).toEqual([]);
    expect(data.hint).toBeDefined();
    expect(data.hint).toMatch(/No anatomy context matched/);
  });

  it("sets hint when file_path supplied but no rule glob matches", async () => {
    _setEmbedderForTesting(null);
    const toml = buildAnatomyToml({});
    writeRepo(toml);

    const res = await sectionToolHandlers.anatomy_brief({ path: tmp, file_path: "no/match.go" });
    if ("error" in res) throw new Error("unexpected error");
    const data = res.data as BriefData;
    expect(data.rules).toEqual([]);
    expect(data.hint).toBeDefined();
  });

  it("does not set hint when results are returned", async () => {
    _setEmbedderForTesting(null);
    const toml = buildAnatomyToml({
      version: "0.14",
      extraToml: `[[rules]]
rule = "match me"
verify = { kind = "glob_exists", path = "src/**/*.ts" }
`,
    });
    writeRepo(toml);

    const res = await sectionToolHandlers.anatomy_brief({ path: tmp, file_path: "src/foo.ts" });
    if ("error" in res) throw new Error("unexpected error");
    const data = res.data as BriefData;
    expect(data.rules.length).toBeGreaterThan(0);
    expect(data.hint).toBeUndefined();
  });

  it("does not set hint when no args supplied (default view)", async () => {
    _setEmbedderForTesting(null);
    const toml = buildAnatomyToml({});
    writeRepo(toml);

    const res = await sectionToolHandlers.anatomy_brief({ path: tmp });
    if ("error" in res) throw new Error("unexpected error");
    const data = res.data as BriefData;
    expect(data.hint).toBeUndefined();
  });
});

describe("anatomy_brief — calibration against this repo", () => {
  it("query 'semgrep windows shell' surfaces the spawnSync rule + memory entry", async () => {
    _setEmbedderForTesting(undefined); // use the real embedder if installed
    _clearBriefCacheForTesting();
    const repoRoot = join(__dirname, "..", "..");
    const res = await sectionToolHandlers.anatomy_brief({
      path: repoRoot,
      query: "semgrep windows shell shim spawn",
    });
    if ("error" in res) throw new Error("resolveAnatomy failed against repo root");

    const { loadEmbedder } = await import("../src/embed/index.js");
    const embedder = await loadEmbedder();
    if (!embedder) {
      console.warn("[skip] @xenova/transformers not installed; calibration test is no-op");
      return;
    }

    const data = res.data as BriefData;
    const ruleHit = data.rules.find(r => /spawnSync|shell: true/i.test(r.rule));
    if (!ruleHit) {
      console.warn(`[calibration] spawnSync rule not surfaced. Top rules: ${data.rules.map(r => `[${r.reason} ${r.score.toFixed(2)}] ${r.rule.slice(0, 60)}`).join(" | ")}`);
    }
    expect(ruleHit, "expected spawnSync rule to be surfaced").toBeDefined();
    if (ruleHit) expect(ruleHit.score).toBeGreaterThanOrEqual(0.4);

    const memHit = data.memory.find(m => m.id === "t9ykw3em");
    expect(memHit, "expected memory entry t9ykw3em to be surfaced").toBeDefined();
  });
});

describe("anatomy_brief — cache behavior", () => {
  it("invalidates cache when repo_fingerprint changes", async () => {
    let embedCalls = 0;
    _setEmbedderForTesting(async (texts: string[]) => {
      embedCalls += texts.length;
      return texts.map(() => [1, 0, 0]);
    });

    const toml1 = buildAnatomyToml({
      extraToml: `[[rules]]
rule = "alpha"
`,
    });
    writeRepo(toml1);
    await sectionToolHandlers.anatomy_brief({ path: tmp, query: "alpha" });
    const callsAfterFirst = embedCalls;
    await sectionToolHandlers.anatomy_brief({ path: tmp, query: "alpha" });
    // Query embedding happens per call; rule embedding should be cached.
    // So second call should add exactly 1 (the query), not (1 + N rules).
    expect(embedCalls).toBe(callsAfterFirst + 1);

    // Rewrite with different domain → different fingerprint → cache invalidation.
    const toml2 = buildAnatomyToml({
      domain: "different-domain",
      extraToml: `[[rules]]
rule = "alpha"
`,
    });
    writeFileSync(join(tmp, ".anatomy"), toml2);
    execSync("git add .anatomy && git commit -q -m bump", { cwd: tmp });

    const callsBeforeThird = embedCalls;
    await sectionToolHandlers.anatomy_brief({ path: tmp, query: "alpha" });
    // Cache miss: re-embedded N rules + 1 query, so > +1 from before.
    expect(embedCalls).toBeGreaterThan(callsBeforeThird + 1);
  });
});
