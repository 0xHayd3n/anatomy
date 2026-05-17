import { describe, it, expect, beforeEach } from "vitest";
import { getAstGrep, _resetAstGrepCache } from "../src/checks/verify/detect-ast-grep.js";

describe("getAstGrep", () => {
  beforeEach(() => { _resetAstGrepCache(); });

  it("returns the @ast-grep/napi module when installed", async () => {
    const mod = await getAstGrep();
    expect(mod).not.toBeNull();
    // The napi module exports a `parse` function and a `Lang` enum.
    expect(typeof (mod as { parse?: unknown })?.parse).toBe("function");
  });

  it("caches the result across calls", async () => {
    const first = await getAstGrep();
    const second = await getAstGrep();
    expect(first).toBe(second);
  });

  it("can be reset for testing via _resetAstGrepCache", async () => {
    _resetAstGrepCache();
    const mod = await getAstGrep();
    expect(mod).not.toBeNull();
  });
});
