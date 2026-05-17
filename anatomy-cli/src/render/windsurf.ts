// anatomy-cli/src/render/windsurf.ts
// Windsurf renderer: emits .windsurfrules with the shared markdown body.
// Windsurf reads .windsurfrules as its convention-file by default.

import type { Pass1Result } from "../types.js";
import type { RenderArtifact, RenderOptions } from "./types.js";
import { renderSharedMarkdown } from "./shared-markdown.js";

export function renderWindsurfArtifact(r: Pass1Result, opts: RenderOptions): RenderArtifact {
  return { path: ".windsurfrules", content: renderSharedMarkdown(r, opts) };
}
