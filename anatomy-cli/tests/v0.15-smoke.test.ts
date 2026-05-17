// tests/v0.15-smoke.test.ts
// Pre-flight smoke tests for the v0.15 ship (spec §7.5).
//
// Goals:
//   1. Render+validate roundtrip: a Pass1Result with all four v0.15 sections
//      populated renders to a TOML doc that passes @anatomy/validate cleanly.
//   2. Canonical section order: vocabulary → invariants → anti_patterns →
//      prerequisites → [generated].
//   3. Validator routes v0.15 files to the v0.15 schema (no false-positive
//      additionalProperties errors from an older schema).
//
// A fourth round-trip test (parse + re-render byte-identical) is deliberately
// omitted — see the trailing comment block for the rationale.
import { describe, it, expect } from "vitest";
import { parse as parseToml } from "smol-toml";
import { renderToml } from "../src/render/toml.js";
import { parsedToPass1Result } from "../src/render/parse-anatomy.js";
import { validate } from "@anatomy/validate";
import type { Pass1Result } from "../src/types.js";

// Build a Pass1Result that exercises every new v0.15 section plus a
// representative subset of pre-existing sections. The cast widens the literal
// to Pass1Result because tagline.source is required by the type but unused by
// the renderer (which only reads .value and .isPlaceholder); the cast pattern
// matches tests/render-v0.15-sections.test.ts.
function richPass1(): Pass1Result {
  return {
    identity: {
      stack: { id: "javascript", isPlaceholder: false },
      form: { id: "javascript-framework", isPlaceholder: false },
      domain: { id: "web-infrastructure", isPlaceholder: false },
      function: { id: "http-routing", isPlaceholder: false },
      // Real fingerprintFromPillars(javascript, javascript-framework,
      // web-infrastructure, http-routing). fingerprintCheck enforces this
      // for flat-pillar v0.7+ docs (incl. v0.15/v1.0) since a3901ea.
      fingerprint: "kkq4tkadgtghtyhfw51v",
    },
    tagline: { value: "Test framework", isPlaceholder: false },
    operation: { entryPoints: [], commands: {}, conventions: {} },
    structure: { entries: [] },
    substance: { keyDependencies: [] },
    rules: [{ rule: "Test rule", why: "Reason" }],
    flows: [{ name: "test-flow", summary: "step1 then step2" }],
    decisions: [{ topic: "Test decision", reason: "Because." }],
    vocabulary: [
      { term: "Layer", meaning: "Node pairing path with fn.", contrast: ["not Middleware"] },
    ],
    invariants: [
      { invariant: "Change A and B together.", triggered_by: ["lib/a.js"] },
    ],
    anti_patterns: [
      { pattern: "Wrapper", reason: "Breaks identity.", keywords: ["wrapper"] },
    ],
    prerequisites: [
      { topic: "Streams", why: "Used for sendFile.", link: "https://example.com" },
    ],
    generatedAt: "2026-05-15T00:00:00.000Z",
    generatorId: "@anatomy/cli@0.0.0-test",
  } as unknown as Pass1Result;
}

describe("v0.15 smoke", () => {
  it("renders a full v0.15 file that validates", async () => {
    const toml = renderToml(richPass1(), { anatomyVersion: "0.15" });
    const result = await validate(toml);
    if (!result.ok) {
      // Surface errors clearly when the assertion fails — debugging across
      // the render+validate boundary is otherwise painful.
      throw new Error(
        `Expected v0.15 file to validate, got errors:\n${JSON.stringify(result.errors, null, 2)}`,
      );
    }
    expect(result.ok).toBe(true);
  });

  it("canonical section order: vocabulary then invariants then anti_patterns then prerequisites then [generated]", () => {
    const toml = renderToml(richPass1(), { anatomyVersion: "0.15" });
    const markers = [
      "[[vocabulary]]",
      "[[invariants]]",
      "[[anti_patterns]]",
      "[[prerequisites]]",
      "[generated]",
    ];
    const positions = markers.map(m => toml.indexOf(m));
    expect(positions.every(p => p > -1)).toBe(true);
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
  });

  it("validator routes v0.15 files to the v0.15 schema (no additionalProperties errors)", async () => {
    const toml = renderToml(richPass1(), { anatomyVersion: "0.15" });
    const result = await validate(toml);
    // If validation fails, the failure must not be a "this section is unknown
    // to my schema" error from an older schema accidentally being used.
    if (!result.ok) {
      const additionalPropsErrors = result.errors.filter(e =>
        e.schemaKeyword === "additionalProperties"
      );
      expect(additionalPropsErrors).toEqual([]);
    } else {
      expect(result.ok).toBe(true);
    }
  });

  // Round-trip: parsedToPass1Result now propagates the four v0.15 sections,
  // so `anatomy render` against an existing v0.15 file is loss-free. A
  // parse + re-render must reproduce the original byte-for-byte.
  it("round-trip: parse + re-render is byte-identical", () => {
    const toml1 = renderToml(richPass1(), { anatomyVersion: "0.15" });
    const parsed = parseToml(toml1);
    const pass1 = parsedToPass1Result(parsed);
    const toml2 = renderToml(pass1, { anatomyVersion: "0.15" });
    expect(toml2).toBe(toml1);
  });
});
