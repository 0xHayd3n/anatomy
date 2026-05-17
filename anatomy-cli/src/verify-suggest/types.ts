// src/verify-suggest/types.ts
// Shared types for the verifier-suggestion pipeline. Keep this file free of
// runtime dependencies so it can be imported anywhere without pulling weight.

export type VerifyCandidate =
  | { kind: "glob_exists"; path: string; should_not?: boolean }
  | { kind: "ast_pattern"; lang: string; pattern: string; expect_in?: string; forbid_in?: string }
  | { kind: "semgrep"; lang?: string; pattern?: string; rule_file?: string; expect_in?: string; forbid_in?: string };

export type SuggestionSource = "test-mining" | "registry" | "llm";

export interface DryRunResult {
  accepted: boolean;
  reason?: string;                       // present when accepted === false
  hits: { file: string; line: number }[];   // sample hits from any warnings
}

export interface RuleSuggestion {
  ruleIndex: number;
  rule: { rule: string; why?: string; verify?: unknown };
  candidate: VerifyCandidate | null;
  source: SuggestionSource | null;
  dryRun: DryRunResult | null;
}
