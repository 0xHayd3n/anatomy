import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validate, fingerprintFromPillars } from "../src/index.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "anat-validate-verify-"));
});

afterEach(() => { try { rmSync(root, { recursive: true, force: true }); } catch {} });

describe("validate() with v0.12 verify clauses", () => {
  it("integrates verifyCheck and surfaces verify-glob-empty as warning", async () => {
    const anatomy = `anatomy_version = "0.12"
tagline = "test"
[identity]
stack = "javascript"
form = "javascript-library"
domain = "test"
function = "test"
fingerprint = "${fingerprintFromPillars("javascript", "javascript-library", "test", "test")}"

[[rules]]
rule = "Tests must exist"
verify = { kind = "glob_exists", path = "nonexistent/*.test.ts" }

[generated]
at = 2026-05-13T00:00:00Z
by = "test"
model = "none"
schema = "https://anatomy.dev/spec/0.12/schema.json"
`;
    const result = await validate(anatomy, { repoRoot: root });
    expect(result.warnings.some(w => w.code === "verify-glob-empty")).toBe(true);
  });

  it("validate returns a Promise (now async)", () => {
    const r = validate("anatomy_version = \"0.12\"", {});
    expect(r).toBeInstanceOf(Promise);
  });
});
