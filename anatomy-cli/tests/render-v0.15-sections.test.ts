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
    // Required: renderToml() unconditionally emits a [generated] block from these
    // fields. Tests focus on v0.15-gated sections, but the fixture must satisfy
    // the [generated] block to avoid runtime errors.
    generatedAt: "2026-05-14T00:00:00.000Z",
    generatorId: "@anatomytool/cli@0.0.0-test",
  } as unknown as Pass1Result;
}

describe("v0.15 renderer", () => {
  it("emits [[vocabulary]] after [[decisions]] in canonical order", () => {
    const r = minimalPass1();
    r.vocabulary = [{ term: "Layer", meaning: "Route stack node." }];
    const out = renderToml(r, { anatomyVersion: "0.15" });
    expect(out).toContain("[[vocabulary]]");
    expect(out).toContain('term = "Layer"');
    expect(out).toContain('meaning = "Route stack node."');
  });

  it("emits aliases and contrast arrays when present", () => {
    const r = minimalPass1();
    r.vocabulary = [{
      term: "Layer",
      meaning: "X",
      aliases: ["RouteLayer"],
      contrast: ["not Middleware"]
    }];
    const out = renderToml(r, { anatomyVersion: "0.15" });
    expect(out).toContain('aliases = ["RouteLayer"]');
    expect(out).toContain('contrast = ["not Middleware"]');
  });

  it("emits [[invariants]] with triggered_by glob array", () => {
    const r = minimalPass1();
    r.invariants = [{
      invariant: "Update X and Y together.",
      triggered_by: ["lib/x.js", "lib/y.js"]
    }];
    const out = renderToml(r, { anatomyVersion: "0.15" });
    expect(out).toContain("[[invariants]]");
    expect(out).toContain('invariant = "Update X and Y together."');
    expect(out).toContain('triggered_by = ["lib/x.js", "lib/y.js"]');
  });

  it("emits [[anti_patterns]] with keywords", () => {
    const r = minimalPass1();
    r.anti_patterns = [{
      pattern: "Wrapping req",
      reason: "Breaks instanceof",
      keywords: ["wrapper", "subclass"]
    }];
    const out = renderToml(r, { anatomyVersion: "0.15" });
    expect(out).toContain("[[anti_patterns]]");
    expect(out).toContain('keywords = ["wrapper", "subclass"]');
  });

  it("emits [[prerequisites]] with link", () => {
    const r = minimalPass1();
    r.prerequisites = [{
      topic: "Node streams",
      why: "sendFile uses them.",
      link: "https://nodejs.org/api/stream.html"
    }];
    const out = renderToml(r, { anatomyVersion: "0.15" });
    expect(out).toContain("[[prerequisites]]");
    expect(out).toContain('link = "https://nodejs.org/api/stream.html"');
  });

  it("emits sections in canonical order: vocabulary, invariants, anti_patterns, prerequisites", () => {
    const r = minimalPass1();
    r.vocabulary = [{ term: "V", meaning: "M" }];
    r.invariants = [{ invariant: "I" }];
    r.anti_patterns = [{ pattern: "P", reason: "R" }];
    r.prerequisites = [{ topic: "T", why: "W" }];
    const out = renderToml(r, { anatomyVersion: "0.15" });
    const iVocab = out.indexOf("[[vocabulary]]");
    const iInv = out.indexOf("[[invariants]]");
    const iAnti = out.indexOf("[[anti_patterns]]");
    const iPre = out.indexOf("[[prerequisites]]");
    expect(iVocab).toBeGreaterThan(-1);
    expect(iInv).toBeGreaterThan(iVocab);
    expect(iAnti).toBeGreaterThan(iInv);
    expect(iPre).toBeGreaterThan(iAnti);
  });

  it("does NOT emit new sections when anatomyVersion < 0.15", () => {
    const r = minimalPass1();
    r.vocabulary = [{ term: "X", meaning: "Y" }];
    const out = renderToml(r, { anatomyVersion: "0.14" });
    expect(out).not.toContain("[[vocabulary]]");
  });

  it("emits v0.15 sections and declares the latest version on the DEFAULT path (no anatomyVersion opt)", () => {
    // The generate command renders without passing anatomyVersion, so the
    // default LATEST_ANATOMY_VERSION governs. Pass 2 produces v0.15 sections
    // by default per spec/0.15/pass2-prompt-contract.md; the renderer must
    // not silently drop them by defaulting to a pre-0.15 version.
    const r = minimalPass1();
    r.vocabulary = [{ term: "Layer", meaning: "Route stack node." }];
    const out = renderToml(r);
    expect(out).toContain('anatomy_version = "1.0"');
    expect(out).toContain("[[vocabulary]]");
  });

  it("omits empty sections entirely (no empty [[vocabulary]] block)", () => {
    const r = minimalPass1();
    r.vocabulary = [];
    const out = renderToml(r, { anatomyVersion: "0.15" });
    expect(out).not.toContain("[[vocabulary]]");
  });
});
