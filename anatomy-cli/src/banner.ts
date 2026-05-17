// src/banner.ts
// Single source of truth for the regen banner literal used by all
// banner-protected render targets (AGENTS.md and v0.11 renderers:
// .cursor/rules/anatomy.mdc, .cursorrules, CONVENTIONS.md, .clinerules,
// .roorules, .continuerules, .windsurfrules). Emitted by each renderer's
// markdown body; detected by render/write.ts during the
// backup-on-hand-edit / idempotent-overwrite write strategy.

/** Detection literal — substring match on the first 10 lines of an AGENTS.md
 *  to decide whether anatomy generated the file. Deliberately precise
 *  (not regex-broad) so a file that happens to mention anatomy in passing
 *  doesn't get auto-overwritten. */
export const REGEN_BANNER_DETECT = "Regenerated from `.anatomy` at commit `";

/** Returns true if `content` is an anatomy-generated AGENTS.md, i.e. the
 *  regen banner appears in the first 10 lines. */
export function hasRegenBanner(content: string): boolean {
  // 10 lines accommodates renderers with a leading YAML frontmatter block
  // (e.g., Cursor MDC has 4 lines of frontmatter + a blank line, so the
  // banner starts at line 6). Substring scan is cheap; widening the window
  // is a free defensive measure.
  const head = content.split("\n").slice(0, 10).join("\n");
  return head.includes(REGEN_BANNER_DETECT);
}

/** Render the banner sentence given commit + by. The emitted form is what
 *  hasRegenBanner detects. */
export function formatRegenBannerLine(commit: string, by: string): string {
  return `Regenerated from \`.anatomy\` at commit \`${commit}\` by \`${by}\`.`;
}
