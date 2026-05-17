import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { sectionToolHandlers } from "../src/mcp/section-tools.js";
import { buildAnatomyToml } from "./_helpers/fixture.js";

const FULL_V07 = buildAnatomyToml({
  description: "longer description here",
  extraToml: `[[structure.entries]]
path = "src/"
purpose = "library code"
kind = "source"

[interface]
[[interface.exports]]
symbol = "main"
kind = "function"
summary = "entry point"

[substance]
[[substance.key_dependencies]]
name = "vitest"
why = "tests"

[environment]
language_version = ">=22"
runtime = "node"

[domain_model]
[[domain_model.entities]]
name = "Foo"
summary = "the foo"

[code_profile.exports]
count = 5
`,
});

let tmpDir: string;
const origCwd = process.cwd();

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "anat-mcp-sec-"));
  execSync("git init", { cwd: tmpDir, stdio: "ignore", shell: true });
  // Create src/ so structure-path-check passes for the FULL_V07 fixture.
  mkdirSync(join(tmpDir, "src"), { recursive: true });
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(origCwd);
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

describe("anatomy_overview", () => {
  it("returns tagline + description + identity", async () => {
    writeFileSync(join(tmpDir, ".anatomy"), FULL_V07);
    const out = await sectionToolHandlers.anatomy_overview({});
    if ("error" in out) throw new Error("expected success");
    expect(out.data).toMatchObject({
      tagline: "test fixture",
      description: "longer description here",
      identity: { stack: "javascript", form: "javascript-library" },
    });
  });

  it("includes prose render when prose:true", async () => {
    writeFileSync(join(tmpDir, ".anatomy"), FULL_V07);
    const out = await sectionToolHandlers.anatomy_overview({ prose: true });
    if ("error" in out) throw new Error("expected success");
    expect(out.data).toHaveProperty("prose");
    expect((out.data as { prose: string }).prose).toContain("test fixture");
  });

  it("returns anatomy_not_found when no .anatomy", async () => {
    const out = await sectionToolHandlers.anatomy_overview({});
    expect(out).toMatchObject({ error: "anatomy_not_found" });
  });
});

describe("anatomy_structure", () => {
  it("returns the structure entries array", async () => {
    writeFileSync(join(tmpDir, ".anatomy"), FULL_V07);
    const out = await sectionToolHandlers.anatomy_structure({});
    if ("error" in out) throw new Error("expected success");
    expect(out.data).toEqual([{ path: "src/", purpose: "library code", kind: "source" }]);
  });
});

describe("anatomy_environment", () => {
  it("returns the environment section", async () => {
    writeFileSync(join(tmpDir, ".anatomy"), FULL_V07);
    const env = await sectionToolHandlers.anatomy_environment({});
    if ("error" in env) throw new Error("environment failed");
    expect(env.data).toMatchObject({ runtime: "node" });
  });

  it("v0.8-and-earlier section tools are removed in v0.9", () => {
    // anatomy_code_profile removed in v0.8; anatomy_interface,
    // anatomy_substance, anatomy_domain_model removed in v0.9 because they
    // saw 0/27, 0/27, 1/27 cite rates in the cross-repo N=3 eval and their
    // fields are derivable from source per the project's "do not add fields
    // LLM can re-derive" rule.
    expect(sectionToolHandlers.anatomy_code_profile).toBeUndefined();
    expect(sectionToolHandlers.anatomy_interface).toBeUndefined();
    expect(sectionToolHandlers.anatomy_substance).toBeUndefined();
    expect(sectionToolHandlers.anatomy_domain_model).toBeUndefined();
  });
});

describe("anatomy_tree", () => {
  it("returns all discovered .anatomy files in a monorepo", async () => {
    writeFileSync(join(tmpDir, ".anatomy"), FULL_V07);
    mkdirSync(join(tmpDir, "sub"));
    const subAnatomy = buildAnatomyToml({
      tagline: "sub fixture", domain: "test-sub", function: "test-sub",
    });
    writeFileSync(join(tmpDir, "sub", ".anatomy"), subAnatomy);
    const out = await sectionToolHandlers.anatomy_tree({ path: tmpDir });
    if ("error" in out) throw new Error("expected success");
    const arr = out.data as Array<{ tagline: string }>;
    expect(arr).toHaveLength(2);
    expect(arr.map(e => e.tagline).sort()).toEqual(["sub fixture", "test fixture"]);
  });

  it("returns empty array when no anatomies exist", async () => {
    const out = await sectionToolHandlers.anatomy_tree({});
    if ("error" in out) throw new Error("expected success");
    expect(out.data).toEqual([]);
  });
});
