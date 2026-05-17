// src/ingest/agents-md.ts
// Parser for AGENTS.md. Same format as CLAUDE.md for v1.

import type { IngestedRule } from "./types.js";
import { extractRules } from "./shared-extractor.js";

export function parseAgentsMd(text: string, file: string): IngestedRule[] {
  return extractRules(text, file);
}
