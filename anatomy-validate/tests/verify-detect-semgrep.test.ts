import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(),
}));

import { spawnSync } from "node:child_process";
import { getSemgrep, _resetSemgrepCache } from "../src/checks/verify/detect-semgrep.js";

const mockSpawn = vi.mocked(spawnSync);

const okResult = (stdout = "1.45.0\n") => ({
  status: 0,
  stdout: Buffer.from(stdout),
  stderr: Buffer.from(""),
  pid: 0,
  output: [] as Buffer[],
  signal: null,
});

describe("getSemgrep", () => {
  beforeEach(() => {
    _resetSemgrepCache();
    mockSpawn.mockReset();
  });

  it("returns available=true with version when semgrep --version succeeds", () => {
    mockSpawn.mockReturnValue(okResult() as any);

    const result = getSemgrep();
    expect(result.available).toBe(true);
    expect(result.version).toBe("1.45.0");
  });

  it("returns available=false when semgrep is missing (ENOENT)", () => {
    mockSpawn.mockReturnValue({
      status: null,
      stdout: Buffer.from(""),
      stderr: Buffer.from(""),
      pid: 0,
      output: [],
      signal: null,
      error: Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
    } as any);

    const result = getSemgrep();
    expect(result.available).toBe(false);
    expect(result.version).toBeUndefined();
  });

  it("returns available=false when semgrep exits non-zero", () => {
    mockSpawn.mockReturnValue({
      status: 1,
      stdout: Buffer.from(""),
      stderr: Buffer.from("boom"),
      pid: 0,
      output: [],
      signal: null,
    } as any);

    expect(getSemgrep().available).toBe(false);
  });

  it("caches the result across calls", () => {
    mockSpawn.mockReturnValue(okResult() as any);

    getSemgrep();
    getSemgrep();
    getSemgrep();
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  it("invokes semgrep with shell:true (Windows .cmd-shim support)", () => {
    mockSpawn.mockReturnValue(okResult("1.0.0") as any);

    getSemgrep();

    expect(mockSpawn).toHaveBeenCalledWith(
      "semgrep",
      ["--version"],
      expect.objectContaining({ shell: true }),
    );
  });
});
