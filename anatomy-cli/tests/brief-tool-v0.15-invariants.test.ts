// Task 9 — anatomy_brief v0.15 invariants surfacing.
//   Surfacing model: file_path glob-match against each entry's `triggered_by`
//   array is PRIMARY (full score 1.0, reason "file_path"). Falls back to
//   semantic match against the invariant text when only `query` is provided.
//   Omitted entirely when neither query nor file_path is supplied OR when the
//   chosen mode finds zero matches.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { sectionToolHandlers } from "../src/mcp/section-tools.js";
import { _setEmbedderForTesting } from "../src/embed/index.js";
import { _clearBriefCacheForTesting } from "../src/mcp/brief-tool.js";
import { buildAnatomyToml } from "./_helpers/fixture.js";

const INVARIANTS_TOML_EXTRA = `[[invariants]]
invariant = "Changing HTTP methods list requires updating lib/application.js and test/router.test.js."
triggered_by = ["lib/application.js", "router/methods.js"]

[[invariants]]
invariant = "Renderer changes require updating render-all.test.ts."
triggered_by = ["src/render/**"]
`;

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "brief-invariants-"));
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

type BriefInvariantEntry = {
  invariant: string;
  triggered_by?: string[];
  affected_paths?: string[];
  why?: string;
  score: number;
  reason: string;
};
type BriefData = {
  invariants?: BriefInvariantEntry[];
};

function invariantsToml(): string {
  return buildAnatomyToml({ version: "0.15", extraToml: INVARIANTS_TOML_EXTRA });
}

describe("anatomy_brief v0.15 invariants surfacing", () => {
  it("returns invariants matching file_path glob", async () => {
    writeRepo(invariantsToml());

    const res = await sectionToolHandlers.anatomy_brief({
      path: tmp,
      file_path: "lib/application.js",
    });
    if ("error" in res) throw new Error("unexpected error");
    const data = res.data as BriefData;
    expect(data.invariants).toBeDefined();
    expect(data.invariants).toHaveLength(1);
    expect(data.invariants![0].invariant).toMatch(/Changing HTTP methods/);
    expect(data.invariants![0].reason).toBe("file_path");
    expect(data.invariants![0].score).toBe(1.0);
  });

  it("matches glob patterns like src/render/**", async () => {
    writeRepo(invariantsToml());

    const res = await sectionToolHandlers.anatomy_brief({
      path: tmp,
      file_path: "src/render/toml.ts",
    });
    if ("error" in res) throw new Error("unexpected error");
    const data = res.data as BriefData;
    expect(data.invariants).toBeDefined();
    expect(data.invariants).toHaveLength(1);
    expect(data.invariants![0].invariant).toMatch(/Renderer changes/);
    expect(data.invariants![0].reason).toBe("file_path");
  });

  it("omits invariants when file_path matches none", async () => {
    writeRepo(invariantsToml());

    const res = await sectionToolHandlers.anatomy_brief({
      path: tmp,
      file_path: "docs/README.md",
    });
    if ("error" in res) throw new Error("unexpected error");
    const data = res.data as BriefData;
    expect(data.invariants).toBeUndefined();
  });

  it("falls back to semantic match when only query is provided", async () => {
    // Fake embedder: query about HTTP methods matches the first invariant's
    // text (which contains "HTTP methods list"). The renderer invariant gets
    // an orthogonal vector so it's filtered by EMBED_THRESHOLD.
    _setEmbedderForTesting(async (texts: string[]) =>
      texts.map(t => /HTTP methods|HTTP methods list/i.test(t) ? [1, 0, 0] : [0, 1, 0])
    );
    writeRepo(invariantsToml());

    const res = await sectionToolHandlers.anatomy_brief({
      path: tmp,
      query: "HTTP methods list updates",
    });
    if ("error" in res) throw new Error("unexpected error");
    const data = res.data as BriefData;
    expect(data.invariants).toBeDefined();
    expect(data.invariants!.length).toBeGreaterThan(0);
    expect(data.invariants![0].invariant).toMatch(/Changing HTTP methods/);
    expect(data.invariants![0].reason).toBe("embed");
  });

  it("omits invariants when neither query nor file_path is provided", async () => {
    writeRepo(invariantsToml());

    const res = await sectionToolHandlers.anatomy_brief({ path: tmp });
    if ("error" in res) throw new Error("unexpected error");
    const data = res.data as BriefData;
    expect(data.invariants).toBeUndefined();
  });
});
