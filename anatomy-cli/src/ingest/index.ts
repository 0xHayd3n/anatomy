// src/ingest/index.ts
// Public entry for the ingest subsystem. Takes a list of DetectedSource,
// dispatches to the right parser per source, deduplicates, and returns
// an IngestResult with kept rules + dropped (dedupe + cap overflow) +
// warnings + per-file counts.

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type { DetectedSource, IngestedRule, IngestResult, ParserName } from "./types.js";
import { parseClaudeMd } from "./claude-md.js";
import { parseAgentsMd } from "./agents-md.js";
import { parseCursorRules } from "./cursor-rules.js";
import { parseWindsurf } from "./windsurf.js";
import { dedupe } from "./dedupe.js";

const PARSERS: Record<ParserName, (text: string, file: string) => IngestedRule[]> = {
  "claude-md":     parseClaudeMd,
  "agents-md":     parseAgentsMd,
  "cursor-rules":  parseCursorRules,
  "windsurf":      parseWindsurf,
};

export function ingestRepo(sources: DetectedSource[]): IngestResult {
  const allRules: IngestedRule[] = [];
  const perFile: Record<string, number> = {};

  for (const source of sources) {
    const fileLabel = basename(source.path);
    const text = readFileSync(source.path, "utf8");
    const parser = PARSERS[source.parser];
    const rules = parser(text, fileLabel);
    perFile[fileLabel] = rules.length;
    allRules.push(...rules);
  }

  const { kept, dropped } = dedupe(allRules);

  return {
    rules: kept,
    dropped,
    warnings: [],
    perFile,
  };
}
