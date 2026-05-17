import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderCursorMdcArtifact } from "../src/render/cursor-mdc.js";
import { runPass1 } from "../src/pass1/index.js";

const PINNED = "2026-05-13T14:00:00.000Z";

beforeEach(() => { process.env.ANATOMY_GENERATED_AT = PINNED; });
afterEach(() => { delete process.env.ANATOMY_GENERATED_AT; });

function minimalAnatomy() {
  const root = mkdtempSync(join(tmpdir(), "anat-mdc-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({
    name: "my-tiny-lib",
    description: "A tiny utility library.",
    scripts: { build: "tsc" },
    engines: { node: ">=20" },
  }));
  mkdirSync(join(root, "src"));
  return runPass1(root);
}

describe("renderCursorMdcArtifact", () => {
  it("emits .cursor/rules/anatomy.mdc as the path", () => {
    const r = minimalAnatomy();
    const out = renderCursorMdcArtifact(r, {});
    expect(out.path).toBe(".cursor/rules/anatomy.mdc");
  });

  it("starts with YAML frontmatter (description + alwaysApply: true)", () => {
    const r = minimalAnatomy();
    r.tagline = { value: "A tiny utility library.", isPlaceholder: false, source: "readme" };
    const out = renderCursorMdcArtifact(r, {});
    expect(out.content.startsWith("---\n")).toBe(true);
    expect(out.content).toMatch(/description: "A tiny utility library\."/);
    expect(out.content).toMatch(/alwaysApply: true/);
    expect(out.content).toMatch(/^---\ndescription: ".+"\nalwaysApply: true\n---\n\n/);
  });

  it("includes the shared markdown body after the frontmatter", () => {
    const r = minimalAnatomy();
    r.commit = "abc123f";
    const out = renderCursorMdcArtifact(r, {});
    expect(out.content).toMatch(/Regenerated from `\.anatomy` at commit `abc123f`/);
    expect(out.content).toMatch(/^# \S+ \S+ · \S+ · \S+/m);
  });

  it("escapes double quotes in tagline for the YAML description", () => {
    const r = minimalAnatomy();
    r.tagline = { value: 'A "quoted" tagline.', isPlaceholder: false, source: "placeholder" };
    const out = renderCursorMdcArtifact(r, {});
    expect(out.content).toMatch(/description: "A \\"quoted\\" tagline\."/);
  });

  it("handles empty tagline gracefully (emits description: \"\")", () => {
    const r = minimalAnatomy();
    r.tagline = { value: "", isPlaceholder: true, source: "placeholder" };
    const out = renderCursorMdcArtifact(r, {});
    expect(out.content).toMatch(/description: ""/);
  });

  it("escapes backslashes in tagline for the YAML description", () => {
    const r = minimalAnatomy();
    r.tagline = { value: "path\\to\\thing", isPlaceholder: false, source: "placeholder" };
    const out = renderCursorMdcArtifact(r, {});
    expect(out.content).toMatch(/description: "path\\\\to\\\\thing"/);
  });

  it("escapes newlines in tagline (preserves single-line YAML frontmatter)", () => {
    const r = minimalAnatomy();
    r.tagline = { value: "line one\nline two", isPlaceholder: false, source: "placeholder" };
    const out = renderCursorMdcArtifact(r, {});
    // The literal "\n" should appear as "\\n" in the YAML string.
    expect(out.content).toMatch(/description: "line one\\nline two"/);
    // The frontmatter block should still be exactly 4 header lines.
    const frontmatterEnd = out.content.indexOf("---\n\n", 4);
    expect(frontmatterEnd).toBeGreaterThan(0);
    // Count newlines before the end-of-frontmatter marker — should be exactly 3
    // (after "---", after "description:...", after "alwaysApply:...").
    const headerLines = out.content.slice(0, frontmatterEnd).split("\n");
    expect(headerLines.length).toBe(4);
  });
});
