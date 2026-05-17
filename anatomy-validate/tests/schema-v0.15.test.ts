import { describe, it, expect } from "vitest";
import { validate } from "../src/index.js";

const MINIMAL_V015 = `
anatomy_version = "0.15"
tagline = "Test repo"

[identity]
stack = "javascript"
form = "library"
domain = "test"
function = "test-fn"
# Real fingerprintFromPillars(javascript, library, test, test-fn) — a
# placeholder here only passed while fingerprintCheck no-op'd on v0.15.
fingerprint = "w87sfqxp999cxnam77z0"

[generated]
at = 2026-05-14T00:00:00.000Z
by = "test"
model = "test"
schema = "https://anatomy.dev/spec/0.15/schema.json"
`;

async function errorsOf(text: string) {
  const r = await validate(text);
  return r.ok ? [] : r.errors;
}

describe("v0.15 schema acceptance", () => {
  it("accepts a minimal v0.15 file (no new sections)", async () => {
    const errors = await errorsOf(MINIMAL_V015);
    expect(errors).toEqual([]);
  });

  it("accepts a v0.15 file with all four new sections", async () => {
    const doc = MINIMAL_V015 + `
[[vocabulary]]
term = "Layer"
meaning = "Routing node pairing path with middleware fn."

[[invariants]]
invariant = "Changing methods list requires update in two files."
triggered_by = ["lib/application.js"]

[[anti_patterns]]
pattern = "Wrapping req/res"
reason = "Breaks instanceof; per-request allocation."

[[prerequisites]]
topic = "Node streams"
why = "res.sendFile uses streams."
`;
    const errors = await errorsOf(doc);
    expect(errors).toEqual([]);
  });

  it("rejects vocabulary entry without required term", async () => {
    const doc = MINIMAL_V015 + `\n[[vocabulary]]\nmeaning = "missing term"\n`;
    const errors = await errorsOf(doc);
    expect(errors.length).toBeGreaterThan(0);
    expect(JSON.stringify(errors)).toContain("term");
  });

  it("rejects invariant entry without required invariant field", async () => {
    const doc = MINIMAL_V015 + `\n[[invariants]]\nwhy = "missing invariant"\n`;
    const errors = await errorsOf(doc);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("rejects anti_pattern entry without required reason field", async () => {
    const doc = MINIMAL_V015 + `\n[[anti_patterns]]\npattern = "no reason"\n`;
    const errors = await errorsOf(doc);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("rejects prerequisite without required topic+why", async () => {
    const doc = MINIMAL_V015 + `\n[[prerequisites]]\nlink = "https://example.com"\n`;
    const errors = await errorsOf(doc);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("rejects vocabulary section exceeding maxItems=30", async () => {
    const many = Array.from({ length: 31 }, (_, i) =>
      `[[vocabulary]]\nterm = "t${i}"\nmeaning = "m${i}"\n`).join("");
    const errors = await errorsOf(MINIMAL_V015 + "\n" + many);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("rejects invariants exceeding maxItems=15", async () => {
    const many = Array.from({ length: 16 }, (_, i) =>
      `[[invariants]]\ninvariant = "inv ${i}"\n`).join("");
    const errors = await errorsOf(MINIMAL_V015 + "\n" + many);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("rejects anti_patterns exceeding maxItems=12", async () => {
    const many = Array.from({ length: 13 }, (_, i) =>
      `[[anti_patterns]]\npattern = "p${i}"\nreason = "r${i}"\n`).join("");
    const errors = await errorsOf(MINIMAL_V015 + "\n" + many);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("rejects prerequisites exceeding maxItems=10", async () => {
    const many = Array.from({ length: 11 }, (_, i) =>
      `[[prerequisites]]\ntopic = "t${i}"\nwhy = "w${i}"\n`).join("");
    const errors = await errorsOf(MINIMAL_V015 + "\n" + many);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("rejects invalid URL syntax in prerequisite.link", async () => {
    const doc = MINIMAL_V015 + `\n[[prerequisites]]\ntopic = "x"\nwhy = "y"\nlink = "not a url"\n`;
    const errors = await errorsOf(doc);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("rejects vocabulary entry with unknown field (additionalProperties: false)", async () => {
    const doc = MINIMAL_V015 + `
[[vocabulary]]
term = "Layer"
meaning = "ok"
unknown_field = "hallucinated"
`;
    const errors = await errorsOf(doc);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.schemaKeyword === "additionalProperties")).toBe(true);
    expect(errors.some(e => e.pointer === "/vocabulary/0")).toBe(true);
  });
});
