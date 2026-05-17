// src/ingest/claude-md.ts
// Parser for CLAUDE.md. v1 is a thin adapter over the shared extractor;
// CLAUDE.md is plain markdown with no format-specific preprocessing.

import type { IngestedRule } from "./types.js";
import { extractRules } from "./shared-extractor.js";

export function parseClaudeMd(text: string, file: string): IngestedRule[] {
  return extractRules(text, file);
}
