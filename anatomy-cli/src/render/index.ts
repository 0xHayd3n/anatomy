// src/render/index.ts
// renderAll coordinator: takes an in-memory AnatomyData (currently
// Pass1Result) plus RenderOptions and returns the list of artifacts
// to write. The CLI command layer wraps these in atomic file writes.
// No I/O happens here.
//
// v0.11 renderers (Cursor MDC + legacy, Aider, Cline, Roo, Continue,
// Windsurf) default to false. They opt in via [generate] flags or CLI
// emit options. AGENTS.md remains default true (existing v0.10 behavior).

import type { Pass1Result } from "../types.js";
import type { RenderArtifact, RenderOptions } from "./types.js";
import { renderAnatomyArtifact } from "./toml.js";
import { renderAgentsMdArtifact } from "./agents-md.js";
import { renderCursorMdcArtifact } from "./cursor-mdc.js";
import { renderCursorRulesArtifact } from "./cursor-rules.js";
import { renderAiderArtifact } from "./aider.js";
import { renderClineArtifact } from "./cline.js";
import { renderRooArtifact } from "./roo.js";
import { renderContinueArtifact } from "./continue.js";
import { renderWindsurfArtifact } from "./windsurf.js";

type RendererFn = (r: Pass1Result, opts: RenderOptions) => RenderArtifact;

interface ToolRenderer {
  /** Key in .anatomy [generate] section. */
  generateKey: string;
  /** Field in RenderOptions for CLI overrides. */
  optsKey: keyof RenderOptions;
  /** The factory. */
  factory: RendererFn;
}

const V11_RENDERERS: ToolRenderer[] = [
  { generateKey: "cursor_mdc",        optsKey: "emitCursorMdc",   factory: renderCursorMdcArtifact },
  { generateKey: "cursor_rules",      optsKey: "emitCursorRules", factory: renderCursorRulesArtifact },
  { generateKey: "aider_conventions", optsKey: "emitAider",       factory: renderAiderArtifact },
  { generateKey: "cline_rules",       optsKey: "emitCline",       factory: renderClineArtifact },
  { generateKey: "roo_rules",         optsKey: "emitRoo",         factory: renderRooArtifact },
  { generateKey: "continue_rules",    optsKey: "emitContinue",    factory: renderContinueArtifact },
  { generateKey: "windsurf_rules",    optsKey: "emitWindsurf",    factory: renderWindsurfArtifact },
];

export function renderAll(r: Pass1Result, opts: RenderOptions): RenderArtifact[] {
  const artifacts: RenderArtifact[] = [];
  if (opts.emitAnatomy !== false) {
    artifacts.push(renderAnatomyArtifact(r, { modelId: opts.modelId, anatomyVersion: opts.anatomyVersion }));
  }
  // CLI opts win over file [generate].agents_md; file config wins over default true.
  const fileAgentsMd = (r as unknown as { generate?: { agents_md?: boolean } }).generate?.agents_md;
  const emitAgentsMd = opts.emitAgentsMd ?? fileAgentsMd ?? true;
  if (emitAgentsMd) {
    artifacts.push(renderAgentsMdArtifact(r, opts));
  }
  // v0.11 renderers (all default false).
  const generate = (r as unknown as { generate?: Record<string, unknown> }).generate;
  for (const tool of V11_RENDERERS) {
    const fileFlag = generate?.[tool.generateKey];
    const cliOverride = opts[tool.optsKey];
    const enabled = (cliOverride as boolean | undefined) ?? (fileFlag as boolean | undefined) ?? false;
    if (enabled) {
      artifacts.push(tool.factory(r, opts));
    }
  }
  return artifacts;
}
