// compare.mjs — anatomy (pass1 + targeted fill) vs. conventional (dump-and-ask)
// Both routes use the local claude --print CLI; no API key required.
// Usage: node compare.mjs [repo-path]
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const REPO = process.argv[2] ?? "C:/Temp/cobalt-test";
const IS_WIN = process.platform === "win32";

// ── claude invocation ─────────────────────────────────────────────────────────

function callClaude(prompt) {
  const t0 = performance.now();
  const proc = spawnSync("claude", ["--print"], {
    input: prompt,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    timeout: 180_000,
    shell: IS_WIN,
  });
  const elapsedMs = Math.round(performance.now() - t0);
  if (proc.error) throw new Error(`claude CLI error: ${proc.error.message}`);
  if (proc.status !== 0) throw new Error(`claude exited ${proc.status}: ${proc.stderr?.trim()}`);
  return { output: proc.stdout.trim(), elapsedMs };
}

// ── shared file helpers ───────────────────────────────────────────────────────

function readFile(path, maxChars = Infinity) {
  try { const s = readFileSync(path, "utf8"); return maxChars < Infinity ? s.slice(0, maxChars) : s; }
  catch { return null; }
}

function listDir(path) {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter(d => !["node_modules", "dist", ".git"].includes(d.name) && !d.name.startsWith("."))
      .map(d => ({ name: d.name, isDir: d.isDirectory() }));
  } catch { return []; }
}

// ── approach 1: anatomy targeted fill ────────────────────────────────────────

async function runAnatomy() {
  // Dynamically import pass1 from the built dist
  const { runPass1 } = await import("./dist/pass1/index.js");
  const { renderToml } = await import("./dist/render/toml.js");

  const pass1Result = runPass1(REPO);
  const stub = renderToml(pass1Result);                    // contains # TODO markers

  const readme = readFile(join(REPO, "README.md"), 20_480) ?? "";

  // Subdir summaries for placeholder structure entries
  const subdirLines = [];
  for (const entry of pass1Result.structure.entries) {
    if (!entry.isPlaceholder) continue;
    const dirPath = join(REPO, entry.path.replace(/\/$/, ""));
    if (!existsSync(dirPath)) continue;
    const children = listDir(dirPath).map(d => d.name);
    if (children.length) subdirLines.push(`${entry.path} subdirs: ${children.slice(0, 20).join(", ")}`);
  }

  const systemPrompt = `You are filling in missing fields in a .anatomy file.
Rules:
- Only fill fields marked # TODO
- identity_domain and identity_function: lowercase hyphenated
- structure purposes: 1-2 sentences each (max 120 chars)
- dependency whys: 1 sentence each
- Emit 3-8 insights not inferrable from the listing alone; each: type, name, summary

Respond with ONLY a JSON object:
{
  "identity_domain": "string",
  "identity_function": "string",
  "structure_purposes": { "<path>": "<purpose>" },
  "dependency_whys": { "<name>": "<why>" },
  "insights": [{ "type": "...", "name": "...", "summary": "..." }]
}`;

  const context = [
    `## Current .anatomy (# TODO = needs filling)\n${stub}`,
    readme ? `## README.md\n${readme}` : "",
    subdirLines.length ? `## Subdirectory contents\n${subdirLines.join("\n")}` : "",
  ].filter(Boolean).join("\n\n");

  const prompt = `${systemPrompt}\n\nFill in the TODO fields using the repository context below.\n\n${context}`;

  console.error("[anatomy] calling claude...");
  const { output, elapsedMs } = callClaude(prompt);

  return {
    label: "anatomy (pass1 + targeted fill)",
    promptChars: prompt.length,
    outputChars: output.length,
    elapsedMs,
    output,
    pass1Stub: stub,
  };
}

// ── approach 2: conventional dump-and-ask ─────────────────────────────────────

