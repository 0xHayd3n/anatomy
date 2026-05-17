import { describe, it, expect } from "vitest";
import { renderToml } from "../src/render/toml.js";
import type { Pass1Result } from "../src/types.js";

function minimalPass1(): Pass1Result {
  return {
    identity: {
      stack: { id: "javascript", isPlaceholder: false },
      form: { id: "library", isPlaceholder: false },
      domain: { id: "test", isPlaceholder: false },
      function: { id: "test-fn", isPlaceholder: false },
      fingerprint: "abcdefghijklmnopqrst",
    },
    tagline: { value: "Test", isPlaceholder: false },
    operation: { entryPoints: [], commands: {}, conventions: {} },
    structure: { entries: [] },
    substance: { keyDependencies: [] },
    generatedAt: "2026-05-17T00:00:00.000Z",
    generatorId: "@anatomy/cli@0.0.0-test",
  } as unknown as Pass1Result;
}

describe("v1.0 renderer", () => {
  it("emits v0.15-era sections and declares v1.0 on the DEFAULT path (no anatomyVersion opt)", () => {
    const r = minimalPass1();
    r.vocabulary = [{ term: "Layer", meaning: "Route stack node." }];
    const out = renderToml(r);
    expect(out).toContain('anatomy_version = "1.0"');
    expect(out).toContain("[[vocabulary]]");
    expect(out).toContain('schema = "https://anatomy.dev/spec/1.0/schema.json"');
  });

  it("emits all four uncapturable-knowledge sections for an explicit 1.0 target", () => {
    const r = minimalPass1();
    r.vocabulary = [{ term: "V", meaning: "M" }];
    r.invariants = [{ invariant: "I" }];
    r.anti_patterns = [{ pattern: "P", reason: "R" }];
    r.prerequisites = [{ topic: "T", why: "W" }];
    const out = renderToml(r, { anatomyVersion: "1.0" });
    const iVocab = out.indexOf("[[vocabulary]]");
    const iInv = out.indexOf("[[invariants]]");
    const iAnti = out.indexOf("[[anti_patterns]]");
    const iPre = out.indexOf("[[prerequisites]]");
    expect(iVocab).toBeGreaterThan(-1);
    expect(iInv).toBeGreaterThan(iVocab);
    expect(iAnti).toBeGreaterThan(iInv);
    expect(iPre).toBeGreaterThan(iAnti);
  });
});
