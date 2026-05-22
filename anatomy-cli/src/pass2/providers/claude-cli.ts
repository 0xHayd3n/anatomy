// src/pass2/providers/claude-cli.ts
// Default Pass 2 provider — wraps the local `claude` CLI. Identical behavior
// to v0.10.0's inline spawnSync logic in pass2/index.ts; the refactor moves
// it behind the Pass2Provider interface so additional providers can register
// later without touching the orchestrator.

import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { ProviderError, type Pass2Provider } from "./types.js";

const CLAUDE_BIN = "claude";
// Default covers material-ui-class monorepos with headroom (live repro: pass-2
// call ~90s on mui/material-ui; 120s ceiling tipped over under any IO
// contention). Override per-invocation via ANATOMY_CLAUDE_CLI_TIMEOUT_MS.
const DEFAULT_TIMEOUT_MS = 300_000;
const MAX_BUFFER = 10 * 1024 * 1024;
// Retry on Windows cmd.exe shim contention (50-repo run: 10/50 hit ETIMEDOUT
// at concurrency=8). Sequential retry recovered all 10. Two attempts caps
// worst-case wait at ~3 min for the timeout-cascade case while leaving the
// happy path unchanged.
const MAX_ATTEMPTS = 2;
const RETRY_BACKOFF_MS = 1_500;

function getTimeoutMs(): number {
  // Strict digit-only parse + positivity guard. Matches the format check in
  // src/staleness-per-rule.ts / src/verify-suggest/dry-run.ts and additionally
  // rejects "0" (which spawnSync would otherwise treat as an immediate kill).
  const v = process.env.ANATOMY_CLAUDE_CLI_TIMEOUT_MS;
  if (v && /^\d+$/.test(v)) {
    const n = Number(v);
    if (n > 0) return n;
  }
  return DEFAULT_TIMEOUT_MS;
}

// Pre-launch failure on Windows cmd.exe shim under concurrency contention.
// Retry recovers (per the 50-repo stress test referenced above).
function isShimTimeout(proc: SpawnSyncReturns<string>): boolean {
  return (proc.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
}

// Post-launch wall-clock timeout: spawnSync killed the child after the
// timeout option fired. Retry cannot recover — same prompt against the same
// model will hit the same ceiling.
function isWallclockTimeout(proc: SpawnSyncReturns<string>): boolean {
  return proc.signal === "SIGTERM";
}

/** Argv for the `claude` CLI. `--print` always; `--model <id>` only when a
 *  model override is in effect. Pure + exported for unit testing. */
export function claudeArgs(model?: string): string[] {
  return model ? ["--print", "--model", model] : ["--print"];
}

function spawnClaude(fullPrompt: string, timeoutMs: number, model?: string): SpawnSyncReturns<string> {
  return spawnSync(CLAUDE_BIN, claudeArgs(model), {
    input: fullPrompt,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
    timeout: timeoutMs,
    shell: true,
  });
}

export const claudeCliProvider: Pass2Provider = {
  name: "claude-cli",
  description: "Local Claude Code CLI (default; piggybacks on Claude Code authentication; no API key required).",

  async available(): Promise<boolean> {
    // Spawn `claude --version` with shell:true (Windows .cmd shim resolution
    // — see memory entry t9ykw3em). A successful exit code indicates the
    // binary is on PATH and runnable.
    try {
      const r = spawnSync(CLAUDE_BIN, ["--version"], {
        encoding: "utf8",
        shell: true,
        timeout: 5000,
      });
      return r.status === 0;
    } catch {
      return false;
    }
  },

  async generate(input): Promise<string> {
    // Concatenate system + user; claude --print takes a single stdin blob.
    // Other providers may pass them as distinct API params.
    const fullPrompt = `${input.systemPrompt}\n\n${input.userPrompt}`;
    // Resolve the timeout once per generate() call so retries and any error
    // message report the same value that was actually passed to spawnSync.
    const timeoutMs = getTimeoutMs();
    let proc: SpawnSyncReturns<string> | undefined;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      proc = spawnClaude(fullPrompt, timeoutMs, input.model);
      if (!proc.error && proc.status === 0) return proc.stdout;
      // Retry ONLY on shim contention (ETIMEDOUT pre-launch). Wall-clock
      // SIGTERM, genuine spawn errors (ENOENT, EACCES), and non-zero exit
      // codes (Anthropic-side errors, auth failures) won't improve on a
      // second attempt — fail fast.
      if (!isShimTimeout(proc)) break;
      if (attempt < MAX_ATTEMPTS) {
        const jitter = Math.floor(Math.random() * 500);
        await new Promise(r => setTimeout(r, RETRY_BACKOFF_MS + jitter));
      }
    }

    if (proc?.error) {
      const baseMsg = `claude CLI not found or failed to start: ${proc.error.message}`;
      const guidance = isShimTimeout(proc)
        ? `\nThis was a subprocess timeout (likely concurrent cmd.exe shim contention on Windows).\n` +
          `If you're running anatomy generate in parallel, try one of:\n` +
          `  • lower the parallelism, or\n` +
          `  • switch to --provider anthropic-http (set ANTHROPIC_API_KEY).`
        : `\nIs Claude Code installed and available on PATH?`;
      throw new ProviderError("pass2-provider-not-available", baseMsg + guidance);
    }
    if (proc && isWallclockTimeout(proc)) {
      throw new ProviderError(
        "pass2-provider-network",
        `claude CLI exceeded ${timeoutMs}ms timeout; increase ANATOMY_CLAUDE_CLI_TIMEOUT_MS (current: ${timeoutMs}) ` +
          `or switch to --provider anthropic-http for unbounded responses`,
      );
    }
    if (proc && proc.status !== 0) {
      const promptSize = fullPrompt.length;
      const stderr = proc.stderr ?? "";
      throw new ProviderError(
        "pass2-provider-network",
        `claude CLI exited with status ${proc.status} (prompt was ${promptSize} chars).\n` +
        `stderr: ${stderr.trim() || "(empty)"}\n` +
        `\nCommon causes:\n` +
        `  - Prompt too large for the model's context window (anatomy retries with trimmed input by default; disable with --no-pass2-retry)\n` +
        `  - claude CLI auth lapsed (run \`claude\` once interactively to refresh)\n` +
        `  - Transient network or model error (try again in a moment)`,
      );
    }
    // Loop exited without success and without a populated proc — should be
    // unreachable given MAX_ATTEMPTS >= 1.
    throw new ProviderError("pass2-provider-not-available", "claude CLI: unexpected empty result");
  },
};
