import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { deriveCommit } from "../src/pass1/generated.js";

describe("deriveCommit", () => {
  it("returns a 7-12 char lowercase hex string for this repo (has commits)", () => {
    // anatomy-cli lives inside a git repo — use the repo root (two levels up from anatomy-cli/)
    const repoRoot = join(import.meta.dirname, "../../");
    const commit = deriveCommit(repoRoot);
    expect(commit).toBeDefined();
    expect(commit).toMatch(/^[0-9a-f]{7,12}$/);
  });

  it("returns undefined for a directory that is not a git repo", () => {
    const dir = mkdtempSync(join(tmpdir(), "anat-ng-"));
    expect(deriveCommit(dir)).toBeUndefined();
  });

  it("returns undefined for a git repo with no commits yet", () => {
    const dir = mkdtempSync(join(tmpdir(), "anat-nc-"));
    execSync("git init", { cwd: dir, stdio: "ignore" });
    expect(deriveCommit(dir)).toBeUndefined();
  });
});
