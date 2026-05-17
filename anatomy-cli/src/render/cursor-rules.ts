// anatomy-cli/src/render/cursor-rules.ts
// Cursor (legacy) renderer: emits .cursorrules with the shared markdown body.
// Predates Cursor's .mdc format. Many Cursor users still rely on .cursorrules;
// the newer .cursor/rules/anatomy.mdc is emitted by a separate renderer.

import type { Pass1Result } from "../types.js";
import type { RenderArtifact, RenderOptions } from "./types.js";
import { renderSharedMarkdown } from "./shared-markdown.js";

export function renderCursorRulesArtifact(r: Pass1Result, opts: RenderOptions): RenderArtifact {
  return { path: ".cursorrules", content: renderSharedMarkdown(r, opts) };
}
