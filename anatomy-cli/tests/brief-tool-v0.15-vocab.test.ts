// Task 8 — anatomy_brief v0.15 vocabulary surfacing.
//   Surfacing model: semantic match via the embed pipeline against
//   `term + meaning + aliases`, with a +0.5 hard boost when the query contains
//   the entry's term or any alias as a case-insensitive substring. Returns
//   top vocab_limit (default 5) above EMBED_THRESHOLD; omitted entirely when
//   nothing matches.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { sectionToolHandlers } from "../src/mcp/section-tools.js";
import { _setEmbedderForTesting } from "../src/embed/index.js";
import { _clearBriefCacheForTesting } from "../src/mcp/brief-tool.js";
import { buildAnatomyToml } from "./_helpers/fixture.js";

const VOCAB_TOML_EXTRA = `[[vocabulary]]
term = "Layer"
meaning = "A node in the router stack pairing a path pattern with a middleware fn."
aliases = ["Rtr", "stack-node"]

[[vocabulary]]
term = "Application"
meaning = "The top-level Express instance with its own settings."
`;

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "brief-vocab-"));
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

type BriefVocabEntry = {
  term: string;
  meaning: string;
  aliases?: string[];
  contrast?: string[];
  score: number;
  reason: string;
};
type BriefData = {
  vocabulary?: BriefVocabEntry[];
};

function vocabToml(): string {
  return buildAnatomyToml({ version: "0.15", extraToml: VOCAB_TOML_EXTRA });
}

describe("anatomy_brief v0.15 vocabulary surfacing", () => {
  it("returns matching vocab on semantic query", async () => {
    // Fake embedder: "Layer" entry text + "router node" query → similar.
    _setEmbedderForTesting(async (texts: string[]) =>
      texts.map(t => /router stack|router node/i.test(t) ? [1, 0, 0] : [0, 1, 0])
    );
    writeRepo(vocabToml());

    const res = await sectionToolHandlers.anatomy_brief({ path: tmp, query: "what is a router node" });
    if ("error" in res) throw new Error("unexpected error");
    const data = res.data as BriefData;
    expect(data.vocabulary).toBeDefined();
    expect(data.vocabulary![0].term).toBe("Layer");
  });

  it("exact-token term match wins over semantic neighbor (+0.5 boost)", async () => {
    // Verify the boost actually matters: rig the embedder so the Layer entry
    // scores higher than the Application entry on a query that nonetheless
    // contains the exact term "Application". Without the +0.5 boost, Layer
    // would win on cosine alone (0.70 vs 0.45). With the boost, Application's
    // exact-term match bumps it to 0.95 and it wins. This pins the contract
    // that exact-term lookups always beat fuzzy semantic neighbors.
    _setEmbedderForTesting(async (texts: string[]) => {
      return texts.map(t => {
        // The lone query embedding call passes the raw query text.
        if (/^Application$/.test(t)) return [0.70, 0.45];           // query vec
        if (/^Layer/.test(t)) return [1, 0];                        // Layer entry — cosine 0.70
        return [0, 1];                                              // Application entry — cosine 0.45
      });
    });
    writeRepo(vocabToml());

    const res = await sectionToolHandlers.anatomy_brief({ path: tmp, query: "Application" });
    if ("error" in res) throw new Error("unexpected error");
    const data = res.data as BriefData;
    expect(data.vocabulary).toBeDefined();
    expect(data.vocabulary![0].term).toBe("Application");
    expect(data.vocabulary![0].reason).toBe("exact-token");
  });

  it("matches against aliases", async () => {
    // Query "Rtr" matches Layer's alias substring. Critically, "rtr" does NOT
    // contain "layer" (the term) as a substring, so the term-substring branch
    // does NOT fire — the alias-iteration branch is the only path that can
    // surface this entry. The embedder is rigged so the query is orthogonal
    // to all entries (cosine = 0). Only the alias boost (+0.5, above
    // EMBED_THRESHOLD 0.4) brings Layer into the result. Application has no
    // matching term/alias substring, so it stays at 0 and is filtered out.
    _setEmbedderForTesting(async (texts: string[]) => {
      return texts.map(t => /^Rtr$/.test(t) ? [1, 0] : [0, 1]);
    });
    writeRepo(vocabToml());

    const res = await sectionToolHandlers.anatomy_brief({ path: tmp, query: "Rtr" });
    if ("error" in res) throw new Error("unexpected error");
    const data = res.data as BriefData;
    expect(data.vocabulary).toBeDefined();
    expect(data.vocabulary).toHaveLength(1);  // only Layer (via alias boost); Application filtered.
    expect(data.vocabulary![0].term).toBe("Layer");
    expect(data.vocabulary![0].reason).toBe("exact-token");
  });

  it("omits vocabulary entirely when nothing matches", async () => {
    // All entries embed to a vector orthogonal to the query → cosine 0 →
    // below threshold. No exact-token substring overlap either.
    _setEmbedderForTesting(async (texts: string[]) =>
      texts.map(t => /Layer|Application|router/i.test(t) ? [1, 0, 0] : [0, 1, 0])
    );
    writeRepo(vocabToml());

    const res = await sectionToolHandlers.anatomy_brief({ path: tmp, query: "kubernetes pod scheduling" });
    if ("error" in res) throw new Error("unexpected error");
    const data = res.data as BriefData;
    expect(data.vocabulary).toBeUndefined();
  });

  it("respects vocab_limit", async () => {
    // Both entries match semantically → without limit, returns 2.
    _setEmbedderForTesting(async (texts: string[]) => texts.map(() => [1, 0, 0]));
    writeRepo(vocabToml());

    const res = await sectionToolHandlers.anatomy_brief({
      path: tmp,
      query: "router stack node application",
      vocab_limit: 1,
    });
    if ("error" in res) throw new Error("unexpected error");
    const data = res.data as BriefData;
    expect(data.vocabulary).toBeDefined();
    expect(data.vocabulary).toHaveLength(1);
  });
});
