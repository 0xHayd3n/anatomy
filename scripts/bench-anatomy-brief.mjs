#!/usr/bin/env node
// scripts/bench-anatomy-brief.mjs
// One-shot benchmark for anatomy_brief — measures cold-start (first call,
// includes model load + cache build) and warm (cache hit) latencies against
// this repo's .anatomy. Used for post-implementation measurements in the spec.

import { sectionToolHandlers } from "../anatomy-cli/dist/mcp/section-tools.js";

const repoRoot = process.cwd();
const query = process.argv[2] ?? "semgrep windows shell shim spawn";

console.log(`repo: ${repoRoot}`);
console.log(`query: "${query}"`);
console.log("");

// Cold call (first call — model load + cache build).
const t0 = performance.now();
const r1 = await sectionToolHandlers.anatomy_brief({ path: repoRoot, query });
const cold = performance.now() - t0;

if ("error" in r1) {
  console.error("error:", r1);
  process.exit(1);
}

console.log(`cold:    ${cold.toFixed(1)} ms`);
console.log(`  rules:  ${r1.data.rules.length} (top: ${r1.data.rules[0]?.rule.slice(0, 60) ?? "(none)"})`);
console.log(`  memory: ${r1.data.memory.length} (top: ${r1.data.memory[0]?.id ?? "(none)"})`);
console.log(`  flows:  ${r1.data.flows.length}`);
console.log(`  hint:   ${r1.data.hint ?? "(none)"}`);
console.log(`  bytes:  ${JSON.stringify(r1).length}`);
console.log("");

// Warm calls — cache hit, only query-embed work.
const warms = [];
for (let i = 0; i < 5; i++) {
  const t = performance.now();
  await sectionToolHandlers.anatomy_brief({ path: repoRoot, query });
  warms.push(performance.now() - t);
}
warms.sort((a, b) => a - b);
console.log(`warm:    median ${warms[Math.floor(warms.length / 2)].toFixed(1)} ms, min ${warms[0].toFixed(1)} ms, max ${warms[warms.length - 1].toFixed(1)} ms (n=${warms.length})`);
