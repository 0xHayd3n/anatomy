// src/render/token-count.ts
// Token estimator for budget enforcement. Uses chars/3 conservative
// approximation — overestimates slightly, which is the safe direction
// (worst case: AGENTS.md is slightly under budget, not over).
//
// If an exact tokenizer is added to dependencies later, replace the
// implementation; the public signature is what budget.ts depends on.

export function estimateTokens(s: string): number {
  if (s.length === 0) return 0;
  return Math.ceil(s.length / 3);
}
