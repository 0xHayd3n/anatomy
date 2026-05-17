// Regression: parsedToPass1Result must carry every v1.0 (== v0.15) section
// through parse with no loss, so `anatomy render` does not truncate them.
import { describe, it, expect } from "vitest";
import { parse as parseToml } from "smol-toml";
import { parsedToPass1Result } from "../src/render/parse-anatomy.js";

const TOML_V1 = `anatomy_version = "1.0"
tagline = "Test fixture"

[identity]
stack = "javascript"
form = "library"
domain = "test"
function = "test-fn"
fingerprint = "abcdefghijklmnopqrst"

[[vocabulary]]
term = "Layer"
meaning = "A node pairing a path with a handler."
aliases = ["RouteLayer"]
contrast = ["not Middleware"]

[[invariants]]
invariant = "Update parser and renderer together."
triggered_by = ["src/parse.ts"]

[[anti_patterns]]
pattern = "Wrapping the request object."
reason = "Breaks instanceof checks downstream."

[[prerequisites]]
topic = "TOML"
why = "The wire format."

[generated]
at = "2026-05-17T00:00:00.000Z"
by = "@anatomy/cli@0.0.0-test"
model = "none"
schema = "https://anatomy.dev/spec/1.0/schema.json"
`;

describe("parsedToPass1Result — v1.0 sections", () => {
  const pass1 = parsedToPass1Result(parseToml(TOML_V1));

  it("carries [[vocabulary]] through with aliases and contrast", () => {
    expect(pass1.vocabulary).toEqual([
      {
        term: "Layer",
        meaning: "A node pairing a path with a handler.",
        aliases: ["RouteLayer"],
        contrast: ["not Middleware"],
      },
    ]);
  });

  it("carries [[invariants]], [[anti_patterns]], [[prerequisites]] through", () => {
    expect(pass1.invariants).toEqual([
      { invariant: "Update parser and renderer together.", triggered_by: ["src/parse.ts"] },
    ]);
    expect(pass1.anti_patterns).toEqual([
      { pattern: "Wrapping the request object.", reason: "Breaks instanceof checks downstream." },
    ]);
    expect(pass1.prerequisites).toEqual([
      { topic: "TOML", why: "The wire format." },
    ]);
  });
});
