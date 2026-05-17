// src/commands/verify-suggest.ts
// CLI entry for `anatomy verify suggest`. Parses flags, resolves the anatomy,
// drives the pipeline + prompt loop, writes accepted clauses, records telemetry.

import { resolveAnatomy } from "../resolve.js";
import { suggestRulesForAnatomy } from "../verify-suggest/index.js";
import { promptForSuggestion } from "../verify-suggest/prompt.js";
import { applyToAnatomy } from "../verify-suggest/write.js";
import { recordSession } from "../verify-suggest/telemetry.js";
import { dryRun } from "../verify-suggest/dry-run.js";
import type { SuggestionSource, DryRunResult, VerifyCandidate } from "../verify-suggest/types.js";

export interface VerifySuggestOptions {
  repo?: string;
  refreshRegistry?: boolean;
}

export async function verifySuggestCommand(opts: VerifySuggestOptions): Promise<number> {
  if (!process.stdin.isTTY) {
    process.stderr.write("anatomy verify suggest requires an interactive terminal. CI/batch mode is not yet supported.\n");
    return 1;
  }

  const cwd = opts.repo ?? process.cwd();
  const resolved = await resolveAnatomy(cwd);
  if ("error" in resolved) {
    process.stderr.write(`error: ${resolved.error}\n`);
    return 1;
  }

  const doc = resolved.doc as unknown as {
    rules?: { rule: string; why?: string; verify?: unknown }[];
    structure?: { entries: { path: string }[] };
    identity?: { fingerprint?: string };
  };
  const rulesArr = doc.rules ?? [];
  const totalRules = rulesArr.length;
  const totalWithVerify = rulesArr.filter(r => r.verify).length;
  const totalToProcess = totalRules - totalWithVerify;

  if (totalToProcess === 0) {
    process.stdout.write(`Nothing to suggest — all ${totalRules} rules already have verify clauses.\n`);
    return 0;
  }

  const t0 = Date.now();
  const stats: Parameters<typeof recordSession>[0] = {
    rules_total: totalRules,
    rules_with_existing_verify: totalWithVerify,
    candidates_by_source: { "test-mining": 0, "registry": 0, "llm": 0, "none": 0 },
    accepted: 0, rejected: 0, skipped: 0, edited: 0,
    quit_mid_session: false, duration_ms: 0,
    repo_fingerprint: doc.identity?.fingerprint ?? "",
  };

  let quit = false;
  for await (const sug of suggestRulesForAnatomy(cwd, doc, { refreshRegistry: opts.refreshRegistry })) {
    if (quit) break;
    const sourceKey: SuggestionSource | "none" = sug.source ?? "none";
    stats.candidates_by_source[sourceKey]++;

    const action = await promptForSuggestion(
      sug,
      {
        io: { stdin: process.stdin, stdout: process.stdout },
        dryRunCandidate: (candidate: VerifyCandidate): Promise<DryRunResult> => dryRun(cwd, candidate),
      },
      totalRules,
    );

    if (action.kind === "accept") {
      try {
        await applyToAnatomy(resolved.anatomy_dir, sug.ruleIndex, action.candidate);
        // Track edits: candidate differs from original suggestion. Count
        // accepted only after the write succeeds — a failed write should
        // not credit an acceptance.
        const wasEdit = sug.candidate && JSON.stringify(action.candidate) !== JSON.stringify(sug.candidate);
        stats.accepted++;
        if (wasEdit) stats.edited++;
      } catch (err) {
        process.stderr.write(`[writer] ${err instanceof Error ? err.message : String(err)}\n`);
        stats.skipped++;
      }
    } else if (action.kind === "reject") {
      stats.rejected++;
    } else if (action.kind === "skip") {
      // Don't double-count: when there was no candidate, the rule is
      // already reflected in candidates_by_source.none. Only count
      // explicit-skips of viable candidates.
      if (sug.candidate) stats.skipped++;
    } else if (action.kind === "quit") {
      quit = true;
      stats.quit_mid_session = true;
    }
  }

  stats.duration_ms = Date.now() - t0;
  recordSession(stats);

  process.stdout.write(`\nSession summary: accepted ${stats.accepted}, rejected ${stats.rejected}, skipped ${stats.skipped}${stats.quit_mid_session ? " (quit early)" : ""}.\n`);

  return quit ? 2 : 0;
}
