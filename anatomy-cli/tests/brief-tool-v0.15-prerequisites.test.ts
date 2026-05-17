// Task 11 — anatomy_brief v0.15 prerequisites surfacing.
//   Surfacing model: onboarding-query gate. Prerequisites surface ONLY when
//   the query is empty/null/missing OR matches an entry of the
//   ONBOARDING_LEXICON as a case-insensitive substring. file_path being set
//   always suppresses prerequisites (file_path implies task-specific work).
//   When the gate fires, the top `prerequisite_limit` entries pass through
//   as-is with score: 1.0 and reason: "onboarding" — no semantic ranking,
//   since this is purely an intent-gated section.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { sectionToolHandlers } from "../src/mcp/section-tools.js";
import { _setEmbedderForTesting } from "../src/embed/index.js";
import { _clearBriefCacheForTesting } from "../src/mcp/brief-tool.js";
import type { BriefData } from "../src/mcp/brief-tool.js";
import { buildAnatomyToml } from "./_helpers/fixture.js";

const PREREQ_TOML_EXTRA = `[[prerequisites]]
topic = "Node.js streams"
why = "res.sendFile assumes Readable/Writable backpressure familiarity."
link = "https://nodejs.org/api/stream.html"

[[prerequisites]]
topic = "HTTP semantics"
why = "Routing relies on understanding methods, headers, status codes."
`;

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "brief-prereq-"));
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

function prereqToml(): string {
  return buildAnatomyToml({ version: "0.15", extraToml: PREREQ_TOML_EXTRA });
}

describe("anatomy_brief v0.15 prerequisites surfacing", () => {
  it("returns prerequisites on empty query (onboarding)", async () => {
    writeRepo(prereqToml());

    const res = await sectionToolHandlers.anatomy_brief({ path: tmp });
    if ("error" in res) throw new Error("unexpected error");
    const data = res.data as BriefData;
    expect(data.prerequisites).toBeDefined();
    expect(data.prerequisites!.length).toBeGreaterThan(0);
    expect(data.prerequisites![0].topic).toBe("Node.js streams");
    expect(data.prerequisites![0].reason).toBe("onboarding");
    expect(data.prerequisites![0].score).toBe(1.0);
  });

  it("returns prerequisites on 'overview' query", async () => {
    writeRepo(prereqToml());

    const res = await sectionToolHandlers.anatomy_brief({
      path: tmp,
      query: "overview of this repo",
    });
    if ("error" in res) throw new Error("unexpected error");
    const data = res.data as BriefData;
    expect(data.prerequisites).toBeDefined();
    expect(data.prerequisites!.length).toBeGreaterThan(0);
    expect(data.prerequisites![0].reason).toBe("onboarding");
  });

  it("returns prerequisites on 'getting started' query", async () => {
    writeRepo(prereqToml());

    const res = await sectionToolHandlers.anatomy_brief({
      path: tmp,
      query: "getting started",
    });
    if ("error" in res) throw new Error("unexpected error");
    const data = res.data as BriefData;
    expect(data.prerequisites).toBeDefined();
    expect(data.prerequisites!.length).toBeGreaterThan(0);
    expect(data.prerequisites![0].reason).toBe("onboarding");
  });

  it("omits prerequisites when file_path is set", async () => {
    // file_path implies task-specific work, not onboarding. Even with no
    // query at all, the file_path suppresses the prerequisites slot.
    writeRepo(prereqToml());

    const res = await sectionToolHandlers.anatomy_brief({
      path: tmp,
      file_path: "lib/foo.js",
    });
    if ("error" in res) throw new Error("unexpected error");
    const data = res.data as BriefData;
    expect(data.prerequisites).toBeUndefined();
  });

  it("omits prerequisites on task-specific query", async () => {
    // A query that does not match the onboarding lexicon → suppressed,
    // even with no file_path. Save tokens for task-specific responses.
    writeRepo(prereqToml());

    const res = await sectionToolHandlers.anatomy_brief({
      path: tmp,
      query: "how does res.sendFile handle EISDIR",
    });
    if ("error" in res) throw new Error("unexpected error");
    const data = res.data as BriefData;
    expect(data.prerequisites).toBeUndefined();
  });

  it("respects prerequisite_limit", async () => {
    writeRepo(prereqToml());

    const res = await sectionToolHandlers.anatomy_brief({
      path: tmp,
      prerequisite_limit: 1,
    });
    if ("error" in res) throw new Error("unexpected error");
    const data = res.data as BriefData;
    expect(data.prerequisites).toBeDefined();
    expect(data.prerequisites).toHaveLength(1);
  });

  it("does NOT surface prerequisites on queries containing 'intro' as substring of unrelated words", async () => {
    // Regression guard for the removed "intro" lexicon entry — substring of
    // "introspect"/"introduce" would have falsely tripped onboarding mode.
    writeRepo(prereqToml());

    const res = await sectionToolHandlers.anatomy_brief({
      path: tmp,
      query: "how does the introspection endpoint work",
    });
    if ("error" in res) throw new Error("unexpected error");
    const data = res.data as BriefData;
    expect(data.prerequisites).toBeUndefined();
  });
});
