// Task 10 — anatomy_brief v0.15 anti_patterns surfacing.
//   Surfacing model: cosine-rank against `pattern + reason + instead +
//   keywords.join(" ")`, +0.3 keyword boost when the query contains any of the
//   entry's keywords as a case-insensitive substring, then a *1.4 multiplier
//   when "planning language" (e.g. "should I", "considering", "plan to") is
//   present in the query. Threshold is EMBED_THRESHOLD (0.4) when planning
//   language is present, EMBED_THRESHOLD + 0.2 (0.6) when not — the raised
//   bar keeps anti_patterns from leaking into descriptive queries. Omitted
//   entirely when no query is supplied (anti_patterns are not edit-time
//   signals).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { sectionToolHandlers } from "../src/mcp/section-tools.js";
import { _setEmbedderForTesting } from "../src/embed/index.js";
import { _clearBriefCacheForTesting } from "../src/mcp/brief-tool.js";
import { buildAnatomyToml } from "./_helpers/fixture.js";

const ANTI_TOML_EXTRA = `[[anti_patterns]]
pattern = "Wrapping req/res in subclass objects"
reason = "Breaks instanceof; per-request allocation."
instead = "Mutate prototype on app.request / app.response."
keywords = ["wrapper", "subclass", "extend request"]
`;

const ANTI_TOML_EXTRA_TWO = `[[anti_patterns]]
pattern = "Wrapping req/res in subclass objects"
reason = "Breaks instanceof; per-request allocation."
instead = "Mutate prototype on app.request / app.response."
keywords = ["wrapper", "subclass", "extend request"]

[[anti_patterns]]
pattern = "Spawning a sub-process per request"
reason = "Process startup dominates latency at scale."
instead = "Use a worker pool warmed at boot."
keywords = ["wrapper", "subprocess", "spawn child"]
`;

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "brief-anti-"));
  execSync("git init -q", { cwd: tmp });
  execSync('git config user.email "t@t" && git config user.name "t"', { cwd: tmp });
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

type BriefAntiPatternEntry = {
  pattern: string;
  reason: string;
  instead?: string;
  keywords?: string[];
  score: number;
  reason_kind: string;
};
type BriefData = {
  anti_patterns?: BriefAntiPatternEntry[];
};

function antiToml(): string {
  return buildAnatomyToml({ version: "0.15", extraToml: ANTI_TOML_EXTRA });
}
function antiTomlTwo(): string {
  return buildAnatomyToml({ version: "0.15", extraToml: ANTI_TOML_EXTRA_TWO });
}

describe("anatomy_brief v0.15 anti_patterns surfacing", () => {
  it("surfaces when query has planning language + keyword overlap", async () => {
    // Query: "should I use a wrapper for the request" — has planning ("should I")
    // AND keyword ("wrapper" appears as substring). Embedder yields cosine 0.5
    // for the anti_pattern haystack. Final score: (0.5 + 0.3) * 1.4 = 1.12.
    // Threshold with planning present: EMBED_THRESHOLD (0.4). Passes.
    _setEmbedderForTesting(async (texts: string[]) =>
      // Anti-pattern entry text (joined) starts with "Wrapping req/res"; the
      // query text is whatever the caller passes verbatim.
      texts.map(t => /^Wrapping req\/res/.test(t) ? [1, 0] : [0.5, Math.sqrt(0.75)])
    );
    writeRepo(antiToml());

    const res = await sectionToolHandlers.anatomy_brief({
      path: tmp,
      query: "should I use a wrapper for the request",
    });
    if ("error" in res) throw new Error("unexpected error");
    const data = res.data as BriefData;
    expect(data.anti_patterns).toBeDefined();
    expect(data.anti_patterns).toHaveLength(1);
    expect(data.anti_patterns![0].pattern).toMatch(/Wrapping req/);
    expect(data.anti_patterns![0].reason_kind).toBe("keyword");
    // (0.5 + 0.3) * 1.4 = 1.12 (with float tolerance).
    expect(data.anti_patterns![0].score).toBeCloseTo(1.12, 5);
  });

  it("surfaces on keyword match with planning language (compound boost)", async () => {
    // Query: "considering a wrapper around the request object" — "considering"
    // is planning lexicon; "wrapper" is a literal substring of the keyword
    // "wrapper". Embedder yields cosine 0.0 (orthogonal) so only the keyword
    // boost + planning multiplier surfaces it: (0 + 0.3) * 1.4 = 0.42 ≥ 0.4.
    _setEmbedderForTesting(async (texts: string[]) =>
      texts.map(t => /^Wrapping req\/res/.test(t) ? [1, 0] : [0, 1])
    );
    writeRepo(antiToml());

    const res = await sectionToolHandlers.anatomy_brief({
      path: tmp,
      query: "considering a wrapper around the request object",
    });
    if ("error" in res) throw new Error("unexpected error");
    const data = res.data as BriefData;
    expect(data.anti_patterns).toBeDefined();
    expect(data.anti_patterns).toHaveLength(1);
    expect(data.anti_patterns![0].reason_kind).toBe("keyword");
  });

  it("omits when query lacks both planning language and keyword overlap", async () => {
    // Query: "what is the routing layer" — no planning verb, no keyword
    // substring overlap. Even if the embedder rated cosine 0.5, without the
    // planning multiplier the threshold becomes EMBED_THRESHOLD + 0.2 = 0.6.
    // 0.5 < 0.6, so filtered.
    _setEmbedderForTesting(async (texts: string[]) =>
      texts.map(t => /^Wrapping req\/res/.test(t) ? [1, 0] : [0.5, Math.sqrt(0.75)])
    );
    writeRepo(antiToml());

    const res = await sectionToolHandlers.anatomy_brief({
      path: tmp,
      query: "what is the routing layer",
    });
    if ("error" in res) throw new Error("unexpected error");
    const data = res.data as BriefData;
    expect(data.anti_patterns).toBeUndefined();
  });

  it("omits when no query is provided", async () => {
    // anti_patterns is a query-driven (intent) signal, not a file-edit signal.
    // Even though `path` resolves and the section exists, with no query the
    // section is omitted entirely.
    writeRepo(antiToml());

    const res = await sectionToolHandlers.anatomy_brief({ path: tmp });
    if ("error" in res) throw new Error("unexpected error");
    const data = res.data as BriefData;
    expect(data.anti_patterns).toBeUndefined();
  });

  it("respects anti_pattern_limit", async () => {
    // Both entries match on keyword "wrapper" + planning language; limit=1
    // restricts the response to 1. Embedder produces an orthogonal vec for
    // every input so cosine is always 0 — the keyword boost alone (with
    // planning multiplier) surfaces both entries equally, and slice(1) picks
    // one deterministically.
    _setEmbedderForTesting(async (texts: string[]) => texts.map(() => [0, 1]));
    writeRepo(antiTomlTwo());

    const res = await sectionToolHandlers.anatomy_brief({
      path: tmp,
      query: "should I use a wrapper",
      anti_pattern_limit: 1,
    });
    if ("error" in res) throw new Error("unexpected error");
    const data = res.data as BriefData;
    expect(data.anti_patterns).toBeDefined();
    expect(data.anti_patterns).toHaveLength(1);
  });
});
