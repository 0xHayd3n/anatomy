import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { fingerprintFromPillars } from "@anatomy/validate";
import { verifySuggestCommand } from "../src/commands/verify-suggest.js";
import { buildAnatomyToml } from "./_helpers/fixture.js";

// v0.7 schema (the fixture default) doesn't allow `verify` on rules — verify
// clauses are a v0.12+ feature. For the "nothing to suggest" case we hand-roll
// a v0.12 .anatomy directly.
function buildV12WithVerifiedRule(): string {
  const fp = fingerprintFromPillars("javascript", "javascript-library", "test", "test");
  return `anatomy_version = "0.12"
tagline = "test"
[identity]
stack = "javascript"
form = "javascript-library"
domain = "test"
function = "test"
fingerprint = "${fp}"

[[rules]]
rule = "needs pkg"
verify = { kind = "glob_exists", path = "package.json" }

[generated]
at = 2026-05-13T00:00:00Z
by = "test"
model = "none"
schema = "https://anatomy.dev/spec/0.12/schema.json"
`;
}

let tmpDir: string;
let stdoutBuf: string;
let stderrBuf: string;
const origWrite = process.stdout.write.bind(process.stdout);
const origErrWrite = process.stderr.write.bind(process.stderr);
const origCwd = process.cwd();
const origTelDir = process.env.ANATOMY_TELEMETRY_DIR;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "anat-vs-cmd-"));
  execSync("git init", { cwd: tmpDir, stdio: "ignore", shell: true });
  execSync('git config user.email "t@t.com"', { cwd: tmpDir, stdio: "ignore", shell: true });
  execSync('git config user.name "T"', { cwd: tmpDir, stdio: "ignore", shell: true });
  process.chdir(tmpDir);
  process.env.ANATOMY_TELEMETRY_DIR = mkdtempSync(join(tmpdir(), "anat-vs-tel-"));
  stdoutBuf = "";
  stderrBuf = "";
  process.stdout.write = ((chunk: string | Uint8Array) => { stdoutBuf += chunk.toString(); return true; }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => { stderrBuf += chunk.toString(); return true; }) as typeof process.stderr.write;
});

afterEach(() => {
  process.chdir(origCwd);
  process.stdout.write = origWrite;
  process.stderr.write = origErrWrite;
  process.env.ANATOMY_TELEMETRY_DIR = origTelDir;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("verifySuggestCommand", () => {
  it("returns 1 with an error message when stdin is not a TTY", async () => {
    // process.stdin.isTTY is undefined in vitest's default environment → falsy
    writeFileSync(join(tmpDir, ".anatomy"), buildAnatomyToml({ extraToml: '[[rules]]\nrule = "test"' }));
    const code = await verifySuggestCommand({});
    expect(code).toBe(1);
    expect(stderrBuf).toMatch(/requires an interactive terminal/i);
  });

  it("returns 1 when no .anatomy is found", async () => {
    // Force TTY so we get past the TTY check
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    try {
      const code = await verifySuggestCommand({});
      expect(code).toBe(1);
      expect(stderrBuf).toMatch(/anatomy_not_found/i);
    } finally {
      Object.defineProperty(process.stdin, "isTTY", { value: undefined, configurable: true });
    }
  });

  it("returns 0 with a 'nothing to suggest' message when every rule has a verify clause", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    try {
      writeFileSync(join(tmpDir, ".anatomy"), buildV12WithVerifiedRule());
      writeFileSync(join(tmpDir, "package.json"), "{}");
      const code = await verifySuggestCommand({});
      expect(code).toBe(0);
      expect(stdoutBuf).toMatch(/Nothing to suggest/i);
    } finally {
      Object.defineProperty(process.stdin, "isTTY", { value: undefined, configurable: true });
    }
  });
});
