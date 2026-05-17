// src/render/shared-markdown.ts
// Shared markdown body used by v0.11 renderers (Cursor / Aider / Cline /
// Roo / Continue / Windsurf). Extracts the budget+sections+render pipeline
// from agents-md.ts so each per-tool renderer can be a thin wrapper.
// AGENTS.md continues using renderAgentsMd directly with its own budget
// field (agents_md_budget) for v0.10 backward compatibility.

import type { Pass1Result } from "../types.js";
import type { RenderOptions } from "./types.js";
import { buildSections } from "./agents-md.js";
import { applyBudget, renderSections } from "./budget.js";

const DEFAULT_RENDER_BUDGET = 1500;
const DEFAULT_RENDER_MEMORY_COUNT = 10;

/** Renders the shared markdown body. Budget precedence:
 *    RenderOptions.renderBudgetTokens
 *  > .anatomy [generate].render_budget
 *  > DEFAULT_RENDER_BUDGET (1500).
 *  Memory count precedence:
 *    RenderOptions.renderMemoryCount
 *  > .anatomy [generate].render_memory_count
 *  > DEFAULT_RENDER_MEMORY_COUNT (10).
 *  We pass memory_count into buildSections via agentsMdMemoryCount because
 *  that's the option key buildSections reads — AGENTS.md emission is
 *  unaffected because it calls renderAgentsMd, not renderSharedMarkdown. */
export function renderSharedMarkdown(r: Pass1Result, opts: RenderOptions): string {
  const fileBudget = (r as unknown as { generate?: { render_budget?: number } })
    .generate?.render_budget;
  const budget = opts.renderBudgetTokens ?? fileBudget ?? DEFAULT_RENDER_BUDGET;
  const fileMemCount = (r as unknown as { generate?: { render_memory_count?: number } })
    .generate?.render_memory_count;
  const memCount = opts.renderMemoryCount ?? fileMemCount ?? DEFAULT_RENDER_MEMORY_COUNT;
  const optsForSections: RenderOptions = { ...opts, agentsMdMemoryCount: memCount };
  const sections = buildSections(r, optsForSections);
  const final = applyBudget(sections, budget);
  return renderSections(final);
}
