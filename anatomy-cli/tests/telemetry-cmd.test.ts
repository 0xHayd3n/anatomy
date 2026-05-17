import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { telemetryCommand } from "../src/commands/telemetry-cmd.js";

let dir: string;
let stdoutBuf: string;
const origWrite = process.stdout.write.bind(process.stdout);
const origTel = process.env.ANATOMY_TELEMETRY_DIR;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "anat-tel-cmd-"));
  process.env.ANATOMY_TELEMETRY_DIR = dir;
  stdoutBuf = "";
  process.stdout.write = ((c: string | Uint8Array) => { stdoutBuf += c.toString(); return true; }) as typeof process.stdout.write;
});

afterEach(() => {
  process.env.ANATOMY_TELEMETRY_DIR = origTel;
  process.stdout.write = origWrite;
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
});

describe("anatomy telemetry stats", () => {
  it("reports zero counts when log is empty", async () => {
    const code = await telemetryCommand(["stats"], {});
    expect(code).toBe(0);
    expect(stdoutBuf).toContain("hook fires: 0");
  });

  it("aggregates hook fires and per-tool calls", async () => {
    writeFileSync(
      join(dir, "telemetry.jsonl"),
      [
        JSON.stringify({ kind: "hook_fire", ts: "t", repo_fingerprint: "a", cwd: "/x", sections: ["rules"], tokens_estimated: 100, truncated: false, stale: false }),
        JSON.stringify({ kind: "hook_fire", ts: "t2", repo_fingerprint: "a", cwd: "/y", sections: [], tokens_estimated: 50, truncated: true, stale: false }),
        JSON.stringify({ kind: "mcp_call", ts: "t3", tool: "anatomy_overview", args: {}, repo_fingerprint: "a", error: null, latency_ms: 5 }),
        JSON.stringify({ kind: "mcp_call", ts: "t4", tool: "anatomy_overview", args: {}, repo_fingerprint: "a", error: null, latency_ms: 7 }),
        JSON.stringify({ kind: "mcp_call", ts: "t5", tool: "anatomy_memory_search", args: { query: "windows" }, repo_fingerprint: "a", error: null, latency_ms: 3 }),
      ].join("\n") + "\n",
    );
    await telemetryCommand(["stats"], {});
    expect(stdoutBuf).toContain("hook fires: 2");
    expect(stdoutBuf).toContain("anatomy_overview: 2");
    expect(stdoutBuf).toContain("anatomy_memory_search: 1");
  });
});

describe("anatomy telemetry clear", () => {
  it("wipes the log file", async () => {
    writeFileSync(join(dir, "telemetry.jsonl"), "a\n");
    const code = await telemetryCommand(["clear"], {});
    expect(code).toBe(0);
    expect(existsSync(join(dir, "telemetry.jsonl"))).toBe(false);
  });
});
