import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordTelemetry, getTelemetryFile } from "../src/telemetry.js";

let telemetryDir: string;
const ORIGINAL_DIR = process.env.ANATOMY_TELEMETRY_DIR;
const ORIGINAL_DISABLE = process.env.ANATOMY_TELEMETRY_DISABLE;

beforeEach(() => {
  telemetryDir = mkdtempSync(join(tmpdir(), "anat-tel-"));
  process.env.ANATOMY_TELEMETRY_DIR = telemetryDir;
  delete process.env.ANATOMY_TELEMETRY_DISABLE;
});

afterEach(() => {
  process.env.ANATOMY_TELEMETRY_DIR = ORIGINAL_DIR;
  if (ORIGINAL_DISABLE === undefined) delete process.env.ANATOMY_TELEMETRY_DISABLE;
  else process.env.ANATOMY_TELEMETRY_DISABLE = ORIGINAL_DISABLE;
  try { rmSync(telemetryDir, { recursive: true, force: true }); } catch {}
});

describe("recordTelemetry", () => {
  it("appends a hook_fire record as JSONL", () => {
    recordTelemetry({
      kind: "hook_fire",
      ts: "2026-05-08T00:00:00.000Z",
      repo_fingerprint: "abc",
      cwd: "/x",
      sections: ["rules"],
      tokens_estimated: 100,
      truncated: false,
      stale: false,
    });
    const content = readFileSync(getTelemetryFile(), "utf8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({
      kind: "hook_fire",
      repo_fingerprint: "abc",
    });
  });

  it("appends multiple records on separate lines", () => {
    recordTelemetry({ kind: "hook_fire", ts: "t1", repo_fingerprint: "a", cwd: "/x", sections: [], tokens_estimated: 0, truncated: false, stale: false });
    recordTelemetry({ kind: "mcp_call", ts: "t2", tool: "anatomy_overview", args: {}, repo_fingerprint: "a", error: null, latency_ms: 5 });
    const lines = readFileSync(getTelemetryFile(), "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
  });

  it("creates the telemetry dir if missing", () => {
    rmSync(telemetryDir, { recursive: true, force: true });
    recordTelemetry({ kind: "hook_fire", ts: "t", repo_fingerprint: "a", cwd: "/x", sections: [], tokens_estimated: 0, truncated: false, stale: false });
    expect(existsSync(getTelemetryFile())).toBe(true);
  });

  it("creates a .gitignore on first write", () => {
    recordTelemetry({ kind: "hook_fire", ts: "t", repo_fingerprint: "a", cwd: "/x", sections: [], tokens_estimated: 0, truncated: false, stale: false });
    const gi = join(telemetryDir, ".gitignore");
    expect(existsSync(gi)).toBe(true);
    expect(readFileSync(gi, "utf8")).toBe("*\n");
  });

  it("does not throw on write failure (read-only dir simulation)", () => {
    process.env.ANATOMY_TELEMETRY_DIR = "/dev/null/cannot-create";
    expect(() => recordTelemetry({
      kind: "hook_fire", ts: "t", repo_fingerprint: "a", cwd: "/x",
      sections: [], tokens_estimated: 0, truncated: false, stale: false,
    })).not.toThrow();
  });

  it("skips writing when ANATOMY_TELEMETRY_DISABLE is set to '1'", () => {
    process.env.ANATOMY_TELEMETRY_DISABLE = "1";
    recordTelemetry({
      kind: "hook_fire", ts: "t", repo_fingerprint: "a", cwd: "/x",
      sections: [], tokens_estimated: 0, truncated: false, stale: false,
    });
    expect(existsSync(getTelemetryFile())).toBe(false);
  });

  it("treats any truthy ANATOMY_TELEMETRY_DISABLE value as disable", () => {
    for (const v of ["true", "yes", "anything"]) {
      process.env.ANATOMY_TELEMETRY_DISABLE = v;
      recordTelemetry({
        kind: "hook_fire", ts: "t", repo_fingerprint: "a", cwd: "/x",
        sections: [], tokens_estimated: 0, truncated: false, stale: false,
      });
    }
    expect(existsSync(getTelemetryFile())).toBe(false);
  });

  it("still writes when ANATOMY_TELEMETRY_DISABLE is empty, '0', or 'false'", () => {
    process.env.ANATOMY_TELEMETRY_DISABLE = "";
    recordTelemetry({
      kind: "hook_fire", ts: "t1", repo_fingerprint: "a", cwd: "/x",
      sections: [], tokens_estimated: 0, truncated: false, stale: false,
    });
    process.env.ANATOMY_TELEMETRY_DISABLE = "0";
    recordTelemetry({
      kind: "hook_fire", ts: "t2", repo_fingerprint: "a", cwd: "/x",
      sections: [], tokens_estimated: 0, truncated: false, stale: false,
    });
    process.env.ANATOMY_TELEMETRY_DISABLE = "false";
    recordTelemetry({
      kind: "hook_fire", ts: "t3", repo_fingerprint: "a", cwd: "/x",
      sections: [], tokens_estimated: 0, truncated: false, stale: false,
    });
    process.env.ANATOMY_TELEMETRY_DISABLE = "False";
    recordTelemetry({
      kind: "hook_fire", ts: "t4", repo_fingerprint: "a", cwd: "/x",
      sections: [], tokens_estimated: 0, truncated: false, stale: false,
    });
    const lines = readFileSync(getTelemetryFile(), "utf8").trim().split("\n");
    expect(lines).toHaveLength(4);
  });
});

describe("recordTelemetry — ANATOMY_TELEMETRY_TAG", () => {
  const ORIGINAL_TAG = process.env.ANATOMY_TELEMETRY_TAG;

  afterEach(() => {
    if (ORIGINAL_TAG === undefined) delete process.env.ANATOMY_TELEMETRY_TAG;
    else process.env.ANATOMY_TELEMETRY_TAG = ORIGINAL_TAG;
  });

  it("adds a `tag` field to each record when set", () => {
    process.env.ANATOMY_TELEMETRY_TAG = "eval-treatment";
    recordTelemetry({
      kind: "hook_fire", ts: "t1", repo_fingerprint: "a", cwd: "/x",
      sections: [], tokens_estimated: 0, truncated: false, stale: false,
    });
    const parsed = JSON.parse(readFileSync(getTelemetryFile(), "utf8").trim());
    expect(parsed.tag).toBe("eval-treatment");
  });

  it("omits the `tag` field when unset", () => {
    delete process.env.ANATOMY_TELEMETRY_TAG;
    recordTelemetry({
      kind: "hook_fire", ts: "t1", repo_fingerprint: "a", cwd: "/x",
      sections: [], tokens_estimated: 0, truncated: false, stale: false,
    });
    const parsed = JSON.parse(readFileSync(getTelemetryFile(), "utf8").trim());
    expect(parsed.tag).toBeUndefined();
  });

  it("omits the `tag` field when empty-string", () => {
    process.env.ANATOMY_TELEMETRY_TAG = "";
    recordTelemetry({
      kind: "hook_fire", ts: "t1", repo_fingerprint: "a", cwd: "/x",
      sections: [], tokens_estimated: 0, truncated: false, stale: false,
    });
    const parsed = JSON.parse(readFileSync(getTelemetryFile(), "utf8").trim());
    expect(parsed.tag).toBeUndefined();
  });
});
