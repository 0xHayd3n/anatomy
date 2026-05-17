// src/render/types.ts
// Shared render-layer types. Renderers are pure functions:
// (AnatomyData, RenderOptions) -> string. The render-all coordinator
// wraps each rendered string into a RenderArtifact for the atomic
// batch writer at the CLI boundary.

export interface RenderArtifact {
  /** Path relative to the repo root, e.g. ".anatomy" or "AGENTS.md". */
  path: string;
  /** UTF-8 content to write. */
  content: string;
}

export interface RenderOptions {
  /** Emit .anatomy TOML file (default true). */
  emitAnatomy?: boolean;
  /** Emit AGENTS.md file (default true; from [generate].agents_md). */
  emitAgentsMd?: boolean;
  /** Token budget for AGENTS.md (default 1500; min 500). */
  agentsMdBudgetTokens?: number;
  /** Max recent-memory entries surfaced in AGENTS.md (default 10). */
  agentsMdMemoryCount?: number;
  /** Pass 2 model identifier for the .anatomy [generated] block. */
  modelId?: string;
  /** Repo root for resolving paired files like .anatomy-memory. */
  repoRoot?: string;
  /** Override anatomy_version for the .anatomy renderer (default: latest).
   *  Set by the render command to preserve input version on regen. */
  anatomyVersion?: string;

  /** Token budget for v0.11 renderers (Cursor / Aider / Cline / Roo / Continue / Windsurf).
   *  Default 1500. Read from [generate].render_budget when absent. */
  renderBudgetTokens?: number;

  /** Memory count for v0.11 renderers. Default 10. */
  renderMemoryCount?: number;

  /** Per-tool emit overrides. When unset, falls back to [generate].<flag>, then false. */
  emitCursorMdc?: boolean;
  emitCursorRules?: boolean;
  emitAider?: boolean;
  emitCline?: boolean;
  emitRoo?: boolean;
  emitContinue?: boolean;
  emitWindsurf?: boolean;
}
