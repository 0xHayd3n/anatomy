// Shared text utilities for tagline and Pass 2 field truncation. Keeps the
// "graceful cut at a coherent boundary" logic in one place so README-derived
// taglines and LLM-derived purposes/summaries both produce clean output.

/** Truncate a single-line string to at most `max` chars, preferring a
 *  sentence boundary over a word boundary, and trimming trailing connectors
 *  ("," ";" ":" "—" "(" "[" etc.) that would imply the text continues.
 *  Newlines/CR are collapsed to spaces — output is guaranteed single-line.
 *
 *  Used for fields whose schema constrains them to one line:
 *    tagline (120), structure.entries[].purpose (120),
 *    interface.*.summary (120), substance.key_dependencies[].why (80),
 *    flows[].name (40), flows[].summary (300), decisions[].topic (120). */
export function smartTruncateLine(s: string, max: number): string {
  if (typeof s !== "string") return "";
  // Normalize whitespace (collapse runs incl. CR/LF) so the output never
  // contains raw newlines that would fail the schema's single-line patterns.
  const oneLine = s.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;

  const head = oneLine.slice(0, max);

  // Prefer a sentence boundary when one exists past the first ~third of the
  // budget — high enough to avoid one-word "Hi." truncations, low enough
  // that mid-budget sentence breaks ("First sentence ends here. ...") still
  // win over splicing at a word boundary mid-second-sentence.
  const sentenceMin = Math.max(15, Math.floor(max / 3));
  const sentenceEndIdx = Math.max(
    head.lastIndexOf(". "),
    head.lastIndexOf("! "),
    head.lastIndexOf("? "),
  );
  if (sentenceEndIdx >= sentenceMin) {
    return head.slice(0, sentenceEndIdx + 1); // keep the punctuation
  }

  // Word boundary fallback.
  const lastSpace = head.lastIndexOf(" ");
  if (lastSpace <= 0) return head;
  let cut = head.slice(0, lastSpace);

  // Strip trailing connectors that imply the sentence continues.
  cut = cut.replace(/[\s,.;:!?\-—(\[{<«/]+$/u, "");

  // If the cut left an unclosed bracket/paren, walk back to before it.
  // Pass 2 + README first-line content commonly contains "(YouTube, Instagram,
  // ...)" lists that get cut mid-list; presenting the orphan open paren
  // looks worse than dropping the whole parenthetical.
  const opens = (cut.match(/[(\[]/g) ?? []).length;
  const closes = (cut.match(/[)\]]/g) ?? []).length;
  if (opens > closes) {
    const lastOpen = Math.max(cut.lastIndexOf("("), cut.lastIndexOf("["));
    if (lastOpen > 0) {
      cut = cut.slice(0, lastOpen).replace(/[\s,.;:!?\-—(\[{<«/]+$/u, "");
    }
  }

  return cut || head; // never return empty if we had any content
}
