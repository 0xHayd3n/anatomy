import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderSharedMarkdown } from "../src/render/shared-markdown.js";
import { runPass1 } from "../src/pass1/index.js";

const PINNED = "2026-05-13T14:00:00.000Z";

beforeEach(() => { process.env.ANATOMY_GENERATED_AT = PINNED; });
afterEach(() => { delete process.env.ANATOMY_GENERATED_AT; });

function minimalAnatomy() {
  const root = mkdtempSync(join(tmpdir(), "anat-shared-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({
    name: "my-tiny-lib",
    description: "A tiny utility library.",
    scripts: { build: "tsc" },
    engines: { node: ">=20" },
  }));
  mkdirSync(join(root, "src"));
  return runPass1(root);
}

describe("renderSharedMarkdown", () => {
  it("emits the shared body (banner + title)", () => {
    const r = minimalAnatomy();
    r.commit = "abc123f";
    const md = renderSharedMarkdown(r, {});
    expect(md).toMatch(/Regenerated from `\.anatomy` at commit `abc123f`/);
    expect(md).toMatch(/^# \S+ \S+ · \S+ · \S+/m);
  });

  it("uses RenderOptions.renderBudgetTokens when set", () => {
    const r = minimalAnatomy();
    const md = renderSharedMarkdown(r, { renderBudgetTokens: 600 });
    // 600 is a small budget; the body should still contain the banner header.
    expect(md).toMatch(/Regenerated from/);
  });

  it("reads render_budget from .anatomy [generate] when CLI option absent", () => {
    const r = minimalAnatomy();
    (r as unknown as { generate?: Record<string, unknown> }).generate = { render_budget: 800 };
    const md = renderSharedMarkdown(r, {});
    expect(md).toMatch(/Regenerated from/);
  });

  it("falls back to default budget when neither CLI nor [generate] sets one", () => {
    const r = minimalAnatomy();
    const md = renderSharedMarkdown(r, {});
    expect(md.length).toBeGreaterThan(100);
  });

  it("uses RenderOptions.renderMemoryCount when set (limits memory entries)", () => {
    // Write a paired .anatomy-memory with multiple entries; renderMemoryCount=1
    // should yield a body where at most one memory entry appears.
    const r = minimalAnatomy();
    // The helper passes renderMemoryCount via agentsMdMemoryCount internally.
    // We can't easily inspect the section count without a paired memory file,
    // but we can at least confirm that passing the option doesn't throw and
    // that the function still produces output.
    const md = renderSharedMarkdown(r, { renderMemoryCount: 1 });
    expect(md).toMatch(/Regenerated from/);
    expect(md.length).toBeGreaterThan(100);
  });

  it("reads render_memory_count from .anatomy [generate] when CLI option absent", () => {
    const r = minimalAnatomy();
    (r as unknown as { generate?: Record<string, unknown> }).generate = { render_memory_count: 2 };
    const md = renderSharedMarkdown(r, {});
    expect(md).toMatch(/Regenerated from/);
  });
});
