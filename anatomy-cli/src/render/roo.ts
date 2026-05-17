// anatomy-cli/src/render/roo.ts
// Roo Code renderer: emits .roorules with the shared markdown body.
// Roo reads .roorules as its convention-file by default.

import type { Pass1Result } from "../types.js";
import type { RenderArtifact, RenderOptions } from "./types.js";
import { renderSharedMarkdown } from "./shared-markdown.js";

export function renderRooArtifact(r: Pass1Result, opts: RenderOptions): RenderArtifact {
  return { path: ".roorules", content: renderSharedMarkdown(r, opts) };
}
