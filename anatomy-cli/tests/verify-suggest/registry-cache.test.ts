import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, existsSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as cache from "../../src/verify-suggest/registry/cache.js";

const TMP_ANAT = mkdtempSync(join(tmpdir(), "anat-fake-home-"));

afterEach(() => {
  vi.restoreAllMocks();
  // Each test gets a fresh fake-home subdir
});

describe("registry cache — ensureCloned", () => {
  it("returns the existing cache path when already cloned", async () => {
    const dir = mkdtempSync(join(tmpdir(), "anat-cache-existing-"));
    mkdirSync(join(dir, ".git"), { recursive: true });
    writeFileSync(join(dir, "README.md"), "fake clone");
    const path = await cache.ensureCloned(dir, { skipClone: true });
    expect(path).toBe(dir);
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns null when git is not on PATH (fake-error mode)", async () => {
    const dir = join(TMP_ANAT, "no-git-test");
    const path = await cache.ensureCloned(dir, { forceGitMissing: true });
    expect(path).toBeNull();
  });
});

describe("registry cache — refreshIfRequested", () => {
  it("removes the cached dir when refresh=true", async () => {
    const dir = mkdtempSync(join(tmpdir(), "anat-cache-refresh-"));
    writeFileSync(join(dir, "marker"), "x");
    expect(existsSync(join(dir, "marker"))).toBe(true);
    await cache.refreshIfRequested(dir, true);
    expect(existsSync(dir)).toBe(false);
  });

  it("leaves the cached dir alone when refresh=false", async () => {
    const dir = mkdtempSync(join(tmpdir(), "anat-cache-norefresh-"));
    writeFileSync(join(dir, "marker"), "x");
    await cache.refreshIfRequested(dir, false);
    expect(existsSync(join(dir, "marker"))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});
