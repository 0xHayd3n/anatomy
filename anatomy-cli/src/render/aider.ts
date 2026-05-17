// anatomy-cli/src/render/aider.ts
// Aider renderer: emits CONVENTIONS.md with the shared markdown body.
// Aider does not read AGENTS.md by default; CONVENTIONS.md is its standard
// convention-file path (loadable via --read in aider sessions).

import type { Pass1Result } from "../types.js";
import type { RenderArtifact, RenderOptions } from "./types.js";
import { renderSharedMarkdown } from "./shared-markdown.js";

export function renderAiderArtifact(r: Pass1Result, opts: RenderOptions): RenderArtifact {
  return { path: "CONVENTIONS.md", content: renderSharedMarkdown(r, opts) };
}
