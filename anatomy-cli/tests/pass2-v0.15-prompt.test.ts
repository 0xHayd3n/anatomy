// pass2-v0.15-prompt.test.ts
// Locks the SYSTEM_PROMPT and applyAiFill merge function to the v0.15 contract:
// the four new uncapturable-knowledge sections (vocabulary, invariants,
// anti_patterns, prerequisites) must be advertised in the prompt and must
// flow through the merge into Pass1Result.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyAiFill } from "../src/pass2/index.js";
import type { Pass1Result } from "../src/types.js";

function makeResult(): Pass1Result {
  return {
    manifest: null,
    identity: {
      stack: { id: "typescript", isPlaceholder: false },
      form: { id: "typescript-cli-tool", isPlaceholder: false },
      domain: { id: "developer-tools", isPlaceholder: false },
      function: { id: "code-analyzer", isPlaceholder: false },
      fingerprint: "10zdvr75c1f2tys77axn",
    },
    tagline: { value: "A test tool", isPlaceholder: false, source: "readme" },
    operation: { entryPoints: [], commands: {} },
    substance: { keyDependencies: [] },
    structure: { entries: [] },
    generatedAt: "2026-01-01T00:00:00.000Z",
    generatorId: "@anatomytool/cli@0.15.0",
  };
}

