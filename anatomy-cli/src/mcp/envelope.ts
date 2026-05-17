// src/mcp/envelope.ts
// Standard response envelope for every MCP tool.

import type { ResolvedAnatomy, ResolveError } from "../resolve.js";
import type { StalenessSignificance } from "../staleness-significance.js";
import type { RuleStaleness, RuleStatus } from "../staleness-per-rule.js";
import type {
  BriefData,
  BriefRule,
  BriefMemory,
  BriefFlow,
  BriefVocabulary,
  BriefInvariant,
  BriefAntiPattern,
  BriefPrerequisite,
} from "./brief-tool.js";

// Re-export so external consumers can keep importing from envelope.js.
export type { RuleStaleness, RuleStatus };

// Re-export the anatomy_brief response shape and its entry types. The shape
// is owned by brief-tool.ts (each tool owns its data type), re-exported here
// so consumers can rely on a stable surface for the v0.15 sections. The four
// v0.15 entry types (BriefVocabulary, BriefInvariant, BriefAntiPattern,
// BriefPrerequisite) are populated by their respective per-slot surfacing
// logic in brief-tool.ts.
export type {
  BriefData,
  BriefRule,
  BriefMemory,
  BriefFlow,
  BriefVocabulary,
  BriefInvariant,
  BriefAntiPattern,
  BriefPrerequisite,
};

export interface StalenessInfo {
  file_commit: string;
  head_commit: string;
  significance: StalenessSignificance;
  rules: RuleStaleness[];
}

export interface SuccessEnvelope<T> {
  anatomy_path: string;
  staleness: StalenessInfo | null;
  repo_fingerprint: string;
  data: T;
}

export type ErrorEnvelope =
  | { error: "anatomy_not_found"; path: string }
  | { error: "validation_failed"; code: string; pointer: string; message: string }
  | { error: "memory_not_found_for_anatomy"; path: string }
  | { error: "invalid_id"; id: string }
  | { error: "entry_not_found"; id: string };

export function wrapResponse<T>(data: T, resolved: ResolvedAnatomy): SuccessEnvelope<T> {
  return {
    anatomy_path: resolved.anatomy_path,
    staleness: resolved.staleness,
    repo_fingerprint: (resolved.doc as unknown as { identity?: { fingerprint?: string } }).identity?.fingerprint ?? "",
    data,
  };
}

export function wrapError(err: ResolveError): ErrorEnvelope {
  if (err.error === "anatomy_not_found") return err;
  return {
    error: "validation_failed",
    code: err.code,
    pointer: err.pointer,
    message: err.message,
  };
}
