import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { hookCommand } from "../src/commands/hook.js";
import { buildAnatomyToml } from "./_helpers/fixture.js";

const FULL_V07_EXTRAS = `[[rules]]
rule = "tests live in tests/"
why = "convention"

[[rules]]
rule = "use shell:true on Windows for spawnSync"

[[decisions]]
topic = "hand-roll TOML"
reason = "smol-toml.stringify does not preserve insertion order"

[[flows]]
name = "ingest"
summary = "stdin → parser → emitter"

[operation.commands]
test = "npm test"
build = "npm run build"

[[operation.entry_points]]
path = "src/bin.ts"
role = "cli"
`;

const FULL_V07 = buildAnatomyToml({ extraToml: FULL_V07_EXTRAS });

let tmpDir: string;
let stdoutBuf: string;
let stderrBuf: string;
const origWrite = process.stdout.write.bind(process.stdout);
const origErrWrite = process.stderr.write.bind(process.stderr);
const origCwd = process.cwd();
const origTelDir = process.env.ANATOMY_TELEMETRY_DIR;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "anat-hook-"));
  execSync("git init", { cwd: tmpDir, stdio: "ignore", shell: true });
  execSync('git config user.email "t@t.com"', { cwd: tmpDir, stdio: "ignore", shell: true });
  execSync('git config user.name "T"', { cwd: tmpDir, stdio: "ignore", shell: true });
  process.chdir(tmpDir);
  process.env.ANATOMY_TELEMETRY_DIR = mkdtempSync(join(tmpdir(), "anat-hook-tel-"));
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
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

describe("hookCommand — happy path", () => {
  it("emits markdown with all standard sections when budget is generous", async () => {
    writeFileSync(join(tmpDir, ".anatomy"), FULL_V07);
    const code = await hookCommand({ maxTokens: 2000 });
    expect(code).toBe(0);
    expect(stdoutBuf).toContain("# Repository: test fixture");
    expect(stdoutBuf).toContain("`javascript` · `javascript-library` · `test` · `test`");
    expect(stdoutBuf).toContain("## Rules");
    expect(stdoutBuf).toContain("tests live in tests/");
    expect(stdoutBuf).toContain("## Decisions");
    expect(stdoutBuf).toContain("## Flows");
    expect(stdoutBuf).toContain("## Commands");
    expect(stdoutBuf).toContain("`test`: `npm test`");
    expect(stdoutBuf).toContain("## Entry points");
  });

  it("omits a section entirely when its source field is absent", async () => {
    const minimal = buildAnatomyToml({
      stack: "rust", form: "rust-binary", tagline: "minimal",
    });
    writeFileSync(join(tmpDir, ".anatomy"), minimal);
    await hookCommand({});
    expect(stdoutBuf).not.toContain("## Rules");
    expect(stdoutBuf).not.toContain("(none)");
    expect(stdoutBuf).toContain("# Repository: minimal");
  });
});

describe("hookCommand — failure modes", () => {
  it("emits nothing when no .anatomy exists", async () => {
    const code = await hookCommand({});
    expect(code).toBe(0);
    expect(stdoutBuf).toBe("");
  });

  it("emits nothing when --root is set but root has no .anatomy", async () => {
    // Create a sub-anatomy but leave root without one.
    mkdirSync(join(tmpDir, "sub"));
    writeFileSync(join(tmpDir, "sub", ".anatomy"), buildAnatomyToml({ tagline: "sub only" }));
    process.chdir(join(tmpDir, "sub"));
    const code = await hookCommand({ root: true });
    expect(code).toBe(0);
    expect(stdoutBuf).toBe("");
  });

  it("emits a single-line error for malformed .anatomy", async () => {
    writeFileSync(join(tmpDir, ".anatomy"), 'anatomy_version = "0.7"\n# missing required\n');
    const code = await hookCommand({});
    expect(code).toBe(0);
    expect(stdoutBuf).toMatch(/^> anatomy_error: /);
    expect(stdoutBuf.split("\n").filter(l => l.length > 0).length).toBe(1);
  });

  it("prepends a staleness banner when commit doesn't match HEAD", async () => {
    const stale = buildAnatomyToml({ extraToml: FULL_V07_EXTRAS, commit: "deadbee" });
    writeFileSync(join(tmpDir, ".anatomy"), stale);
    execSync("git add .", { cwd: tmpDir, stdio: "ignore", shell: true });
    execSync('git commit -m "init"', { cwd: tmpDir, stdio: "ignore", shell: true });
    await hookCommand({});
    const lines = stdoutBuf.split("\n");
    expect(lines[0]).toMatch(/^> staleness: file at deadbee, HEAD at [0-9a-f]+$/);
    expect(lines.some(l => l.startsWith("# Repository:"))).toBe(true);
  });
});

