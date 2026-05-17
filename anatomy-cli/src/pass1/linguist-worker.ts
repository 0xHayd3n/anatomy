// src/pass1/linguist-worker.ts
//
// Subprocess entrypoint for the linguist-based stack fallback. Run as:
//   node dist/pass1/linguist-worker.js <repo-path>
//
// Prints a single JSON line to stdout:
//   { ok: true, elapsedMs, languages: [{ name, bytes }] }   — programming languages, byte-desc
//   { ok: false, error: "..." }
//
// Heuristic-mode config is required: quick: true misclassifies .rs as
// RenderScript and .md as "GCC Machine Description" (deprecated/internal
// linguist categories that happen to share file extensions with Rust and
// Markdown). The spike measured this on the 50-repo corpus.
//
// Isolated in a subprocess because linguist-js can crash deep in
// isbinaryfile's async callbacks on some repos (prettier was the corpus
// case) — try/catch around `await linguist(...)` doesn't catch those
// because they're thrown from an fs callback after the await resolves.

import linguist from "linguist-js";

const repoPath = process.argv[2];
if (!repoPath) {
  console.log(JSON.stringify({ ok: false, error: "no path arg" }));
  process.exit(0);
}

process.on("uncaughtException", (e: Error) => {
  console.log(JSON.stringify({ ok: false, error: `uncaught: ${e.message}` }));
  process.exit(0);
});
process.on("unhandledRejection", (e) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.log(JSON.stringify({ ok: false, error: `unhandled: ${msg}` }));
  process.exit(0);
});

try {
  const t0 = performance.now();
  const r = await linguist(repoPath, {
    quick: false,
    keepVendored: false,
    keepBinary: false,
    checkHeuristics: true,
    checkShebang: true,
    checkModeline: true,
  });
  const elapsedMs = Math.round(performance.now() - t0);
  const programming = Object.entries(r.languages.results)
    .filter(([, v]) => v.type === "programming")
    .map(([name, v]) => ({ name, bytes: v.bytes }))
    .sort((a, b) => b.bytes - a.bytes);
  console.log(JSON.stringify({ ok: true, elapsedMs, languages: programming }));
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  console.log(JSON.stringify({ ok: false, error: msg }));
}
