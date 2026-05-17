import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { renderCommand } from "../src/commands/render.js";
import { fingerprintFromPillars } from "@anatomy/validate";

const BIN = resolve(import.meta.dirname, "../dist/bin.js");

function run(
  args: string[],
  cwd: string,
): { stdout: string; stderr: string; code: number } {
  try {
    const stdout = execFileSync("node", [BIN, ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });
    return { stdout, stderr: "", code: 0 };
  } catch (err) {
    const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number };
    return {
      stdout: e.stdout?.toString() ?? "",
      stderr: e.stderr?.toString() ?? "",
      code: e.status ?? 1,
    };
  }
}

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "anatomy-render-")); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

// A valid v0.9 .anatomy file with computed fingerprint.
const FINGERPRINT = fingerprintFromPillars("javascript", "library", "test", "test");
const VALID_V9_ANATOMY = `anatomy_version = "0.9"
tagline = "Test repo"
description = "A test anatomy."

[identity]
stack = "javascript"
form = "library"
domain = "test"
function = "test"
fingerprint = "${FINGERPRINT}"

[generated]
at = 2026-05-13T00:00:00.000Z
commit = "abcd1234"
by = "test"
model = "none"
schema = "https://anatomy.dev/spec/0.9/schema.json"
`;

describe("anatomy render", () => {
  it("regenerates AGENTS.md from an existing .anatomy", async () => {
    writeFileSync(join(tmp, ".anatomy"), VALID_V9_ANATOMY);
    const rc = await renderCommand({ repo: tmp });
    expect(rc).toBe(0);
    expect(existsSync(join(tmp, ".anatomy"))).toBe(true);
    expect(existsSync(join(tmp, "AGENTS.md"))).toBe(true);
  });

  it("errors if no .anatomy file exists", async () => {
    const rc = await renderCommand({ repo: tmp });
    expect(rc).not.toBe(0);
  });

  it("skips AGENTS.md emission with --no-agents-md", async () => {
    writeFileSync(join(tmp, ".anatomy"), VALID_V9_ANATOMY);
    const rc = await renderCommand({ repo: tmp, noAgentsMd: true });
    expect(rc).toBe(0);
    expect(existsSync(join(tmp, "AGENTS.md"))).toBe(false);
  });

  it("errors when .anatomy is invalid", async () => {
    writeFileSync(join(tmp, ".anatomy"), "not valid toml = [\n");
    const rc = await renderCommand({ repo: tmp });
    expect(rc).not.toBe(0);
  });

  it("--check exits 0 when rendered output matches disk", async () => {
    writeFileSync(join(tmp, ".anatomy"), VALID_V9_ANATOMY);
    // First render to establish the disk state.
    await renderCommand({ repo: tmp });
    // Then check.
    const rc = await renderCommand({ repo: tmp, check: true });
    expect(rc).toBe(0);
  });

  it("--check exits non-zero when AGENTS.md is stale", async () => {
    writeFileSync(join(tmp, ".anatomy"), VALID_V9_ANATOMY);
    await renderCommand({ repo: tmp });
    // Now stale-ify.
    writeFileSync(join(tmp, "AGENTS.md"), "# stale\n");
    const rc = await renderCommand({ repo: tmp, check: true });
    expect(rc).not.toBe(0);
  });

  it("--check does not write any file (no side effects)", async () => {
    writeFileSync(join(tmp, ".anatomy"), VALID_V9_ANATOMY);
    // Pre-render so AGENTS.md exists.
    await renderCommand({ repo: tmp });
    const fresh = readFileSync(join(tmp, "AGENTS.md"), "utf8");
    const anatomyBefore = readFileSync(join(tmp, ".anatomy"), "utf8");
    const rc = await renderCommand({ repo: tmp, check: true });
    expect(rc).toBe(0);
    // No writes — both files unchanged.
    expect(readFileSync(join(tmp, "AGENTS.md"), "utf8")).toBe(fresh);
    expect(readFileSync(join(tmp, ".anatomy"), "utf8")).toBe(anatomyBefore);
  });

  it("returns exit 0 with a truncation banner when rules alone exceed budget", async () => {
    // Build a .anatomy with enough rules to blow past a tight budget.
    // Old behavior: applyBudget threw BudgetExceededError → exit 3.
    // New behavior (2026-05-14): applyBudget trims rules from the end, keeps
    // at least one, sets truncated:true, render emits a banner. Exit 0.
    const longRules = Array.from({ length: 20 }, (_, i) =>
      `[[rules]]\nrule = "rule ${i} ${"x".repeat(200)}"\nwhy = "reason ${i} ${"y".repeat(100)}"\n`
    ).join("\n");
    const big = `anatomy_version = "0.9"
tagline = "budget exceeded test"

[identity]
stack = "javascript"
form = "library"
domain = "test"
function = "test"
fingerprint = "${FINGERPRINT}"

${longRules}

[generated]
at = 2026-05-13T00:00:00.000Z
commit = "abcd1234"
by = "test"
model = "none"
schema = "https://anatomy.dev/spec/0.9/schema.json"
`;
    writeFileSync(join(tmp, ".anatomy"), big);
    const rc = await renderCommand({ repo: tmp, budgetTokens: 500 });
    expect(rc).toBe(0);
    const agentsMd = readFileSync(join(tmp, "AGENTS.md"), "utf8");
    expect(agentsMd).toMatch(/Truncated under 500-token budget/);
  });
});

