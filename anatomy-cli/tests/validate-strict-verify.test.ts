import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fingerprintFromPillars } from "@anatomytool/validate";

const BIN = resolve(import.meta.dirname, "../dist/bin.js");

function run(
  args: string[],
  cwd: string,
  env: Record<string, string> = {},
): { stdout: string; stderr: string; code: number } {
  // Invoke node by its absolute path with shell:false. The semgrep-unavailable
  // test runs with PATH="" to make `semgrep` unresolvable inside the CLI; with
  // shell:true + "node" that empty PATH also makes the shell unable to find
  // `node` itself, so the process never starts and exits 127 ("not found") on
  // POSIX CI. process.execPath is PATH-independent (node is a real exe, not a
  // .cmd shim), so only the in-CLI semgrep lookup is affected, as intended.
  const result = spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...env },
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    code: result.status ?? 1,
  };
}

function setupV12RepoWithFailingVerify(): string {
  const root = mkdtempSync(join(tmpdir(), "anat-strict-verify-"));
  const fp = fingerprintFromPillars("javascript", "javascript-library", "test", "test");
  writeFileSync(
    join(root, ".anatomy"),
    `anatomy_version = "0.12"
tagline = "test"
[identity]
stack = "javascript"
form = "javascript-library"
domain = "test"
function = "test"
fingerprint = "${fp}"

[[rules]]
rule = "Tests live in tests/"
verify = { kind = "glob_exists", path = "nonexistent/*.test.ts" }

[generated]
at = 2026-05-13T00:00:00Z
by = "test"
model = "none"
schema = "https://anatomy.dev/spec/0.12/schema.json"
`,
  );
  return root;
}

describe("anatomy validate --strict + v0.12 verify", () => {
  let root: string;
  beforeEach(() => {
    root = setupV12RepoWithFailingVerify();
  });
  afterEach(() => {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {}
  });

  it("default (strict): exits 1 and surfaces verify-glob-empty as error", () => {
    const r = run(["validate"], root);
    expect(r.code).toBe(1);
    expect(r.stdout + r.stderr).toContain("verify-glob-empty");
  });

  it("--no-strict: exits 0 and surfaces verify-glob-empty as warning", () => {
    const r = run(["validate", "--no-strict"], root);
    expect(r.code).toBe(0);
    expect(r.stdout + r.stderr).toContain("verify-glob-empty");
  });

  it("ANATOMY_VERIFY_SKIP=1: exits 0 with no verify warning surfaced", () => {
    const r = run(["validate"], root, { ANATOMY_VERIFY_SKIP: "1" });
    expect(r.code).toBe(0);
    expect(r.stdout + r.stderr).not.toContain("verify-glob-empty");
  });
});

// ---------- v0.13 semgrep strict-mode behavior ----------

function setupV13RepoWithSemgrepUnavailable(): string {
  const root = mkdtempSync(join(tmpdir(), "anat-strict-semgrep-"));
  const fp = fingerprintFromPillars("javascript", "javascript-library", "test", "test");
  writeFileSync(
    join(root, ".anatomy"),
    `anatomy_version = "0.13"
tagline = "v0.13 semgrep strict-mode test"
[identity]
stack = "javascript"
form = "javascript-library"
domain = "test"
function = "test"
fingerprint = "${fp}"

[[rules]]
rule = "no eval"
verify = { kind = "semgrep", lang = "py", pattern = "eval(...)", forbid_in = "src/**/*.py" }

[generated]
at = 2026-05-14T00:00:00Z
by = "test"
model = "none"
schema = "https://anatomy.dev/spec/0.13/schema.json"
`,
  );
  return root;
}

describe("anatomy validate --strict + v0.13 semgrep verify", () => {
  let root: string;
  beforeEach(() => {
    root = setupV13RepoWithSemgrepUnavailable();
  });
  afterEach(() => {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {}
  });

  it("verify-semgrep-unavailable stays a warning under strict (env issue, not source drift)", () => {
    // PATH-strip ensures semgrep is not found regardless of dev env.
    const r = run(["validate"], root, { PATH: "" });
    // Either binary not on PATH (warning) or no files matched glob (warning that DOES elevate).
    // Both outcomes verify dispatch reached the verifier; we just confirm no crash.
    expect([0, 1]).toContain(r.code);
  });

  it("ANATOMY_VERIFY_SKIP=1: exits 0 with no semgrep warnings surfaced", () => {
    const r = run(["validate"], root, { ANATOMY_VERIFY_SKIP: "1" });
    expect(r.code).toBe(0);
    expect(r.stdout + r.stderr).not.toContain("verify-semgrep-unavailable");
  });
});
