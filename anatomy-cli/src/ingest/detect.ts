// src/ingest/detect.ts
// Flat repo-root scan for the 4 known rule-source filenames. Returns an
// ordered list — canonical order (CLAUDE.md first) for deterministic
// dedupe behavior downstream.

import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import type { DetectedSource, ParserName } from "./types.js";

const KNOWN_FILES: ReadonlyArray<{ filename: string; parser: ParserName }> = [
  { filename: "CLAUDE.md",      parser: "claude-md"    },
  { filename: "AGENTS.md",      parser: "agents-md"    },
  { filename: ".cursorrules",   parser: "cursor-rules" },
  { filename: ".windsurfrules", parser: "windsurf"     },
];

export function detectIngestSources(repoRoot: string): DetectedSource[] {
  const found: DetectedSource[] = [];
  for (const { filename, parser } of KNOWN_FILES) {
    const path = join(repoRoot, filename);
    if (existsSync(path)) {
      found.push({ parser, path });
    }
  }
  return found;
}

export function detectParser(filePath: string): ParserName {
  const base = basename(filePath);
  const match = KNOWN_FILES.find(f => f.filename === base);
  if (!match) {
    throw new Error(
      `Filename ${filePath} isn't a recognized rule-file format. ` +
      `Supported: ${KNOWN_FILES.map(f => f.filename).join(", ")}. ` +
      `Rename or pass --repo to auto-scan.`,
    );
  }
  return match.parser;
}
