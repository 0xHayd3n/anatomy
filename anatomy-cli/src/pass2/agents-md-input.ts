// src/pass2/agents-md-input.ts
// Reads existing AGENTS.md as Pass 2 input. Returns:
//   - undefined if no AGENTS.md exists
//   - undefined if AGENTS.md is anatomy-generated (regen banner present) —
//     feeding the output back into Pass 2 would be circular
//   - the content (possibly truncated to 3000 chars) otherwise

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { hasRegenBanner } from "../banner.js";

const MAX_CHARS = 3000;
const TRUNCATION_MARKER =
  "\n[...truncated at 3000 chars; see AGENTS.md.bak after first generate for full content]";

export function readExistingAgentsMd(repoRoot: string): string | undefined {
  const path = join(repoRoot, "AGENTS.md");
  if (!existsSync(path)) return undefined;
  const content = readFileSync(path, "utf8");
  if (hasRegenBanner(content)) return undefined;
  if (content.length <= MAX_CHARS) return content;
  return content.slice(0, MAX_CHARS) + TRUNCATION_MARKER;
}
