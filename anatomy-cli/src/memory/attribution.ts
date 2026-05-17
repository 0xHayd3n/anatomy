// src/memory/attribution.ts
// Detect the `by` attribution for a memory entry, in priority order:
//   1. $ANATOMY_BY env var (explicit override)
//   2. claude-session if $CLAUDECODE is set
//   3. human:<localpart> from `git config user.email`
//   4. unknown

import { spawnSync } from "node:child_process";

export function detectBy(cwd?: string): string {
  if (process.env.ANATOMY_BY) return process.env.ANATOMY_BY;
  if (process.env.CLAUDECODE) return "claude-session";
  try {
    const r = spawnSync("git", ["config", "user.email"], {
      cwd: cwd ?? process.cwd(),
      encoding: "utf8",
      timeout: 2000,
      shell: true,
    });
    if (r.status === 0 && typeof r.stdout === "string") {
      const email = r.stdout.trim();
      const local = email.split("@")[0];
      if (local && /^[a-z0-9._-]+$/i.test(local)) {
        return `human:${local.toLowerCase()}`;
      }
    }
  } catch {}
  return "unknown";
}
