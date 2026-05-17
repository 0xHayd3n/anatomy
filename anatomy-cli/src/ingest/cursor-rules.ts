// src/ingest/cursor-rules.ts
// Parser for .cursorrules. Plain markdown per Cursor convention.

import type { IngestedRule } from "./types.js";
import { extractRules } from "./shared-extractor.js";

export function parseCursorRules(text: string, file: string): IngestedRule[] {
  return extractRules(text, file);
}