describe("hookCommand — budget enforcement", () => {
  it("truncates rules first when over budget but never drops them entirely", async () => {
    writeFileSync(join(tmpDir, ".anatomy"), FULL_V07);
    // very tight budget — should still include tagline+identity+at-least-one-rule
    await hookCommand({ maxTokens: 100 });
    expect(stdoutBuf).toContain("# Repository: test fixture");
    expect(stdoutBuf).toContain("## Rules");
  });

  it("drops entry_points first under tight budget", async () => {
    writeFileSync(join(tmpDir, ".anatomy"), FULL_V07);
    await hookCommand({ maxTokens: 80 });
    expect(stdoutBuf).not.toContain("## Entry points");
  });

  it("preserves rules section even at budgets below total content size", async () => {
    writeFileSync(join(tmpDir, ".anatomy"), FULL_V07);
    // 25 tokens is enough for header (~15 tokens) but forces decisions/flows/
    // commands/entry_points dropped AND rules truncated. Rules section must
    // still appear (per spec §3.4 — never drop the section entirely).
    await hookCommand({ maxTokens: 25 });
    expect(stdoutBuf).toContain("# Repository: test fixture");
    expect(stdoutBuf).toContain("## Rules");
    // Confirm only header + rules survive (no other section headers).
    expect(stdoutBuf).not.toContain("## Decisions");
    expect(stdoutBuf).not.toContain("## Flows");
    expect(stdoutBuf).not.toContain("## Commands");
    expect(stdoutBuf).not.toContain("## Entry points");
  });

  it("trims rules at entry boundaries — never drops a rule's why-line while keeping its bullet", async () => {
    // 8 rules each with a why; tight budget forces partial trim of the rules
    // list. The fix changes truncation from raw-char cutting (which could
    // strip a why-line while leaving its bullet) to whole-entry dropping.
    const manyRules = Array.from({ length: 8 }, (_, i) =>
      `[[rules]]\nrule = "rule number ${i} text content"\nwhy = "reason for rule number ${i}"\n`
    ).join("\n");
    writeFileSync(join(tmpDir, ".anatomy"), buildAnatomyToml({ extraToml: manyRules }));
    await hookCommand({ maxTokens: 80 });

    expect(stdoutBuf).toContain("## Rules");
    // Every rule bullet that survives must keep its why-line. Find each
    // bullet and assert the next non-empty line is its why-line (or the
    // ellipsis sentinel for the truncation point).
    const lines = stdoutBuf.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith("- rule number ")) continue;
      // Next line should either be the indented why or the ellipsis (if
      // this happens to be the last surviving rule).
      const next = lines[i + 1] ?? "";
      const isWhy = next.startsWith("  *Why:");
      const isTerminator = next === "…" || next === "" || next.startsWith("##") || next.startsWith("# ");
      expect(isWhy || isTerminator).toBe(true);
    }
    // At least one whole rule survived.
    expect(stdoutBuf).toMatch(/- rule number \d+ text content\n  \*Why:/);
    // Truncation marker present (entries were dropped).
    expect(stdoutBuf).toContain("…");
  });

  it("respects --json by emitting JSON instead of markdown", async () => {
    writeFileSync(join(tmpDir, ".anatomy"), FULL_V07);
    await hookCommand({ json: true, maxTokens: 2000 });
    const parsed = JSON.parse(stdoutBuf);
    expect(parsed).toMatchObject({
      tagline: "test fixture",
      identity: { stack: "javascript" },
    });
  });

  it("falls back to DEFAULT_MAX_TOKENS when maxTokens is undefined (e.g. non-numeric CLI flag)", async () => {
    // bin.ts now passes parseLimit(flags.maxTokens) — which returns undefined
    // for non-numeric input — instead of Number(...) which would have produced
    // NaN. Verify the function honors the default fallback when undefined.
    writeFileSync(join(tmpDir, ".anatomy"), FULL_V07);
    await hookCommand({ maxTokens: undefined });
    // Default budget (1200 tokens) is generous; FULL_V07 fits comfortably,
    // so all standard sections are present.
    expect(stdoutBuf).toContain("# Repository: test fixture");
    expect(stdoutBuf).toContain("## Rules");
    expect(stdoutBuf).toContain("## Decisions");
  });
});

describe("hookCommand — ANATOMY_HOOK_DISABLE env-gate", () => {
  const ORIG = process.env.ANATOMY_HOOK_DISABLE;
  afterEach(() => {
    if (ORIG === undefined) delete process.env.ANATOMY_HOOK_DISABLE;
    else process.env.ANATOMY_HOOK_DISABLE = ORIG;
  });

  it("emits no markdown when ANATOMY_HOOK_DISABLE=1", async () => {
    writeFileSync(join(tmpDir, ".anatomy"), FULL_V07);
    process.env.ANATOMY_HOOK_DISABLE = "1";
    const code = await hookCommand({ maxTokens: 2000 });
    expect(code).toBe(0);
    expect(stdoutBuf).toBe("");
  });

  it("emits no markdown when ANATOMY_HOOK_DISABLE=true (case-insensitive)", async () => {
    writeFileSync(join(tmpDir, ".anatomy"), FULL_V07);
    process.env.ANATOMY_HOOK_DISABLE = "True";
    const code = await hookCommand({ maxTokens: 2000 });
    expect(code).toBe(0);
    expect(stdoutBuf).toBe("");
  });

  it("still emits markdown when ANATOMY_HOOK_DISABLE='0'", async () => {
    writeFileSync(join(tmpDir, ".anatomy"), FULL_V07);
    process.env.ANATOMY_HOOK_DISABLE = "0";
    await hookCommand({ maxTokens: 2000 });
    expect(stdoutBuf).toContain("# Repository: test fixture");
  });

  it("still emits markdown when ANATOMY_HOOK_DISABLE='' (empty string)", async () => {
    writeFileSync(join(tmpDir, ".anatomy"), FULL_V07);
    process.env.ANATOMY_HOOK_DISABLE = "";
    await hookCommand({ maxTokens: 2000 });
    expect(stdoutBuf).toContain("# Repository: test fixture");
  });

  it("still emits markdown when ANATOMY_HOOK_DISABLE is unset", async () => {
    writeFileSync(join(tmpDir, ".anatomy"), FULL_V07);
    delete process.env.ANATOMY_HOOK_DISABLE;
    await hookCommand({ maxTokens: 2000 });
    expect(stdoutBuf).toContain("# Repository: test fixture");
  });
});
