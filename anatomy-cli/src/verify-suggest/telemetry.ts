// src/verify-suggest/telemetry.ts
// Records one verify_suggest_session entry per command invocation.

import { recordTelemetry } from "../telemetry.js";
import type { SuggestionSource } from "./types.js";

export interface SessionStats {
  rules_total: number;
  rules_with_existing_verify: number;
  candidates_by_source: Record<SuggestionSource | "none", number>;
  accepted: number;
  rejected: number;
  skipped: number;
  edited: number;
  quit_mid_session: boolean;
  duration_ms: number;
  repo_fingerprint: string;
}

export function recordSession(stats: SessionStats): void {
  recordTelemetry({
    kind: "verify_suggest_session",
    ts: new Date().toISOString(),
    ...stats,
  } as Parameters<typeof recordTelemetry>[0]);
}
