// anatomy-cli/src/render/cline.ts
// Cline renderer: emits .clinerules with the shared markdown body.
// Cline reads .clinerules as its convention-file by default.

import type { Pass1Result } from "../types.js";
import type { RenderArtifact, RenderOptions } from "./types.js";
import { renderSharedMarkdown } from "./shared-markdown.js";

export function renderClineArtifact(r: Pass1Result, opts: RenderOptions): RenderArtifact {
  return { path: ".clinerules", content: renderSharedMarkdown(r, opts) };
}