async function runConventional() {
  const readme = readFile(join(REPO, "README.md")) ?? "";
  const rootPkg = readFile(join(REPO, "package.json")) ?? "";
  const contributing = readFile(join(REPO, "CONTRIBUTING.md"), 4_000) ?? "";

  // Gather sub-package manifests (one level + two levels deep)
  const subPkgs = [];
  for (const e of listDir(REPO)) {
    if (!e.isDir) continue;
    const pkg = readFile(join(REPO, e.name, "package.json"), 2_000);
    if (pkg) subPkgs.push(`### ${e.name}/package.json\n${pkg}`);
    for (const e2 of listDir(join(REPO, e.name))) {
      if (!e2.isDir) continue;
      const pkg2 = readFile(join(REPO, e.name, e2.name, "package.json"), 1_500);
      if (pkg2) subPkgs.push(`### ${e.name}/${e2.name}/package.json\n${pkg2}`);
    }
  }

  const context = [
    `# README.md\n${readme}`,
    `# package.json\n${rootPkg}`,
    contributing ? `# CONTRIBUTING.md\n${contributing}` : "",
    subPkgs.length ? `# Sub-package manifests\n${subPkgs.join("\n\n")}` : "",
  ].filter(Boolean).join("\n\n---\n\n");

  const prompt = `You are an expert software analyst. Provide a thorough technical description of this repository covering:
1. What it does (domain and primary function in a few words)
2. High-level architecture and how major components interact
3. The architectural role of each major directory
4. Key dependencies and why each exists
5. Notable patterns, constraints, or design decisions a new contributor must know

Be concise but complete. Use bullet points and headers.

---

${context}`;

  console.error("[conventional] calling claude...");
  const { output, elapsedMs } = callClaude(prompt);

  return {
    label: "conventional (dump-and-ask)",
    promptChars: prompt.length,
    outputChars: output.length,
    elapsedMs,
    output,
  };
}

// ── stats helper ──────────────────────────────────────────────────────────────

function approxTokens(chars) { return Math.round(chars / 4); }

function bar(ratio, width = 30) {
  const filled = Math.min(Math.round(ratio * width), width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

// ── main ──────────────────────────────────────────────────────────────────────

const [anatomy, conventional] = await Promise.all([runAnatomy(), runConventional()]);

const divider = "─".repeat(72);
const header = (t) => `\n${"═".repeat(72)}\n  ${t}\n${"═".repeat(72)}`;

console.log(header("STATS COMPARISON"));
console.log(`Repo: ${REPO}\n`);

const rows = [
  ["Metric", "anatomy", "conventional"],
  [divider, divider, divider],
  ["Prompt chars", anatomy.promptChars.toLocaleString(), conventional.promptChars.toLocaleString()],
  ["Prompt tokens (est.)", approxTokens(anatomy.promptChars).toLocaleString(), approxTokens(conventional.promptChars).toLocaleString()],
  ["Output chars", anatomy.outputChars.toLocaleString(), conventional.outputChars.toLocaleString()],
  ["Output tokens (est.)", approxTokens(anatomy.outputChars).toLocaleString(), approxTokens(conventional.outputChars).toLocaleString()],
  ["Elapsed (ms)", anatomy.elapsedMs.toLocaleString(), conventional.elapsedMs.toLocaleString()],
];

const colW = [26, 18, 18];
for (const row of rows) {
  console.log(row.map((c, i) => c.toString().padEnd(colW[i])).join("  "));
}

const inputRatio = conventional.promptChars / anatomy.promptChars;
const outputRatio = conventional.outputChars / anatomy.outputChars;

console.log(`\nInput overhead  (conv / anatomy): ${inputRatio.toFixed(2)}x   ${bar(Math.min(inputRatio / 5, 1))}`);
console.log(`Output overhead (conv / anatomy): ${outputRatio.toFixed(2)}x   ${bar(Math.min(outputRatio / 5, 1))}`);

console.log(header("ANATOMY OUTPUT  (structured JSON → becomes .anatomy TOML)"));
console.log(anatomy.output);

console.log(header("CONVENTIONAL OUTPUT  (prose)"));
console.log(conventional.output);

console.log(header("PASS 1 STUB  (what anatomy sends to the model — pre-fill)"));
console.log(anatomy.pass1Stub);
