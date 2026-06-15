// src/telemetry.ts
// Append-only JSONL telemetry for the anatomy consumer.
// User-global storage at ~/.anatomy/telemetry.jsonl. Silent on failure —
// telemetry must never break the main code path.
//
// Env-var hooks:
//   ANATOMY_TELEMETRY_DISABLE — truthy (anything except "0" / "false" / "")
//                                suppresses all writes. Used by integration
//                                tests and privacy-conscious users.
//   ANATOMY_TELEMETRY_DIR     — override the storage directory (default
//                                ~/.anatomy). Used by tests + eval runs to
//                                isolate per-run telemetry from the user's log.
//   ANATOMY_TELEMETRY_TAG     — added as a `tag` field on every record. Used
//                                by eval runs to filter their own telemetry
//                                from the firehose later. Empty string or
//                                unset → no tag field emitted.

import { existsSync, mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type TelemetryRecord =
  | {
      kind: "hook_fire";
      ts: string;
      repo_fingerprint: string;
      cwd: string;
      sections: string[];
      tokens_estimated: number;
      truncated: boolean;
      stale: boolean;
    }
  | {
      kind: "mcp_call";
      ts: string;
      tool: string;
      args: Record<string, unknown>;
      repo_fingerprint: string;
      result_count?: number;
      result_bytes?: number;
      error: string | null;
      latency_ms: number;
      returned_ids?: {
        rules?: string[];
        memory?: string[];
        flows?: string[];
      };
    }
  | {
      kind: "verify_suggest_session";
      ts: string;
      rules_total: number;
      rules_with_existing_verify: number;
      candidates_by_source: Record<string, number>;
      accepted: number;
      rejected: number;
      skipped: number;
      edited: number;
      quit_mid_session: boolean;
      duration_ms: number;
      repo_fingerprint: string;
    }
  | {
      kind: "fff_bridge_lifecycle";
      ts: string;
      event: "started" | "restarted" | "degraded" | "stopped";
    }
  | {
      kind: "fff_call";
      ts: string;
      tool: string;
      duration_ms: number;
      outcome: "ok" | "restarted" | "unavailable" | "timeout" | "error";
    };

function telemetryDir(): string {
  return process.env.ANATOMY_TELEMETRY_DIR ?? join(homedir(), ".anatomy");
}

export function getTelemetryFile(): string {
  return join(telemetryDir(), "telemetry.jsonl");
}

function telemetryTag(): string | undefined {
  const tag = process.env.ANATOMY_TELEMETRY_TAG;
  if (typeof tag !== "string" || tag.length === 0) return undefined;
  return tag;
}

export function recordTelemetry(record: TelemetryRecord): void {
  const disable = process.env.ANATOMY_TELEMETRY_DISABLE;
  if (disable && disable !== "0" && disable.toLowerCase() !== "false") return;
  try {
    const dir = telemetryDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const gi = join(dir, ".gitignore");
    if (!existsSync(gi)) writeFileSync(gi, "*\n");
    const tag = telemetryTag();
    const out = tag !== undefined ? { ...record, tag } : record;
    appendFileSync(getTelemetryFile(), JSON.stringify(out) + "\n");
  } catch {
    // Silent — telemetry must never break the main code path.
  }
}
