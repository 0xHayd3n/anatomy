import { describe, it, expect } from "vitest";
import { wrapResponse, wrapError } from "../src/mcp/envelope.js";
import type { ResolvedAnatomy } from "../src/resolve.js";

const RESOLVED: ResolvedAnatomy = {
  anatomy_path: "/repo/.anatomy",
  anatomy_dir: "/repo",
  repo_root: "/repo",
  doc: { anatomy_version: "0.7", identity: { fingerprint: "abc" } } as never,
  warnings: [],
  staleness: null,
};

describe("wrapResponse", () => {
  it("wraps payload with anatomy_path and null staleness", () => {
    const out = wrapResponse({ x: 1 }, RESOLVED);
    expect(out).toEqual({
      anatomy_path: "/repo/.anatomy",
      staleness: null,
      repo_fingerprint: "abc",
      data: { x: 1 },
    });
  });

  it("includes staleness when present", () => {
    const stale: ResolvedAnatomy = { ...RESOLVED, staleness: { file_commit: "deadbee", head_commit: "abc1234" } };
    const out = wrapResponse({ x: 1 }, stale);
    expect(out.staleness).toEqual({ file_commit: "deadbee", head_commit: "abc1234" });
  });
});

describe("wrapError", () => {
  it("wraps anatomy_not_found errors", () => {
    const out = wrapError({ error: "anatomy_not_found", path: "/x" });
    expect(out).toEqual({ error: "anatomy_not_found", path: "/x" });
  });

  it("wraps validation_failed errors", () => {
    const out = wrapError({
      error: "validation_failed",
      code: "ANAT-001",
      pointer: "/identity",
      message: "bad",
      warnings: [],
    });
    expect(out).toMatchObject({ error: "validation_failed", code: "ANAT-001", pointer: "/identity" });
  });
});