describe("v0.15 Pass 2 SYSTEM_PROMPT", () => {
  // Reading the source as text is fragile but intentional: the SYSTEM_PROMPT
  // template is a backtick string baked into the bundled binary, so a unit
  // test would need to export it, which deliberately isn't done. Asserting on
  // source text catches drift (e.g. a regression where the v0.15 section
  // guidance gets silently deleted on a future refactor).
  const src = readFileSync(
    resolve(__dirname, "..", "src", "pass2", "index.ts"),
    "utf8",
  );

  it("advertises the four new uncapturable-knowledge sections by name", () => {
    expect(src).toContain("vocabulary:");
    expect(src).toContain("invariants:");
    expect(src).toContain("anti_patterns:");
    expect(src).toContain("prerequisites:");
  });

  it("updates the Omit gate to list all seven uncapturable sections", () => {
    expect(src).toContain(
      "rules/flows/decisions/vocabulary/invariants/anti_patterns/prerequisites",
    );
  });

  it("declares the new fields in the AiFillResponse JSON schema block", () => {
    // The SYSTEM_PROMPT exposes a JSON schema to the model so it knows the
    // accepted top-level keys. The four new arrays must appear there or the
    // model has no signal to emit them.
    expect(src).toMatch(/"vocabulary":\s*\[/);
    expect(src).toMatch(/"invariants":\s*\[/);
    expect(src).toMatch(/"anti_patterns":\s*\[/);
    expect(src).toMatch(/"prerequisites":\s*\[/);
  });
});

describe("applyAiFill — v0.15 sections", () => {
  it("merges non-empty vocabulary into result", () => {
    const r = applyAiFill(makeResult(), {
      vocabulary: [{ term: "Layer", meaning: "Route stack node." }],
    });
    expect(r.vocabulary).toHaveLength(1);
    expect(r.vocabulary?.[0].term).toBe("Layer");
    expect(r.vocabulary?.[0].meaning).toBe("Route stack node.");
  });

  it("vocabulary.aliases is clamped to 5 items", () => {
    const result = applyAiFill(makeResult(), {
      vocabulary: [{
        term: "T",
        meaning: "M",
        aliases: ["a1", "a2", "a3", "a4", "a5", "a6", "a7"],
      }],
    });
    expect(result.vocabulary![0].aliases).toHaveLength(5);
    expect(result.vocabulary![0].aliases).toEqual(["a1", "a2", "a3", "a4", "a5"]);
  });

  it("vocabulary.contrast is clamped to 3 items and ≤120 chars per item", () => {
    const long = "x".repeat(200);
    const result = applyAiFill(makeResult(), {
      vocabulary: [{
        term: "T",
        meaning: "M",
        contrast: [long, long, long, long, long],
      }],
    });
    expect(result.vocabulary![0].contrast).toHaveLength(3);
    expect(result.vocabulary![0].contrast![0].length).toBeLessThanOrEqual(120);
  });

  it("merges non-empty invariants into result", () => {
    const r = applyAiFill(makeResult(), {
      invariants: [{
        invariant: "Update X and Y together.",
        triggered_by: ["lib/x.js"],
        affected_paths: ["test/x.test.js"],
        why: "Cross-file coupling.",
      }],
    });
    expect(r.invariants).toHaveLength(1);
    expect(r.invariants?.[0].invariant).toBe("Update X and Y together.");
    expect(r.invariants?.[0].triggered_by).toEqual(["lib/x.js"]);
  });

  it("merges non-empty anti_patterns into result", () => {
    const r = applyAiFill(makeResult(), {
      anti_patterns: [{
        pattern: "Wrapping req",
        reason: "Breaks instanceof",
        instead: "Mutate prototype",
        keywords: ["wrapper", "subclass"],
      }],
    });
    expect(r.anti_patterns).toHaveLength(1);
    expect(r.anti_patterns?.[0].pattern).toBe("Wrapping req");
    expect(r.anti_patterns?.[0].keywords).toEqual(["wrapper", "subclass"]);
  });

  it("anti_patterns.keywords is lowercased on merge", () => {
    const result = applyAiFill(makeResult(), {
      anti_patterns: [{
        pattern: "P",
        reason: "R",
        keywords: ["Wrapper", "SubClass", "EXTEND_REQUEST"],
      }],
    });
    expect(result.anti_patterns![0].keywords).toEqual(["wrapper", "subclass", "extend_request"]);
  });

  it("merges non-empty prerequisites into result", () => {
    const r = applyAiFill(makeResult(), {
      prerequisites: [{
        topic: "Node streams",
        why: "sendFile uses them.",
        link: "https://nodejs.org/api/stream.html",
      }],
    });
    expect(r.prerequisites).toHaveLength(1);
    expect(r.prerequisites?.[0].topic).toBe("Node streams");
    expect(r.prerequisites?.[0].link).toBe("https://nodejs.org/api/stream.html");
  });

  it("does NOT assign empty arrays into result (mirrors rules/flows/decisions guard)", () => {
    // The empty-array guard matches the existing rules/flows/decisions pattern:
    // omitting an empty array prevents the renderer from emitting an empty
    // [[vocabulary]] block, and lets the v0.15-gated renderer skip the section
    // entirely on a Pass 2 response with no qualifying items.
    const r = applyAiFill(makeResult(), {
      vocabulary: [],
      invariants: [],
      anti_patterns: [],
      prerequisites: [],
    });
    expect(r.vocabulary).toBeUndefined();
    expect(r.invariants).toBeUndefined();
    expect(r.anti_patterns).toBeUndefined();
    expect(r.prerequisites).toBeUndefined();
  });

  it("merges all four sections independently when all are present", () => {
    const r = applyAiFill(makeResult(), {
      vocabulary: [{ term: "V", meaning: "M" }],
      invariants: [{ invariant: "I" }],
      anti_patterns: [{ pattern: "P", reason: "R" }],
      prerequisites: [{ topic: "T", why: "W" }],
    });
    expect(r.vocabulary).toHaveLength(1);
    expect(r.invariants).toHaveLength(1);
    expect(r.anti_patterns).toHaveLength(1);
    expect(r.prerequisites).toHaveLength(1);
  });

  it("leaves new sections undefined when response omits them entirely", () => {
    const r = applyAiFill(makeResult(), { identity_domain: "developer-tools" });
    expect(r.vocabulary).toBeUndefined();
    expect(r.invariants).toBeUndefined();
    expect(r.anti_patterns).toBeUndefined();
    expect(r.prerequisites).toBeUndefined();
  });
});
