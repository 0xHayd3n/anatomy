// src/pass2/providers/claude-cli.ts
// Default Pass 2 provider — wraps the local `claude` CLI. Identical behavior
// to v0.10.0's inline spawnSync logic in pass2/index.ts; the refactor moves
// it behind the Pass2Provider interface so additional providers can register
// later without touching the orchestrator.

import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { ProviderError, type Pass2Provider } from "./types.js";

const CLAUDE_BIN = "claude";
const TIMEOUT_MS = 120_000;
const MAX_BUFFER = 10 * 1024 * 1024;
// Retry on Windows cmd.exe shim contention (50-repo run: 10/50 hit ETIMEDOUT
// at concurrency=8). Sequential retry recovered all 10. Two attempts caps
// worst-case wait at ~3 min for the timeout-cascade case while leaving the
// happy path unchanged.
const MAX_ATTEMPTS = 2;
const RETRY_BACKOFF_MS = 1_500;

// Spawn-side timeout (Windows: ETIMEDOUT on cmd.exe shim launch under
// concurrency contention) AND post-launch wall-clock timeout (child killed
// with SIGTERM after TIMEOUT_MS) both indicate "claude CLI didn't finish in
// time" and are both retry candidates.
function isLikelyTimeout(proc: SpawnSyncReturns<string>): boolean {
  const errCode = (proc.error as NodeJS.ErrnoException | undefined)?.code;
  return errCode === "ETIMEDOUT" || proc.signal === "SIGTERM";
}

function spawnClaude(fullPrompt: string): SpawnSyncReturns<string> {
  return spawnSync(CLAUDE_BIN, ["--print"], {
    input: fullPrompt,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
    timeout: TIMEOUT_MS,
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
    let proc: SpawnSyncReturns<string> | undefined;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      proc = spawnClaude(fullPrompt);
      if (!proc.error && proc.status === 0) return proc.stdout;
      // Retry on timeout-class failures only. Genuine spawn errors (ENOENT
      // for missing claude CLI, EACCES for permission denied) and non-zero
      // exit codes (Anthropic-side errors, auth failures) are not retried —
      // they will not improve on a second attempt.
      if (!isLikelyTimeout(proc)) break;
      if (attempt < MAX_ATTEMPTS) {
        const jitter = Math.floor(Math.random() * 500);
        await new Promise(r => setTimeout(r, RETRY_BACKOFF_MS + jitter));
      }
    }

    if (proc?.error) {
      const baseMsg = `claude CLI not found or failed to start: ${proc.error.message}`;
      const guidance = isLikelyTimeout(proc)
        ? `\nThis was a subprocess timeout (likely concurrent cmd.exe shim contention on Windows).\n` +
          `If you're running anatomy generate in parallel, try one of:\n` +
          `  • lower the parallelism, or\n` +
          `  • switch to --provider anthropic-http (set ANTHROPIC_API_KEY).`
        : `\nIs Claude Code installed and available on PATH?`;
      throw new ProviderError("pass2-provider-not-available", baseMsg + guidance);
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
