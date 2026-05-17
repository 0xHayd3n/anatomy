import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderAll } from "../src/render/index.js";
import { runPass1 } from "../src/pass1/index.js";

const PINNED = "2026-05-13T14:00:00.000Z";

beforeEach(() => { process.env.ANATOMY_GENERATED_AT = PINNED; });
afterEach(() => { delete process.env.ANATOMY_GENERATED_AT; });

function minimalRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "anat-renderall-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({
    name: "my-tiny-lib",
    description: "A tiny utility library.",
    scripts: { build: "tsc" },
    engines: { node: ">=20" },
  }));
  mkdirSync(join(root, "src"));
  return root;
}

describe("renderAll", () => {
  it("emits .anatomy by default", () => {
    const result = runPass1(minimalRepo());
    const artifacts = renderAll(result, {});
    expect(artifacts.map(a => a.path)).toContain(".anatomy");
  });

  it("emits AGENTS.md by default", () => {
    const result = runPass1(minimalRepo());
    const artifacts = renderAll(result, {});
    expect(artifacts.map(a => a.path)).toContain("AGENTS.md");
  });

  it("skips AGENTS.md when emitAgentsMd is false", () => {
    const result = runPass1(minimalRepo());
    const artifacts = renderAll(result, { emitAgentsMd: false });
    expect(artifacts.map(a => a.path)).not.toContain("AGENTS.md");
  });

  it("skips .anatomy when emitAnatomy is false", () => {
    const result = runPass1(minimalRepo());
    const artifacts = renderAll(result, { emitAnatomy: false });
    expect(artifacts.map(a => a.path)).not.toContain(".anatomy");
  });

  it("passes modelId through to .anatomy renderer", () => {
    const result = runPass1(minimalRepo());
    const artifacts = renderAll(result, { modelId: "claude-3-5-sonnet" });
    const anatomy = artifacts.find(a => a.path === ".anatomy");
    expect(anatomy?.content).toContain('model = "claude-3-5-sonnet"');
  });
});

describe("renderAll v0.11 per-tool toggles", () => {
  it("does not emit any v0.11 renderer artifacts by default", () => {
    const result = runPass1(minimalRepo());
    const artifacts = renderAll(result, {});
    const paths = artifacts.map(a => a.path);
    expect(paths).not.toContain(".cursor/rules/anatomy.mdc");
    expect(paths).not.toContain(".cursorrules");
    expect(paths).not.toContain("CONVENTIONS.md");
    expect(paths).not.toContain(".clinerules");
    expect(paths).not.toContain(".roorules");
    expect(paths).not.toContain(".continuerules");
    expect(paths).not.toContain(".windsurfrules");
  });

  it("emits a v0.11 renderer when its [generate] flag is true", () => {
    const result = runPass1(minimalRepo());
    (result as unknown as { generate?: Record<string, unknown> }).generate = { aider_conventions: true };
    const artifacts = renderAll(result, {});
    expect(artifacts.map(a => a.path)).toContain("CONVENTIONS.md");
  });

  it("emits Cursor MDC when cursor_mdc flag is true", () => {
    const result = runPass1(minimalRepo());
    (result as unknown as { generate?: Record<string, unknown> }).generate = { cursor_mdc: true };
    const artifacts = renderAll(result, {});
    expect(artifacts.map(a => a.path)).toContain(".cursor/rules/anatomy.mdc");
  });

  it("CLI emit override beats [generate] file value (CLI false wins)", () => {
    const result = runPass1(minimalRepo());
    (result as unknown as { generate?: Record<string, unknown> }).generate = { cline_rules: true };
    const artifacts = renderAll(result, { emitCline: false });
    expect(artifacts.map(a => a.path)).not.toContain(".clinerules");
  });

  it("CLI emit override beats [generate] file value (CLI true wins)", () => {
    const result = runPass1(minimalRepo());
    // No [generate] block — default is false.
    const artifacts = renderAll(result, { emitWindsurf: true });
    expect(artifacts.map(a => a.path)).toContain(".windsurfrules");
  });

  it("emits all 7 v0.11 artifacts when all flags enabled", () => {
    const result = runPass1(minimalRepo());
    const artifacts = renderAll(result, {
      emitCursorMdc: true,
      emitCursorRules: true,
      emitAider: true,
      emitCline: true,
      emitRoo: true,
      emitContinue: true,
      emitWindsurf: true,
    });
    const paths = artifacts.map(a => a.path);
    expect(paths).toContain(".cursor/rules/anatomy.mdc");
    expect(paths).toContain(".cursorrules");
    expect(paths).toContain("CONVENTIONS.md");
    expect(paths).toContain(".clinerules");
    expect(paths).toContain(".roorules");
    expect(paths).toContain(".continuerules");
    expect(paths).toContain(".windsurfrules");
  });
});
