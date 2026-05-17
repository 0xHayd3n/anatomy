import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const BIN = resolve(import.meta.dirname, "../dist/bin.js");

function run(args: string[], cwd: string): { stdout: string; stderr: string; code: number } {
  const result = spawnSync("node", [BIN, ...args], {
    cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: true,
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    code: result.status ?? 1,
  };
}

function mkRepoWithDriftedAnatomy(): string {
  const root = mkdtempSync(join(tmpdir(), "anat-strict-"));
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "index.ts"), "// no react reference");
  writeFileSync(join(root, "package.json"), `{ "name": "x" }`);
  writeFileSync(join(root, ".anatomy"), `anatomy_version = "0.8"
tagline = "drifted"

[identity]
stack = "typescript"
form = "typescript-library"
domain = "test"
function = "test"
fingerprint = "m74ew5qbnn3agrhdxpzp"

[[structure.entries]]
path = "src"
kind = "source"
purpose = "x"

[[substance.key_dependencies]]
name = "react"
why = "ui"

[generated]
at = 2026-05-09T00:00:00Z
by = "test"
model = "none"
schema = "https://anatomy.dev/spec/0.8/schema.json"
`);
  return root;
}

describe("validate — strict-by-default", () => {
  it("default (no flag): cross-check warnings elevate to errors and exit 1", () => {
    const root = mkRepoWithDriftedAnatomy();
    const r = run(["validate", join(root, ".anatomy")], process.cwd());
    expect(r.code).toBe(1);
    expect(r.stdout + r.stderr).toContain("ERR");
    expect(r.stdout + r.stderr).toContain("unused-dependency-claim");
  });

  it("with --no-strict: cross-check warnings stay as warnings, exit 0", () => {
    const root = mkRepoWithDriftedAnatomy();
    const r = run(["validate", "--no-strict", join(root, ".anatomy")], process.cwd());
    expect(r.code).toBe(0);
    expect(r.stdout + r.stderr).toContain("WARN");
    expect(r.stdout + r.stderr).toContain("unused-dependency-claim");
    expect(r.stdout + r.stderr).not.toContain("ERR unused-dependency-claim");
  });

  it("default --json: cross-check codes appear in errors[], not warnings[]", () => {
    const root = mkRepoWithDriftedAnatomy();
    const r = run(["validate", "--json", join(root, ".anatomy")], process.cwd());
    expect(r.code).toBe(1);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.ok).toBe(false);
    const errCodes = (parsed.errors as Array<{ code: string }>).map(e => e.code);
    const warnCodes = (parsed.warnings as Array<{ code: string }>).map(w => w.code);
    expect(errCodes).toContain("unused-dependency-claim");
    expect(warnCodes).not.toContain("unused-dependency-claim");
  });

  it("--no-strict --json: cross-check codes stay in warnings[]", () => {
    const root = mkRepoWithDriftedAnatomy();
    const r = run(["validate", "--no-strict", "--json", join(root, ".anatomy")], process.cwd());
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.ok).toBe(true);
    const warnCodes = (parsed.warnings as Array<{ code: string }>).map(w => w.code);
    expect(warnCodes).toContain("unused-dependency-claim");
  });

  it("default with no cross-check warnings: exits 0", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-strict-clean-"));
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "index.ts"), "import _ from 'lodash';");
    writeFileSync(join(root, "package.json"), `{ "name": "x" }`);
    writeFileSync(join(root, ".anatomy"), `anatomy_version = "0.8"
tagline = "clean"

[identity]
stack = "typescript"
form = "typescript-library"
domain = "test"
function = "test"
fingerprint = "m74ew5qbnn3agrhdxpzp"

[[structure.entries]]
path = "src"
kind = "source"
purpose = "x"

[[substance.key_dependencies]]
name = "lodash"
why = "ui"

[generated]
at = 2026-05-09T00:00:00Z
by = "test"
model = "none"
schema = "https://anatomy.dev/spec/0.8/schema.json"
`);
    const r = run(["validate", join(root, ".anatomy")], process.cwd());
    expect(r.code).toBe(0);
  });

  it("--strict still accepted as a silent no-op (strict is the default)", () => {
    const root = mkRepoWithDriftedAnatomy();
    const r = run(["validate", "--strict", join(root, ".anatomy")], process.cwd());
    expect(r.code).toBe(1);
    expect(r.stdout + r.stderr).toContain("ERR");
  });
});
