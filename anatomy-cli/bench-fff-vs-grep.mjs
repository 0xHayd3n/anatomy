#!/usr/bin/env node
// Quick benchmark: ripgrep cold (5 forks) vs fff-mcp warm (1 session, 5 calls).
// Run from anatomy repo root.
// Usage:
//   ANATOMY_FFF_BIN=path/to/fff-mcp.exe node anatomy-cli/bench-fff-vs-grep.mjs

import { spawn, execSync } from "node:child_process";
import { performance } from "node:perf_hooks";

const FFF_BIN = process.env.ANATOMY_FFF_BIN;
if (!FFF_BIN) {
  console.error("Set ANATOMY_FFF_BIN to fff-mcp binary path.");
  process.exit(1);
}

// Real patterns from this codebase — what an agent might ask while working
// on the FFF bridge itself.
const QUERIES = [
  "FFFBridge",
  "MCPClientLike",
  "fff_timeout",
  "ToolDefinition",
  "spawnAndHandshake",
  "anatomy_brief",
  "recordTelemetry",
  "BridgeState",
  "resolveAnatomy",
  "validate",
  "memory_search",
  "anatomy_overview",
  "buildAnatomyToml",
  "wrapError",
  "pillarString",
  "ToolResult",
  "errorResult",
  "renderTemplate",
  "TelemetryRecord",
  "section-tools",
];

function hr(ms) {
  return ms.toFixed(1) + " ms";
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ────── ripgrep cold-start path ──────
function benchRipgrep() {
  // Skip warmup; ripgrep is supposed to be fast cold. That's the point.
  const timings = [];
  const t0 = performance.now();
  for (const q of QUERIES) {
    const tq = performance.now();
    try {
      execSync(`rg --no-messages --count-matches "${q}" .`, {
        stdio: ["ignore", "ignore", "ignore"],
        shell: true,
      });
    } catch {
      /* rg exits 1 when no matches; that's fine */
    }
    timings.push(performance.now() - tq);
  }
  return { total: performance.now() - t0, perQuery: timings };
}

// ────── Generic warm-MCP-session bench (reused for direct + bridged) ──────
async function benchMcpSession({ command, args, env }) {
  const proc = spawn(command, args, {
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
    env: { ...process.env, ...env },
  });

  let buffer = "";
  let nextId = 1;
  const pending = new Map(); // id → resolve

  proc.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    let nl;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id != null && pending.has(msg.id)) {
          pending.get(msg.id)(msg);
          pending.delete(msg.id);
        }
      } catch {
        /* non-JSON, ignore */
      }
    }
  });

  function rpc(method, params) {
    return new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  // Handshake.
  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "bench", version: "0" },
  });
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

  // Warmup: poll until grep returns a populated result.
  const warmStart = performance.now();
  for (let i = 0; i < 30; i++) {
    const r = await rpc("tools/call", {
      name: "grep",
      arguments: { query: "FFFBridge", maxResults: 1 },
    });
    const text = r.result?.content?.[0]?.text ?? "";
    if (text && !text.includes("0 matches") && !text.includes("0 indexed")) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const warmupMs = performance.now() - warmStart;

  // Now time the real queries.
  const timings = [];
  const t0 = performance.now();
  for (const q of QUERIES) {
    const tq = performance.now();
    await rpc("tools/call", { name: "grep", arguments: { query: q, maxResults: 100 } });
    timings.push(performance.now() - tq);
  }
  const total = performance.now() - t0;

  proc.stdin.end();
  await new Promise((r) => proc.on("close", r));
  return { total, perQuery: timings, warmupMs };
}

async function benchFffDirect() {
  return benchMcpSession({ command: FFF_BIN, args: [], env: {} });
}

async function benchAnatomyBridge() {
  return benchMcpSession({
    command: "node",
    args: ["anatomy-cli/dist/bin.js", "mcp", "--with-fff"],
    env: { ANATOMY_FFF_BIN: FFF_BIN, ANATOMY_TELEMETRY_DISABLE: "1" },
  });
}

// ────── Run both ──────
console.log(`Bench: ${QUERIES.length} queries each, run from`, process.cwd());
console.log();

console.log("ripgrep (cold-fork per query)...");
const rg = benchRipgrep();
console.log(`  total: ${hr(rg.total)}`);
console.log(`  median per query: ${hr(median(rg.perQuery))}`);
console.log();

console.log("fff-mcp direct (one session, warm index)...");
const fff = await benchFffDirect();
console.log(`  warmup: ${hr(fff.warmupMs)}  (one-time per session)`);
console.log(`  total:  ${hr(fff.total)}`);
console.log(`  median per query: ${hr(median(fff.perQuery))}`);
console.log();

console.log("anatomy mcp --with-fff (bridge → fff-mcp)...");
const bridge = await benchAnatomyBridge();
console.log(`  warmup: ${hr(bridge.warmupMs)}  (one-time per session)`);
console.log(`  total:  ${hr(bridge.total)}`);
console.log(`  median per query: ${hr(median(bridge.perQuery))}`);
console.log();

function compare(label, t) {
  const speedup = rg.total / t.total;
  const amortized = rg.total / (t.total + t.warmupMs);
  console.log(
    `${label}: per-batch ${speedup.toFixed(1)}x faster; including warmup ${amortized.toFixed(1)}x faster.`,
  );
}
compare("fff-mcp direct", fff);
compare("anatomy → fff bridge", bridge);

const bridgeOverhead = bridge.total - fff.total;
const bridgeOverheadPct = ((bridgeOverhead / fff.total) * 100).toFixed(0);
console.log();
console.log(
  `Bridge overhead vs direct: +${hr(bridgeOverhead)} per batch (${bridgeOverheadPct}% of direct), ` +
  `+${hr(median(bridge.perQuery) - median(fff.perQuery))} median per query.`,
);
