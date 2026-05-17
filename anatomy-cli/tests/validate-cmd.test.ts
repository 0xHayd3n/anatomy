import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const BIN = resolve(import.meta.dirname, "../dist/bin.js");

function run(args: string[], cwd: string): { stdout: string; stderr: string; code: number } {
  const result = spawnSync("node", [BIN, ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    code: result.status ?? 1,
  };
}

describe("validate command", () => {
  it("exits 0 (warn) when file does not exist without --require", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-v-"));
    const r = run(["validate", "./nonexistent"], root);
    expect(r.code).toBe(0);
    expect(r.stderr).toMatch(/warning|not found/i);
  });

  it("exits 1 when file does not exist with --require", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-v-"));
    const r = run(["validate", "--require", "./nonexistent"], root);
    expect(r.code).toBe(1);
  });

  it("exits 0 when validating a valid v0.1 fixture", () => {
    const fixture = resolve(import.meta.dirname, "../../fixtures/valid/01-minimal-rust-cli/input.anatomy");
    const r = run(["validate", fixture], process.cwd());
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("✓");
  });

  it("--json emits structured JSON to stdout", () => {
    const fixture = resolve(import.meta.dirname, "../../fixtures/valid/01-minimal-rust-cli/input.anatomy");
    const r = run(["validate", "--json", fixture], process.cwd());
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.found).toBe(true);
    expect(Array.isArray(parsed.errors)).toBe(true);
    expect(Array.isArray(parsed.warnings)).toBe(true);
  });

  it("--json emits JSON with ok:false on missing file (no --require)", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-v-"));
    const r = run(["validate", "--json", "./nonexistent"], root);
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.found).toBe(false);
  });

  it("--version prints version info", () => {
    const r = run(["--version"], process.cwd());
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/@anatomytool\/cli@\d+\.\d+\.\d+/);
  });

  it("--help prints usage", () => {
    const r = run(["--help"], process.cwd());
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Usage:");
  });
});

describe("validate with memory", () => {
  it("validates a paired .anatomy + .anatomy-memory when fingerprints match", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-v-mem-"));
    writeFileSync(join(root, ".anatomy"), `anatomy_version = "0.7"
tagline = "test"
[identity]
stack = "typescript"
form = "library"
domain = "test"
function = "test"
fingerprint = "9g0vkf4wtrhz48qa16wa"
[generated]
at = 2026-05-08T00:00:00Z
by = "test"
model = "none"
schema = "https://anatomy.dev/spec/0.7/schema.json"
`);
    writeFileSync(join(root, ".anatomy-memory"), `anatomy_memory_version = "0.1"
repo_fingerprint = "9g0vkf4wtrhz48qa16wa"
`);
    const r = run(["validate", join(root, ".anatomy")], process.cwd());
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("✓");
  });

  it("flags fingerprint mismatch between .anatomy and .anatomy-memory", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-v-mem-"));
    writeFileSync(join(root, ".anatomy"), `anatomy_version = "0.7"
tagline = "test"
[identity]
stack = "typescript"
form = "library"
domain = "test"
function = "test"
fingerprint = "9g0vkf4wtrhz48qa16wa"
[generated]
at = 2026-05-08T00:00:00Z
by = "test"
model = "none"
schema = "https://anatomy.dev/spec/0.7/schema.json"
`);
    writeFileSync(join(root, ".anatomy-memory"), `anatomy_memory_version = "0.1"
repo_fingerprint = "00000000000000000000"
`);
    const r = run(["validate", join(root, ".anatomy")], process.cwd());
    expect(r.code).toBe(1);
    expect(r.stdout + r.stderr).toContain("memory-fingerprint-mismatch");
  });

  it("--json includes memory errors in the structured output", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-v-mem-"));
    writeFileSync(join(root, ".anatomy"), `anatomy_version = "0.7"
tagline = "test"
[identity]
stack = "typescript"
form = "library"
domain = "test"
function = "test"
fingerprint = "9g0vkf4wtrhz48qa16wa"
[generated]
at = 2026-05-08T00:00:00Z
by = "test"
model = "none"
schema = "https://anatomy.dev/spec/0.7/schema.json"
`);
    writeFileSync(join(root, ".anatomy-memory"), `anatomy_memory_version = "0.1"
repo_fingerprint = "00000000000000000000"
`);
    const r = run(["validate", "--json", join(root, ".anatomy")], process.cwd());
    expect(r.code).toBe(1);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.ok).toBe(false);
    const codes = parsed.errors.map((e: any) => e.code);
    expect(codes).toContain("memory-fingerprint-mismatch");
  });

  it("accepts memory entries with helped_count + helped_by populated", () => {
    // Regression test: caught a real bug where the CLI's vendored copy of
    // @anatomytool/validate had a stale schema after the helped_count/helped_by
    // fields were added. A pure-CLI test that round-trips `add` → `thanks` →
    // `validate` exercises the full schema path.
    const root = mkdtempSync(join(tmpdir(), "anat-v-thanks-"));
    writeFileSync(join(root, ".anatomy"), `anatomy_version = "0.7"
tagline = "test"
[identity]
stack = "typescript"
form = "library"
domain = "test"
function = "test"
fingerprint = "9g0vkf4wtrhz48qa16wa"
[generated]
at = 2026-05-08T00:00:00Z
by = "test"
model = "none"
schema = "https://anatomy.dev/spec/0.7/schema.json"
`);
    const addEnv = { ...process.env, ANATOMY_BY: "human:alice" };
    const addR = spawnSync("node", [BIN, "add", "gotcha", "topic-a", "content of entry"], {
      cwd: root, encoding: "utf8", env: addEnv,
    });
    expect(addR.status).toBe(0);
    const id = (addR.stdout ?? "").match(/entry ([a-z0-9]{8}) /)![1];

    const thanksEnv = { ...process.env, ANATOMY_BY: "human:bob" };
    const thanksR = spawnSync("node", [BIN, "memory", "thanks", id], {
      cwd: root, encoding: "utf8", env: thanksEnv,
    });
    expect(thanksR.status).toBe(0);

    const validateR = run(["validate", join(root, ".anatomy")], process.cwd());
    expect(validateR.code).toBe(0);
    expect(validateR.stdout + validateR.stderr).not.toMatch(/additional propert/i);
    expect(validateR.stdout + validateR.stderr).not.toMatch(/schema-violation/);
  });
});
