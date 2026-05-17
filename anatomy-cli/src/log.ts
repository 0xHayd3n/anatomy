// src/log.ts
// Module-level debug flag with a single set point. Modules call `debug(...)`
// freely; only the bin enables it via `setVerbose(true)` before dispatch.

let verbose = false;

export function setVerbose(v: boolean): void {
  verbose = v;
}

export function debug(...parts: unknown[]): void {
  if (!verbose) return;
  const msg = parts.map(p => typeof p === "string" ? p : JSON.stringify(p)).join(" ");
  process.stderr.write(`anatomy[debug] ${msg}\n`);
}
