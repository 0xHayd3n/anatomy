// src/ingest/windsurf.ts
// Parser for .windsurfrules. Plain markdown per Windsurf docs.

import type { IngestedRule } from "./types.js";
import { extractRules } from "./shared-extractor.js";

export function parseWindsurf(text: string, file: string): IngestedRule[] {
  return extractRules(text, file);
}
