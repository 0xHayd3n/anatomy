// src/verify-suggest/index.ts
// Pipeline: for each rule lacking a verify clause, try sources in order
// (tests → registry → llm), dry-run each candidate, yield the first viable
// suggestion (or a null-candidate suggestion if all three fail).

import type { RuleSuggestion, VerifyCandidate, SuggestionSource } from "./types.js";
import { suggestFromTests } from "./test-mining.js";
import { suggestFromRegistry } from "./registry/index.js";
import { suggestFromLLM } from "./llm.js";
import { dryRun } from "./dry-run.js";

export interface SuggestOptions {
  refreshRegistry?: boolean;
  disableTestMining?: boolean;
  disableRegistry?: boolean;
  disableLLM?: boolean;
}

interface SourceFn {
  name: SuggestionSource;
  fn: (repoRoot: string, rule: { rule: string; why?: string }, doc: { structure?: { entries: { path: string }[] } }) => Promise<VerifyCandidate | null>;
}

export async function* suggestRulesForAnatomy(
  repoRoot: string,
  doc: { rules?: { rule: string; why?: string; verify?: unknown }[]; structure?: { entries: { path: string }[] } },
  opts: SuggestOptions = {},
): AsyncIterable<RuleSuggestion> {
  const rules = doc.rules ?? [];
  const sources: SourceFn[] = [];
  if (!opts.disableTestMining) {
    sources.push({ name: "test-mining", fn: (r, rule) => suggestFromTests(r, rule) });
  }
  if (!opts.disableRegistry) {
    sources.push({
      name: "registry",
      fn: (r, rule) => suggestFromRegistry(r, rule, { refresh: opts.refreshRegistry }),
    });
  }
  if (!opts.disableLLM) {
    sources.push({
      name: "llm",
      fn: (r, rule, d) => suggestFromLLM(r, rule, d.structure),
    });
  }

  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    if (rule.verify) continue;

    let result: RuleSuggestion = {
      ruleIndex: i, rule, candidate: null, source: null, dryRun: null,
    };

    for (const src of sources) {
      let candidate: VerifyCandidate | null;
      try {
        candidate = await src.fn(repoRoot, rule, doc);
      } catch {
        candidate = null;
      }
      if (!candidate) continue;
      const dr = await dryRun(repoRoot, candidate);
      if (!dr.accepted) continue;
      result = { ruleIndex: i, rule, candidate, source: src.name, dryRun: dr };
      break;
    }

    yield result;
  }
}
