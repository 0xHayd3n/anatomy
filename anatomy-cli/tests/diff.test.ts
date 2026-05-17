import { describe, it, expect } from "vitest";
import { unifiedDiff } from "../src/diff.js";

describe("unifiedDiff", () => {
  it("emits header lines with label", () => {
    const out = unifiedDiff("a\n", "b\n", "test.md");
    expect(out).toMatch(/^--- on-disk test\.md/m);
    expect(out).toMatch(/^\+\+\+ fresh render/m);
  });

  it("shows minus for removed lines and plus for added", () => {
    const out = unifiedDiff("foo\n", "bar\n", "x");
    expect(out).toContain("-foo");
    expect(out).toContain("+bar");
  });

  it("returns just headers for identical inputs", () => {
    const out = unifiedDiff("x\ny\nz", "x\ny\nz", "x");
    const lines = out.split("\n");
    expect(lines).toHaveLength(2); // just the two header lines
  });

  it("handles length mismatch (extra lines on one side)", () => {
    const out = unifiedDiff("a\nb\n", "a\nb\nc\n", "x");
    expect(out).toContain("+c");
  });
});
