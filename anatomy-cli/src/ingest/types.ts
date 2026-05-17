// src/ingest/types.ts
// Types for the ingest subsystem. Reads existing rule-shaped context files
// (CLAUDE.md / AGENTS.md / .cursorrules / .windsurfrules) and produces
// IngestedRule[] for merging into a Pass1Result.

export interface IngestedRule {
  /** Rule text, max 300 chars per v0.13 schema. */
  rule: string;
  /** Optional why annotation, max 200 chars. Pulled from "Why:" / "Because:" / "Reason:" sub-bullet. */
  why?: string;
  /** Provenance — for internal summary printing only; NOT written into .anatomy. */
  source: {
    file: string;
    line: number;
    section: string;
  };
}

export interface DetectedSource {
  parser: ParserName;
  path: string;
}

export type ParserName = "claude-md" | "agents-md" | "cursor-rules" | "windsurf";

export interface Parser {
  name: ParserName;
  filenames: string[];
  parse(text: string, file: string): IngestedRule[];
}

export interface IngestResult {
  rules: IngestedRule[];
  dropped: IngestedRule[];
  warnings: string[];
  perFile: Record<string, number>;
}
