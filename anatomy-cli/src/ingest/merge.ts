// src/ingest/merge.ts
// Take a Pass1Result and a list of IngestedRule[], return a new Pass1Result
// with .rules populated. Pass 1 doesn't normally emit [[rules]] (those are
// Pass 2 output), so this is purely additive — no collision risk.
//
// Also exports placeholderPass1Result() for the --no-pass1 escape hatch.

import { fingerprintFromPillars } from "@anatomytool/validate";
import type { Pass1Result, Rule } from "../types.js";
import type { IngestedRule } from "./types.js";

export function mergeIngestIntoPass1(pass1: Pass1Result, rules: IngestedRule[]): Pass1Result {
  const mappedRules: Rule[] = rules.map(r => ({
    rule: r.rule,
    ...(r.why ? { why: r.why } : {}),
  }));
  return {
    ...pass1,
    rules: mappedRules,
  };
}

export function placeholderPass1Result(): Pass1Result {
  return {
    manifest: null,
    identity: {
      stack:       { id: "unknown", isPlaceholder: true },
      form:        { id: "unknown", isPlaceholder: true },
      domain:      { id: "unknown", isPlaceholder: true },
      function:    { id: "unknown", isPlaceholder: true },
      fingerprint: fingerprintFromPillars("unknown", "unknown", "unknown", "unknown"),
    },
    tagline: { value: "unknown — fill in", isPlaceholder: true, source: "placeholder" },
    operation: { entryPoints: [], commands: {} },
    substance: { keyDependencies: [] },
    structure: { entries: [] },
    generatedAt: new Date().toISOString(),
    generatorId: "@anatomytool/cli@ingest-no-pass1",
  };
}
