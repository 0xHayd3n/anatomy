// Unit tests for the claude-cli provider's retry-on-timeout path. Uses
// vi.mock to replace node:child_process so we can drive spawnSync without
// actually launching subprocesses. Fake timers shortcut the retry backoff
// so the test suite stays fast.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(),
}));

// Imports below intentionally come AFTER vi.mock so the provider sees the
// mocked spawnSync.
import { spawnSync } from "node:child_process";
import { claudeCliProvider } from "../src/pass2/providers/claude-cli.js";
import { ProviderError } from "../src/pass2/providers/types.js";

const mockedSpawnSync = vi.mocked(spawnSync);

function timeoutResult() {
  return {
    error: Object.assign(new Error("spawnSync ETIMEDOUT"), { code: "ETIMEDOUT" }),
    signal: null,
    stdout: "",
    stderr: "",
    status: null,
    pid: -1,
    output: [null, "", ""],
  };
}

function sigtermResult() {
  // Post-launch wall-clock timeout: child killed with SIGTERM after TIMEOUT_MS.
  return {
    error: undefined,
    signal: "SIGTERM" as const,
    stdout: "",
    stderr: "",
    status: null,
    pid: 123,
    output: [null, "", ""],
  };
}

function successResult(stdout: string) {
  return {
    error: undefined,
    signal: null,
    stdout,
    stderr: "",
    status: 0,
    pid: 123,
    output: [null, stdout, ""],
  };
}

function authFailureResult() {
  return {
    error: undefined,
    signal: null,
    stdout: "",
    stderr: "auth failed: API key invalid",
    status: 1,
    pid: 123,
    output: [null, "", "auth failed: API key invalid"],
  };
}

describe("claude-cli provider — retry behavior", () => {
  beforeEach(() => {
    mockedSpawnSync.mockReset();
    vi.useFakeTimers();
    // Ensure no leakage from a developer's local shell — every test owns its
    // env-var state.
    delete process.env.ANATOMY_CLAUDE_CLI_TIMEOUT_MS;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.ANATOMY_CLAUDE_CLI_TIMEOUT_MS;
  });

  it("retries on ETIMEDOUT and returns success on second attempt", async () => {
    mockedSpawnSync
      .mockReturnValueOnce(timeoutResult() as ReturnType<typeof spawnSync>)
      .mockReturnValueOnce(successResult('{"identity_domain":"x"}') as ReturnType<typeof spawnSync>);

    const promise = claudeCliProvider.generate({ systemPrompt: "s", userPrompt: "u" });
    // Advance through the retry backoff.
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe('{"identity_domain":"x"}');
    expect(mockedSpawnSync).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry on SIGTERM (wall-clock timeout — same prompt against same model can't recover)", async () => {
    mockedSpawnSync.mockReturnValue(sigtermResult() as ReturnType<typeof spawnSync>);

    let caught: unknown;
    const settled = claudeCliProvider
      .generate({ systemPrompt: "s", userPrompt: "u" })
      .catch(e => { caught = e; });
    await vi.runAllTimersAsync();
    await settled;

    expect(caught).toBeInstanceOf(ProviderError);
    expect((caught as Error).message).toMatch(/exceeded \d+ms timeout/);
    expect((caught as Error).message).toMatch(/ANATOMY_CLAUDE_CLI_TIMEOUT_MS/);
    expect(mockedSpawnSync).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry on non-timeout failures (status != 0 surfaces as ProviderError after one call)", async () => {
    mockedSpawnSync.mockReturnValue(authFailureResult() as ReturnType<typeof spawnSync>);

    await expect(
      claudeCliProvider.generate({ systemPrompt: "s", userPrompt: "u" }),
    ).rejects.toThrowError(ProviderError);
    expect(mockedSpawnSync).toHaveBeenCalledTimes(1);
  });

  it("surfaces a ProviderError with Windows-concurrency guidance after both attempts time out", async () => {
    mockedSpawnSync.mockReturnValue(timeoutResult() as ReturnType<typeof spawnSync>);

    // Attach the rejection handler synchronously, BEFORE advancing the fake
    // timers. Otherwise the inner promise can settle to "rejected" while no
    // handler is attached, which trips vitest's unhandled-rejection detector
    // even though we go on to await it.
    let caught: unknown;
    const settled = claudeCliProvider
      .generate({ systemPrompt: "s", userPrompt: "u" })
      .catch(e => { caught = e; });
    await vi.runAllTimersAsync();
    await settled;

    expect(caught).toBeInstanceOf(ProviderError);
    expect((caught as Error).message).toMatch(/anthropic-http|parallelism|cmd\.exe/i);
    expect(mockedSpawnSync).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry on missing claude binary (ENOENT)", async () => {
    const enoent = {
      error: Object.assign(new Error("spawnSync ENOENT"), { code: "ENOENT" }),
      signal: null,
      stdout: "",
      stderr: "",
      status: null,
      pid: -1,
      output: [null, "", ""],
    };
    mockedSpawnSync.mockReturnValue(enoent as ReturnType<typeof spawnSync>);

    await expect(
      claudeCliProvider.generate({ systemPrompt: "s", userPrompt: "u" }),
    ).rejects.toThrowError(ProviderError);
    expect(mockedSpawnSync).toHaveBeenCalledTimes(1);
  });

  it("honors ANATOMY_CLAUDE_CLI_TIMEOUT_MS env var (passed to spawnSync timeout option)", async () => {
    process.env.ANATOMY_CLAUDE_CLI_TIMEOUT_MS = "60000";
    mockedSpawnSync.mockReturnValueOnce(successResult('{"x":1}') as ReturnType<typeof spawnSync>);

    await claudeCliProvider.generate({ systemPrompt: "s", userPrompt: "u" });

    expect(mockedSpawnSync).toHaveBeenCalledWith(
      "claude",
      ["--print"],
      expect.objectContaining({ timeout: 60000 }),
    );
  });

  it("uses 300_000ms default timeout when env var is unset", async () => {
    mockedSpawnSync.mockReturnValueOnce(successResult('{"x":1}') as ReturnType<typeof spawnSync>);

    await claudeCliProvider.generate({ systemPrompt: "s", userPrompt: "u" });

    expect(mockedSpawnSync).toHaveBeenCalledWith(
      "claude",
      ["--print"],
      expect.objectContaining({ timeout: 300_000 }),
    );
  });

  it("ignores non-numeric env var values and falls back to default", async () => {
    process.env.ANATOMY_CLAUDE_CLI_TIMEOUT_MS = "not-a-number";
    mockedSpawnSync.mockReturnValueOnce(successResult('{"x":1}') as ReturnType<typeof spawnSync>);

    await claudeCliProvider.generate({ systemPrompt: "s", userPrompt: "u" });

    expect(mockedSpawnSync).toHaveBeenCalledWith(
      "claude",
      ["--print"],
      expect.objectContaining({ timeout: 300_000 }),
    );
  });

  it("rejects '0' (would be treated as immediate kill by spawnSync) and falls back to default", async () => {
    process.env.ANATOMY_CLAUDE_CLI_TIMEOUT_MS = "0";
    mockedSpawnSync.mockReturnValueOnce(successResult('{"x":1}') as ReturnType<typeof spawnSync>);

    await claudeCliProvider.generate({ systemPrompt: "s", userPrompt: "u" });

    expect(mockedSpawnSync).toHaveBeenCalledWith(
      "claude",
      ["--print"],
      expect.objectContaining({ timeout: 300_000 }),
    );
  });
});
