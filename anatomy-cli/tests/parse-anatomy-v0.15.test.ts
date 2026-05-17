// tests/parse-anatomy-v0.15.test.ts
// Adapter coverage for the v0.15 uncapturable-knowledge sections.
//
// parsedToPass1Result is the seam `anatomy render` uses to load an existing
// .anatomy back into Pass1Result before re-emitting. If it drops the four
// v0.15 array sections, `anatomy render` silently truncates them (data loss
// in normal mode, false drift in --check). These tests assert the adapter
// carries every field through parse with no loss.
import { describe, it, expect } from "vitest";
import { parse as parseToml } from "smol-toml";
import { parsedToPass1Result } from "../src/render/parse-anatomy.js";

const TOML_WITH_V015 = `anatomy_version = "0.15"
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
aliases = ["RouteLayer", "StackLayer"]
contrast = ["not Middleware", "not Router"]

[[vocabulary]]
term = "Stack"
meaning = "Ordered list of layers."

[[invariants]]
invariant = "Update parser and renderer together."
triggered_by = ["src/parse.ts", "src/render.ts"]
affected_paths = ["dist/**"]
why = "They share the wire shape."

[[invariants]]
invariant = "Bump the schema URL when the version changes."

[[anti_patterns]]
pattern = "Wrapping the request object."
reason = "Breaks instanceof checks downstream."
instead = "Attach via a symbol property."
keywords = ["wrapper", "subclass"]

[[anti_patterns]]
pattern = "Mutating shared config."
reason = "Causes cross-test bleed."

[[prerequisites]]
topic = "Node streams"
why = "sendFile relies on them."
link = "https://nodejs.org/api/stream.html"

[[prerequisites]]
topic = "TOML"
why = "The wire format."

[generated]
at = "2026-05-15T00:00:00.000Z"
by = "@anatomy/cli@0.0.0-test"
model = "none"
schema = "https://anatomy.dev/spec/0.15/schema.json"
`;

describe("parsedToPass1Result — v0.15 sections", () => {
  const pass1 = parsedToPass1Result(parseToml(TOML_WITH_V015));

  it("maps [[vocabulary]] entries, preserving aliases and contrast", () => {
    expect(pass1.vocabulary).toEqual([
      {
        term: "Layer",
        meaning: "A node pairing a path with a handler.",
        aliases: ["RouteLayer", "StackLayer"],
        contrast: ["not Middleware", "not Router"],
      },
      {
        term: "Stack",
        meaning: "Ordered list of layers.",
      },
    ]);
  });

  it("maps [[invariants]] entries, preserving triggered_by/affected_paths/why", () => {
    expect(pass1.invariants).toEqual([
      {
        invariant: "Update parser and renderer together.",
        triggered_by: ["src/parse.ts", "src/render.ts"],
        affected_paths: ["dist/**"],
        why: "They share the wire shape.",
      },
      {
        invariant: "Bump the schema URL when the version changes.",
      },
    ]);
  });

  it("maps [[anti_patterns]] entries, preserving instead and keywords", () => {
    expect(pass1.anti_patterns).toEqual([
      {
        pattern: "Wrapping the request object.",
        reason: "Breaks instanceof checks downstream.",
        instead: "Attach via a symbol property.",
        keywords: ["wrapper", "subclass"],
      },
      {
        pattern: "Mutating shared config.",
        reason: "Causes cross-test bleed.",
      },
    ]);
  });

  it("maps [[prerequisites]] entries, preserving link", () => {
    expect(pass1.prerequisites).toEqual([
      {
        topic: "Node streams",
        why: "sendFile relies on them.",
        link: "https://nodejs.org/api/stream.html",
      },
      {
        topic: "TOML",
        why: "The wire format.",
      },
    ]);
  });

  it("leaves the four sections undefined when absent from the document", () => {
    // Fixture is intentionally schema-minimal (no [identity]/[generated]).
    // parsedToPass1Result is a pure adapter and does not validate, so this
    // exercises the absent-section path directly; if validation is ever
    // moved into the adapter, this fixture must grow the required blocks.
    const bare = parsedToPass1Result(
      parseToml(`anatomy_version = "0.15"\ntagline = "x"\n`),
    );
    expect(bare.vocabulary).toBeUndefined();
    expect(bare.invariants).toBeUndefined();
    expect(bare.anti_patterns).toBeUndefined();
    expect(bare.prerequisites).toBeUndefined();
  });
});