describe("anatomy render — v0.11 --no-X flag overrides", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  });

  function setupRepoWithGenerateFlags(flags: Record<string, boolean>): string {
    const root = mkdtempSync(join(tmpdir(), "anat-render-v11-"));
    tempDirs.push(root);
    const generateBlock = Object.entries(flags)
      .map(([k, v]) => `${k} = ${v}`)
      .join("\n");
    const anatomy = `anatomy_version = "0.11"
tagline = "test"
[identity]
stack = "javascript"
form = "javascript-library"
domain = "test"
function = "test"
fingerprint = "${fingerprintFromPillars("javascript", "javascript-library", "test", "test")}"
[generate]
${generateBlock}
[generated]
at = 2026-05-13T00:00:00Z
by = "test"
model = "none"
schema = "https://anatomy.dev/spec/0.11/schema.json"
`;
    writeFileSync(join(root, ".anatomy"), anatomy);
    return root;
  }

  it("--no-aider skips CONVENTIONS.md even when [generate].aider_conventions = true", () => {
    const root = setupRepoWithGenerateFlags({ aider_conventions: true });
    const r = run(["render", "--no-aider"], root);
    expect(r.code).toBe(0);
    expect(existsSync(join(root, "CONVENTIONS.md"))).toBe(false);
  });

  it("--no-cursor-mdc skips .cursor/rules/anatomy.mdc even when [generate].cursor_mdc = true", () => {
    const root = setupRepoWithGenerateFlags({ cursor_mdc: true });
    const r = run(["render", "--no-cursor-mdc"], root);
    expect(r.code).toBe(0);
    expect(existsSync(join(root, ".cursor/rules/anatomy.mdc"))).toBe(false);
  });

  it("--no-cline skips .clinerules even when [generate].cline_rules = true", () => {
    const root = setupRepoWithGenerateFlags({ cline_rules: true });
    const r = run(["render", "--no-cline"], root);
    expect(r.code).toBe(0);
    expect(existsSync(join(root, ".clinerules"))).toBe(false);
  });

  it("without --no flags, all enabled [generate] flags emit their artifacts", () => {
    const root = setupRepoWithGenerateFlags({
      aider_conventions: true,
      cline_rules: true,
      windsurf_rules: true,
    });
    const r = run(["render"], root);
    expect(r.code).toBe(0);
    expect(existsSync(join(root, "CONVENTIONS.md"))).toBe(true);
    expect(existsSync(join(root, ".clinerules"))).toBe(true);
    expect(existsSync(join(root, ".windsurfrules"))).toBe(true);
  });
});
