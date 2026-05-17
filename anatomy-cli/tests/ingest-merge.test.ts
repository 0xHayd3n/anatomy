import { describe, it, expect } from "vitest";
import { mergeIngestIntoPass1, placeholderPass1Result } from "../src/ingest/merge.js";
import type { IngestedRule } from "../src/ingest/types.js";
import type { Pass1Result } from "../src/types.js";

function pass1(): Pass1Result {
  return {
    manifest: null,
    identity: {
      stack:       { id: "typescript", isPlaceholder: false },
      form:        { id: "library",    isPlaceholder: false },
      domain:      { id: "demo",       isPlaceholder: false },
      function:    { id: "test",       isPlaceholder: false },
      fingerprint: "aaaaaaaaaaaaaaaaaaaa",
    },
    tagline: { value: "test", isPlaceholder: false, source: "manifest-description" },
    operation: { entryPoints: [], commands: {} },
    substance: { keyDependencies: [] },
    structure: { entries: [] },
    generatedAt: "2026-05-14T00:00:00Z",
    generatorId: "test",
  };
}

function rule(text: string, why?: string): IngestedRule {
  return {
    rule: text,
    ...(why ? { why } : {}),
    source: { file: "CLAUDE.md", line: 1, section: "Rules" },
  };
}

describe("mergeIngestIntoPass1", () => {
  it("populates rules with rule + optional why; drops source metadata", () => {
    const p = pass1();
    const rules = [rule("A"), rule("B", "because"), rule("C")];
    const merged = mergeIngestIntoPass1(p, rules);
    expect(merged.rules).toEqual([
      { rule: "A" },
      { rule: "B", why: "because" },
      { rule: "C" },
    ]);
  });

  it("preserves all other Pass1Result fields unchanged", () => {
    const p = pass1();
    const merged = mergeIngestIntoPass1(p, [rule("A")]);
    expect(merged.identity).toEqual(p.identity);
    expect(merged.tagline).toEqual(p.tagline);
    expect(merged.operation).toEqual(p.operation);
    expect(merged.substance).toEqual(p.substance);
    expect(merged.structure).toEqual(p.structure);
  });

  it("empty rules array yields rules: []", () => {
    const merged = mergeIngestIntoPass1(pass1(), []);
    expect(merged.rules).toEqual([]);
  });

  it("returns a new object (doesn't mutate input)", () => {
    const p = pass1();
    const merged = mergeIngestIntoPass1(p, [rule("A")]);
    expect(merged).not.toBe(p);
  });
});

describe("placeholderPass1Result", () => {
  it("produces a Pass1Result with all-placeholder identity pillars", () => {
    const p = placeholderPass1Result();
    expect(p.identity.stack.isPlaceholder).toBe(true);
    expect(p.identity.form.isPlaceholder).toBe(true);
    expect(p.identity.domain.isPlaceholder).toBe(true);
    expect(p.identity.function.isPlaceholder).toBe(true);
  });

  it("placeholder pillars use 'unknown' as the id value", () => {
    const p = placeholderPass1Result();
    expect(p.identity.stack.id).toBe("unknown");
    expect(p.identity.form.id).toBe("unknown");
    expect(p.identity.domain.id).toBe("unknown");
    expect(p.identity.function.id).toBe("unknown");
  });

  it("has empty operation/structure/substance and a placeholder tagline", () => {
    const p = placeholderPass1Result();
    expect(p.operation).toEqual({ entryPoints: [], commands: {} });
    expect(p.structure).toEqual({ entries: [] });
    expect(p.substance).toEqual({ keyDependencies: [] });
    expect(p.tagline.isPlaceholder).toBe(true);
  });
});
