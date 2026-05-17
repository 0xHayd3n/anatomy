import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeArtifacts } from "../src/render/write.js";

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "anatomy-write-")); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

describe("writeArtifacts", () => {
  it("writes all artifacts atomically", async () => {
    await writeArtifacts(tmp, [
      { path: ".anatomy", content: "a=1\n" },
      { path: "AGENTS.md", content: "# X\n" },
    ], { yes: true });
    expect(readFileSync(join(tmp, ".anatomy"), "utf8")).toBe("a=1\n");
    expect(readFileSync(join(tmp, "AGENTS.md"), "utf8")).toBe("# X\n");
  });

  it("overwrites existing files", async () => {
    await writeArtifacts(tmp, [{ path: "AGENTS.md", content: "v1" }], { yes: true });
    await writeArtifacts(tmp, [{ path: "AGENTS.md", content: "v2" }], { yes: true });
    expect(readFileSync(join(tmp, "AGENTS.md"), "utf8")).toBe("v2");
  });

  it("does not leave .tmp files behind on success", async () => {
    await writeArtifacts(tmp, [{ path: "AGENTS.md", content: "X" }], { yes: true });
    const entries = readdirSync(tmp);
    expect(entries.filter((e) => e.endsWith(".tmp"))).toHaveLength(0);
  });

  it("resolves to undefined on success", async () => {
    const result = await writeArtifacts(tmp, [{ path: "AGENTS.md", content: "X" }], { yes: true });
    expect(result).toBeUndefined();
  });
});

describe("writeArtifacts — v0.11 banner-protected paths", () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), "anat-wp-")); });
  afterEach(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch {} });

  it("creates nested directories for .cursor/rules/anatomy.mdc", async () => {
    const content = `---\ndescription: "test"\nalwaysApply: true\n---\n\n> **Regenerated from \`.anatomy\` at commit \`abc1234\` by \`anatomy-cli\`.**\n\nbody`;
    await writeArtifacts(tmpDir, [{ path: ".cursor/rules/anatomy.mdc", content }], { yes: true });
    expect(existsSync(join(tmpDir, ".cursor/rules/anatomy.mdc"))).toBe(true);
    expect(readFileSync(join(tmpDir, ".cursor/rules/anatomy.mdc"), "utf8")).toContain("body");
  });

  it("backs up hand-written .cursorrules before overwriting", async () => {
    writeFileSync(join(tmpDir, ".cursorrules"), "hand-edited rules");
    const banneredContent = `> **Regenerated from \`.anatomy\` at commit \`abc1234\` by \`anatomy-cli\`.**\n\nnew body`;
    await writeArtifacts(tmpDir, [{ path: ".cursorrules", content: banneredContent }], { yes: true });
    expect(readFileSync(join(tmpDir, ".cursorrules.bak"), "utf8")).toBe("hand-edited rules");
    expect(readFileSync(join(tmpDir, ".cursorrules"), "utf8")).toContain("new body");
  });

  it("idempotently overwrites a banner-marked .clinerules without backup", async () => {
    const old = `> **Regenerated from \`.anatomy\` at commit \`abc1234\` by \`anatomy-cli\`.**\n\nold body`;
    writeFileSync(join(tmpDir, ".clinerules"), old);
    const fresh = `> **Regenerated from \`.anatomy\` at commit \`def5678\` by \`anatomy-cli\`.**\n\nfresh body`;
    await writeArtifacts(tmpDir, [{ path: ".clinerules", content: fresh }], {});
    expect(existsSync(join(tmpDir, ".clinerules.bak"))).toBe(false);
    expect(readFileSync(join(tmpDir, ".clinerules"), "utf8")).toContain("fresh body");
  });

  it("applies banner detection to CONVENTIONS.md", async () => {
    writeFileSync(join(tmpDir, "CONVENTIONS.md"), "hand-edited conventions");
    const fresh = `> **Regenerated from \`.anatomy\` at commit \`def5678\` by \`anatomy-cli\`.**\n\nnew conventions`;
    await writeArtifacts(tmpDir, [{ path: "CONVENTIONS.md", content: fresh }], { yes: true });
    expect(existsSync(join(tmpDir, "CONVENTIONS.md.bak"))).toBe(true);
    expect(readFileSync(join(tmpDir, "CONVENTIONS.md.bak"), "utf8")).toBe("hand-edited conventions");
  });

  it("does not apply banner detection to .anatomy (non-protected path)", async () => {
    // .anatomy is not in BANNER_PROTECTED_PATHS; it should go through the
    // atomic batch path with no backup.
    writeFileSync(join(tmpDir, ".anatomy"), "old anatomy");
    await writeArtifacts(tmpDir, [{ path: ".anatomy", content: "new anatomy" }], {});
    expect(existsSync(join(tmpDir, ".anatomy.bak"))).toBe(false);
    expect(readFileSync(join(tmpDir, ".anatomy"), "utf8")).toBe("new anatomy");
  });
});
