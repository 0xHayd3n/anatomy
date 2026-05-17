import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyToAnatomy } from "../../src/verify-suggest/write.js";

function tempAnatomy(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "anat-writer-"));
  writeFileSync(join(dir, ".anatomy"), content, "utf8");
  return dir;
}

const BASE = [
  `anatomy_version = "0.12"`,
  `tagline = "test"`,
  ``,
  `[identity]`,
  `stack = "javascript"`,
  `form = "javascript-library"`,
  `domain = "test"`,
  `function = "test"`,
  `fingerprint = "abc"`,
  ``,
  `[[rules]]`,
  `rule = "must have pkg"`,
  `why = "discoverability"`,
  ``,
  `[[rules]]`,
  `rule = "decorate before listen"`,
  `why = "perf"`,
  ``,
  `[generated]`,
  `at = 2026-05-08T00:00:00.000Z`,
  `commit = "abc1234"`,
  `by = "@anatomy/cli@test"`,
  `model = "none"`,
  `schema = "https://anatomy.dev/spec/0.12/schema.json"`,
  ``,
].join("\n");

describe("applyToAnatomy", () => {
  it("inserts a verify clause into the matching rule block", async () => {
    const dir = tempAnatomy(BASE);
    await applyToAnatomy(dir, 1, { kind: "glob_exists", path: "package.json" });
    const text = readFileSync(join(dir, ".anatomy"), "utf8");
    expect(text).toMatch(/rule = "decorate before listen"\s*\nwhy = "perf"\s*\nverify = \{ kind = "glob_exists", path = "package.json" \}/);
    rmSync(dir, { recursive: true, force: true });
  });

  it("inserts a verify clause in the first rule when index=0", async () => {
    const dir = tempAnatomy(BASE);
    await applyToAnatomy(dir, 0, { kind: "glob_exists", path: "package.json" });
    const text = readFileSync(join(dir, ".anatomy"), "utf8");
    const lines = text.split("\n");
    const idx = lines.findIndex(l => l === `rule = "must have pkg"`);
    expect(lines[idx + 2]).toMatch(/verify = \{ kind = "glob_exists"/);
    rmSync(dir, { recursive: true, force: true });
  });

  it("copies the semgrep yaml into .semgrep/<hash>-<id>.yml when kind=semgrep with rule_file", async () => {
    const dir = tempAnatomy(BASE);
    const cachePath = mkdtempSync(join(tmpdir(), "anat-fake-reg-"));
    writeFileSync(join(cachePath, "no-secret.yaml"), "rules:\n  - id: no-secret\n    pattern: SECRET\n");
    await applyToAnatomy(dir, 0, { kind: "semgrep", rule_file: join(cachePath, "no-secret.yaml") });
    const semgrepFiles = readdirSync(join(dir, ".semgrep"));
    expect(semgrepFiles.length).toBe(1);
    expect(semgrepFiles[0]).toMatch(/^[0-9a-f]{8}-no-secret\.yaml$/);
    const text = readFileSync(join(dir, ".anatomy"), "utf8");
    expect(text).toMatch(/verify = \{ kind = "semgrep", rule_file = "\.semgrep\/[0-9a-f]+-no-secret\.yaml" \}/);
    rmSync(dir, { recursive: true, force: true });
    rmSync(cachePath, { recursive: true, force: true });
  });

  it("avoids basename collision by hashing the source path", async () => {
    const dir = tempAnatomy(BASE);
    const cache1 = mkdtempSync(join(tmpdir(), "anat-cache1-"));
    const cache2 = mkdtempSync(join(tmpdir(), "anat-cache2-"));
    writeFileSync(join(cache1, "shared.yaml"), "rules:\n  - id: rule-from-cache1\n    pattern: A\n");
    writeFileSync(join(cache2, "shared.yaml"), "rules:\n  - id: rule-from-cache2\n    pattern: B\n");
    await applyToAnatomy(dir, 0, { kind: "semgrep", rule_file: join(cache1, "shared.yaml") });
    await applyToAnatomy(dir, 1, { kind: "semgrep", rule_file: join(cache2, "shared.yaml") });
    const semgrepDir = join(dir, ".semgrep");
    const files = readdirSync(semgrepDir);
    expect(files.length).toBe(2);  // two distinct files, no overwrite
    rmSync(dir, { recursive: true, force: true });
    rmSync(cache1, { recursive: true, force: true });
    rmSync(cache2, { recursive: true, force: true });
  });

  it("throws when serializing inline semgrep without lang", async () => {
    const dir = tempAnatomy(BASE);
    await expect(
      applyToAnatomy(dir, 0, { kind: "semgrep", pattern: "foo", expect_in: "**/*.py" } as any)
    ).rejects.toThrow(/semgrep.*lang/);
    rmSync(dir, { recursive: true, force: true });
  });

  it("throws when the rule index is out of range", async () => {
    const dir = tempAnatomy(BASE);
    await expect(applyToAnatomy(dir, 5, { kind: "glob_exists", path: "x" })).rejects.toThrow(/could not locate rule 5/);
    rmSync(dir, { recursive: true, force: true });
  });
});
