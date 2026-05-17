import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { resolveAnatomy } from "../src/resolve.js";
import { buildAnatomyToml } from "./_helpers/fixture.js";

function setupRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "anat-resolve-"));
  execSync("git init", { cwd: dir, stdio: "ignore", shell: true });
  execSync('git config user.email "t@t.com"', { cwd: dir, stdio: "ignore", shell: true });
  execSync('git config user.name "T"', { cwd: dir, stdio: "ignore", shell: true });
  return dir;
}

describe("resolveAnatomy", () => {
  it("returns anatomy_not_found when no .anatomy exists", async () => {
    const dir = setupRepo();
    const result = await resolveAnatomy(dir);
    expect(result).toMatchObject({ error: "anatomy_not_found" });
  });

  it("resolves a root .anatomy when one exists", async () => {
    const dir = setupRepo();
    writeFileSync(join(dir, ".anatomy"), buildAnatomyToml());
    const result = await resolveAnatomy(dir);
    if ("error" in result) throw new Error("expected success");
    expect(result.doc.tagline).toBe("test fixture");
    expect(result.anatomy_path).toBe(join(dir, ".anatomy"));
    expect(result.anatomy_dir).toBe(dir);
  });

  it("resolves the nearest sub-anatomy when working in a subdir", async () => {
    const dir = setupRepo();
    writeFileSync(join(dir, ".anatomy"), buildAnatomyToml());
    mkdirSync(join(dir, "sub"));
    // Different pillars → different fingerprint, no duplicate-fingerprint warning.
    writeFileSync(join(dir, "sub", ".anatomy"), buildAnatomyToml({
      tagline: "sub fixture", domain: "test-sub", function: "test-sub",
    }));
    const result = await resolveAnatomy(join(dir, "sub"));
    if ("error" in result) throw new Error("expected success");
    expect(result.doc.tagline).toBe("sub fixture");
    expect(result.anatomy_dir).toBe(join(dir, "sub"));
  });

  it("returns validation_failed for a malformed .anatomy", async () => {
    const dir = setupRepo();
    writeFileSync(join(dir, ".anatomy"), 'anatomy_version = "0.7"\n# missing required fields\n');
    const result = await resolveAnatomy(dir);
    expect(result).toMatchObject({ error: "validation_failed" });
  });

  it("reports staleness when generated.commit doesn't match HEAD", async () => {
    const dir = setupRepo();
    writeFileSync(join(dir, ".anatomy"), buildAnatomyToml({ commit: "deadbee" }));
    execSync("git add .", { cwd: dir, stdio: "ignore", shell: true });
    execSync('git commit -m "init"', { cwd: dir, stdio: "ignore", shell: true });
    const result = await resolveAnatomy(dir);
    if ("error" in result) throw new Error("expected success");
    expect(result.staleness).toMatchObject({ file_commit: "deadbee" });
    expect(result.staleness?.head_commit).toMatch(/^[0-9a-f]{7,12}$/);
    // `deadbee` is not a real ancestor → git diff fails → significance is "unknown".
    expect(result.staleness?.significance).toBe("unknown");
  });

  it("classifies markdown-only divergence as cosmetic staleness", async () => {
    const dir = setupRepo();
    writeFileSync(join(dir, "placeholder.txt"), "x");
    execSync("git add .", { cwd: dir, stdio: "ignore", shell: true });
    execSync('git commit -m "c1"', { cwd: dir, stdio: "ignore", shell: true });
    const c1 = execSync("git rev-parse --short HEAD", { cwd: dir, encoding: "utf8", shell: true }).trim();
    writeFileSync(join(dir, ".anatomy"), buildAnatomyToml({ commit: c1 }));
    execSync("git add .", { cwd: dir, stdio: "ignore", shell: true });
    execSync('git commit -m "c2 add anatomy"', { cwd: dir, stdio: "ignore", shell: true });
    writeFileSync(join(dir, "README.md"), "hello\n");
    execSync("git add .", { cwd: dir, stdio: "ignore", shell: true });
    execSync('git commit -m "c3 add readme"', { cwd: dir, stdio: "ignore", shell: true });

    const result = await resolveAnatomy(dir);
    if ("error" in result) throw new Error("expected success");
    expect(result.staleness).not.toBeNull();
    expect(result.staleness?.significance).toBe("cosmetic");
  });

  it("reports null staleness when generated.commit matches HEAD", async () => {
    const dir = setupRepo();
    writeFileSync(join(dir, "placeholder"), "x");
    execSync("git add .", { cwd: dir, stdio: "ignore", shell: true });
    execSync('git commit -m "init"', { cwd: dir, stdio: "ignore", shell: true });
    const head = execSync("git rev-parse --short HEAD", { cwd: dir, encoding: "utf8", shell: true }).trim();
    writeFileSync(join(dir, ".anatomy"), buildAnatomyToml({ commit: head }));
    const result = await resolveAnatomy(dir);
    if ("error" in result) throw new Error("expected success");
    expect(result.staleness).toBeNull();
  });

  it("reports null staleness when no commit field is present", async () => {
    const dir = setupRepo();
    writeFileSync(join(dir, ".anatomy"), buildAnatomyToml());
    const result = await resolveAnatomy(dir);
    if ("error" in result) throw new Error("expected success");
    expect(result.staleness).toBeNull();
  });

  it("reports null staleness when stored commit is a longer prefix of HEAD's short form", async () => {
    // git rev-parse --short HEAD length depends on core.abbrev (default 7,
    // configurable). A file generated on a machine with abbrev=12 and
    // validated on one with abbrev=7 (or vice versa) is the same commit and
    // must NOT report stale. The check uses prefix match in either direction.
    const dir = setupRepo();
    writeFileSync(join(dir, "placeholder"), "x");
    execSync("git add .", { cwd: dir, stdio: "ignore", shell: true });
    execSync('git commit -m "init"', { cwd: dir, stdio: "ignore", shell: true });
    const fullHead = execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf8", shell: true }).trim();
    // Store a 12-char prefix (longer than the default 7-char short form).
    writeFileSync(join(dir, ".anatomy"), buildAnatomyToml({ commit: fullHead.slice(0, 12) }));
    const result = await resolveAnatomy(dir);
    if ("error" in result) throw new Error("expected success");
    expect(result.staleness).toBeNull();
  });

  it("attaches empty rules array when staleness significance is cosmetic", async () => {
    const dir = setupRepo();
    writeFileSync(join(dir, "placeholder.txt"), "x");
    execSync("git add .", { cwd: dir, stdio: "ignore", shell: true });
    execSync('git commit -m "c1"', { cwd: dir, stdio: "ignore", shell: true });
    const c1 = execSync("git rev-parse --short HEAD", { cwd: dir, encoding: "utf8", shell: true }).trim();
    writeFileSync(join(dir, ".anatomy"), buildAnatomyToml({ commit: c1 }));
    execSync("git add .", { cwd: dir, stdio: "ignore", shell: true });
    execSync('git commit -m "c2"', { cwd: dir, stdio: "ignore", shell: true });
    writeFileSync(join(dir, "README.md"), "doc-only change\n");
    execSync("git add .", { cwd: dir, stdio: "ignore", shell: true });
    execSync('git commit -m "c3 doc"', { cwd: dir, stdio: "ignore", shell: true });
    const result = await resolveAnatomy(dir);
    if ("error" in result) throw new Error("expected success");
    expect(result.staleness?.significance).toBe("cosmetic");
    expect(result.staleness?.rules).toEqual([]);
  });

  it("attaches populated rules array when significance is unknown and rules have verify clauses", async () => {
    const dir = setupRepo();
    writeFileSync(join(dir, "package.json"), "{}");
    execSync("git add .", { cwd: dir, stdio: "ignore", shell: true });
    execSync('git commit -m "c1"', { cwd: dir, stdio: "ignore", shell: true });
    const c1 = execSync("git rev-parse --short HEAD", { cwd: dir, encoding: "utf8", shell: true }).trim();
    // Hand-write a v0.12 anatomy with rules that have verify clauses.
    const { fingerprintFromPillars } = await import("@anatomy/validate");
    const fp = fingerprintFromPillars("javascript", "javascript-library", "test", "test");
    const anatomyText = [
      `anatomy_version = "0.12"`,
      `tagline = "test"`,
      ``,
      `[identity]`,
      `stack = "javascript"`,
      `form = "javascript-library"`,
      `domain = "test"`,
      `function = "test"`,
      `fingerprint = "${fp}"`,
      ``,
      `[[rules]]`,
      `rule = "must have a package.json"`,
      `verify = { kind = "glob_exists", path = "package.json" }`,
      ``,
      `[[rules]]`,
      `rule = "must have a README"`,
      `verify = { kind = "glob_exists", path = "README.md" }`,
      ``,
      `[generated]`,
      `at = 2026-05-08T00:00:00.000Z`,
      `commit = "${c1}"`,
      `by = "@anatomy/cli@test"`,
      `model = "none"`,
      `schema = "https://anatomy.dev/spec/0.12/schema.json"`,
      ``,
    ].join("\n");
    writeFileSync(join(dir, ".anatomy"), anatomyText);
    execSync("git add .", { cwd: dir, stdio: "ignore", shell: true });
    execSync('git commit -m "c2 add anatomy"', { cwd: dir, stdio: "ignore", shell: true });
    // Touch a source file (non-allowlisted) → significance=unknown.
    writeFileSync(join(dir, "main.js"), "console.log(1)\n");
    execSync("git add .", { cwd: dir, stdio: "ignore", shell: true });
    execSync('git commit -m "c3 source"', { cwd: dir, stdio: "ignore", shell: true });
    const result = await resolveAnatomy(dir);
    if ("error" in result) throw new Error("expected success");
    expect(result.staleness?.significance).toBe("unknown");
    expect(result.staleness?.rules).toEqual([
      { index: 0, status: "passing" },
      { index: 1, status: "failing" },
    ]);
  });
});
