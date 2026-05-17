// anatomy-cli/src/render/continue.ts
// Continue.dev renderer: emits .continuerules with the shared markdown body.
// Continue.dev reads .continuerules as its convention-file by default.

import type { Pass1Result } from "../types.js";
import type { RenderArtifact, RenderOptions } from "./types.js";
import { renderSharedMarkdown } from "./shared-markdown.js";

export function renderContinueArtifact(r: Pass1Result, opts: RenderOptions): RenderArtifact {
  return { path: ".continuerules", content: renderSharedMarkdown(r, opts) };
}
