// src/commands/telemetry-cmd.ts
// `anatomy telemetry stats` and `anatomy telemetry clear`.

import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { getTelemetryFile } from "../telemetry.js";

export interface TelemetryCmdOptions {}

export async function telemetryCommand(positional: string[], _opts: TelemetryCmdOptions): Promise<number> {
  const sub = positional[0];
  if (sub === "stats") return statsCommand();
  if (sub === "clear") return clearCommand();
  if (sub === undefined) {
    console.error(`anatomy telemetry: missing subcommand. Use 'stats' or 'clear'.`);
  } else {
    console.error(`anatomy telemetry: unknown subcommand "${sub}". Use 'stats' or 'clear'.`);
  }
  return 1;
}

function statsCommand(): number {
  const file = getTelemetryFile();
  if (!existsSync(file)) {
    process.stdout.write(`telemetry log: ${file} (empty)\nhook fires: 0\nmcp calls: 0\n`);
    return 0;
  }
  const lines = readFileSync(file, "utf8").split("\n").filter(l => l.trim());
  let hookFires = 0;
  let truncatedFires = 0;
  let staleFires = 0;
  const tokensTotal: number[] = [];
  const toolCounts: Record<string, number> = {};
  const toolErrors: Record<string, number> = {};
  const queries: string[] = [];

  for (const line of lines) {
    let rec: { kind?: string };
    try { rec = JSON.parse(line); } catch { continue; }
    if (rec.kind === "hook_fire") {
      hookFires++;
      const r = rec as { truncated: boolean; stale: boolean; tokens_estimated: number };
      if (r.truncated) truncatedFires++;
      if (r.stale) staleFires++;
      tokensTotal.push(r.tokens_estimated);
    } else if (rec.kind === "mcp_call") {
      const r = rec as { tool: string; error: string | null; args: Record<string, unknown> };
      toolCounts[r.tool] = (toolCounts[r.tool] ?? 0) + 1;
      if (r.error) toolErrors[r.tool] = (toolErrors[r.tool] ?? 0) + 1;
      if (r.tool === "anatomy_memory_search" && typeof r.args.query === "string") {
        queries.push(r.args.query);
      }
    }
  }

  const avgTokens = tokensTotal.length > 0 ? Math.round(tokensTotal.reduce((a, b) => a + b, 0) / tokensTotal.length) : 0;
  const lines_out: string[] = [];
  lines_out.push(`telemetry log: ${file}`);
  lines_out.push(`hook fires: ${hookFires}`);
  if (hookFires > 0) {
    lines_out.push(`  truncated: ${truncatedFires} (${Math.round(100 * truncatedFires / hookFires)}%)`);
    lines_out.push(`  stale: ${staleFires}`);
    lines_out.push(`  avg tokens: ${avgTokens}`);
  }
  const totalCalls = Object.values(toolCounts).reduce((a, b) => a + b, 0);
  lines_out.push(`mcp calls: ${totalCalls}`);
  for (const [tool, count] of Object.entries(toolCounts).sort((a, b) => b[1] - a[1])) {
    const errs = toolErrors[tool] ?? 0;
    lines_out.push(`  ${tool}: ${count}${errs > 0 ? ` (${errs} errors)` : ""}`);
  }
  if (queries.length > 0) {
    lines_out.push(`top memory queries:`);
    const counts: Record<string, number> = {};
    for (const q of queries) counts[q] = (counts[q] ?? 0) + 1;
    for (const [q, c] of Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5)) {
      lines_out.push(`  "${q}": ${c}`);
    }
  }
  process.stdout.write(lines_out.join("\n") + "\n");
  return 0;
}

function clearCommand(): number {
  const file = getTelemetryFile();
  if (existsSync(file)) unlinkSync(file);
  process.stdout.write(`telemetry log cleared: ${file}\n`);
  return 0;
}
