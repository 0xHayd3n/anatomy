import { describe, it, expect } from "vitest";
import { validate } from "../src/index.js";
import { supportedVersions } from "../src/schema.js";

// v1.0 == v0.15 structurally. Reuse the proven-real
// fingerprintFromPillars(javascript, library, test, test-fn) value so
// fingerprintCheck passes.
const MINIMAL_V1 = `
anatomy_version = "1.0"
tagline = "Test repo"

[identity]
stack = "javascript"
form = "library"
domain = "test"
function = "test-fn"
fingerprint = "w87sfqxp999cxnam77z0"

[generated]
at = 2026-05-17T00:00:00.000Z
by = "test"
model = "test"
schema = "https://anatomy.dev/spec/1.0/schema.json"
`;

// Back-compat guard: a v0.15 file must still validate after v1.0 is added.
const MINIMAL_V015 = MINIMAL_V1
  .replace('anatomy_version = "1.0"', 'anatomy_version = "0.15"')
  .replace("spec/1.0/schema.json", "spec/0.15/schema.json");

describe("v1.0 schema acceptance", () => {
  it("lists 1.0 in supportedVersions", () => {
    expect(supportedVersions).toContain("1.0");
  });

  it("accepts a minimal v1.0 file", async () => {
    const r = await validate(MINIMAL_V1);
    expect(r.ok ? [] : r.errors).toEqual([]);
  });

  it("still accepts a minimal v0.15 file (back-compat preserved)", async () => {
    const r = await validate(MINIMAL_V015);
    expect(r.ok ? [] : r.errors).toEqual([]);
  });

  it("rejects an unknown field at root (additive schema, additionalProperties:false)", async () => {
    const r = await validate(MINIMAL_V1 + `\nhallucinated_field = "x"\n`);
    expect(r.ok).toBe(false);
  });
});
