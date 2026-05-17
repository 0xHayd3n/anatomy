// src/verify-suggest/llm-prompt.ts
// Prompt template for the LLM source. Kept separate so it can be inspected
// by tooling without pulling the runtime that calls it.

export const LLM_SYSTEM = `You are proposing a static verifier for an architectural rule about a software repository. The verifier is a structured pattern that can be auto-checked against source code to detect when the rule is violated.`;

export function buildLLMPrompt(args: { rule: string; why?: string; sample: string }): string {
  return `Anatomy rule: "${args.rule}"
Why: "${args.why ?? ""}"

Relevant source context (sampled from the repository):
${args.sample}

Available verifier kinds (output exactly one):

1. ast_pattern — for TS/JS/Python/Go/Java/Rust source. Inline-table TOML:
   { kind = "ast_pattern", lang = "<ts|tsx|js|jsx|py|rs|go|java>",
     pattern = "<ast-grep pattern, e.g., console.log($X)>",
     expect_in = "<glob>" OR forbid_in = "<glob>" }

2. semgrep inline pattern — same as ast_pattern but for languages ast-grep
   napi doesn't cover (rb, c, cpp, plus broader py/go/java/rs/ts). Inline-table:
   { kind = "semgrep", lang = "<lang>", pattern = "<semgrep pattern>",
     expect_in = "<glob>" OR forbid_in = "<glob>" }

3. glob_exists — for file-existence rules. Inline-table:
   { kind = "glob_exists", path = "<glob>" }   # expects ≥1 match
   { kind = "glob_exists", path = "<glob>", should_not = true }   # expects 0

Output ONLY one of:
  a single TOML inline-table verify clause as raw text (no fences, no prose)
OR
  the literal string NO_VERIFIER_FEASIBLE

NO_VERIFIER_FEASIBLE applies when the rule is about runtime ordering, dynamic
behavior, or any property that can only be checked by executing the code.`;
}
