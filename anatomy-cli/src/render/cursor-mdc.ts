// anatomy-cli/src/render/cursor-mdc.ts
// Cursor MDC renderer: emits .cursor/rules/anatomy.mdc with YAML
// frontmatter (description + alwaysApply) wrapping the shared markdown body.
// The .cursor/rules/ directory is Cursor's newer rule format; older Cursor
// versions read .cursorrules instead (see cursor-rules.ts).

import type { Pass1Result } from "../types.js";
import type { RenderArtifact, RenderOptions } from "./types.js";
import { renderSharedMarkdown } from "./shared-markdown.js";

/** Read tagline from Pass1Result envelope { value, isPlaceholder, source } */
function taglineString(t: Pass1Result["tagline"]): string {
  return t.value;
}

/** Escape backslashes, double quotes, and control characters (newlines,
 *  carriage returns, tabs) for use inside a YAML double-quoted single-line
 *  string. YAML allows literal newlines in double-quoted strings via line
 *  folding, but that would break our single-line frontmatter assumption. */
function yamlEscapeDoubleQuoted(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

function buildFrontmatter(tagline: string): string {
  const escaped = yamlEscapeDoubleQuoted(tagline);
  return `---\ndescription: "${escaped}"\nalwaysApply: true\n---\n\n`;
}

export function renderCursorMdcArtifact(r: Pass1Result, opts: RenderOptions): RenderArtifact {
  const tagline = taglineString(r.tagline);
  const body = renderSharedMarkdown(r, opts);
  return {
    path: ".cursor/rules/anatomy.mdc",
    content: buildFrontmatter(tagline) + body,
  };
}
