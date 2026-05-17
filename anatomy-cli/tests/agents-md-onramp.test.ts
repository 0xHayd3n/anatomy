import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeArtifacts } from "../src/render/write.js";

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "onramp-")); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

const FRESH = "# fresh anatomy-generated AGENTS.md\n";
const BANNERED = "# title\n> **Regenerated from `.anatomy` at commit `abc` by `y`.**\nbody\n";
const HANDWRITTEN = "# my hand-written notes\n- foo\n";

describe("AGENTS.md write strategy", () => {
  it("branch 1: writes directly when no AGENTS.md exists", async () => {
    await writeArtifacts(tmp, [{ path: "AGENTS.md", content: FRESH }], { yes: true });
    expect(readFileSync(join(tmp, "AGENTS.md"), "utf8")).toBe(FRESH);
    expect(existsSync(join(tmp, "AGENTS.md.bak"))).toBe(false);
  });

  it("branch 2: overwrites idempotently when existing has regen banner", async () => {
    writeFileSync(join(tmp, "AGENTS.md"), BANNERED);
    await writeArtifacts(tmp, [{ path: "AGENTS.md", content: FRESH }], { yes: true });
    expect(readFileSync(join(tmp, "AGENTS.md"), "utf8")).toBe(FRESH);
    expect(existsSync(join(tmp, "AGENTS.md.bak"))).toBe(false);
  });

  it("branch 3: backs up and overwrites hand-written AGENTS.md when yes=true", async () => {
    writeFileSync(join(tmp, "AGENTS.md"), HANDWRITTEN);
    await writeArtifacts(tmp, [{ path: "AGENTS.md", content: FRESH }], { yes: true });
    expect(readFileSync(join(tmp, "AGENTS.md"), "utf8")).toBe(FRESH);
    expect(readFileSync(join(tmp, "AGENTS.md.bak"), "utf8")).toBe(HANDWRITTEN);
  });

  it("branch 3: backup overwrites previous backup", async () => {
    writeFileSync(join(tmp, "AGENTS.md"), HANDWRITTEN);
    writeFileSync(join(tmp, "AGENTS.md.bak"), "old backup content");
    await writeArtifacts(tmp, [{ path: "AGENTS.md", content: FRESH }], { yes: true });
    // The new backup is the previous (hand-written) content, not the old .bak.
    expect(readFileSync(join(tmp, "AGENTS.md.bak"), "utf8")).toBe(HANDWRITTEN);
  });

  it("end-to-end: render --yes regenerates and backs up hand-written AGENTS.md (fixture)", async () => {
    const { renderCommand } = await import("../src/commands/render.js");
    const fixDir = join(__dirname, "..", "..", "fixtures", "agents-md", "with-existing-agents-md-merge");
    writeFileSync(join(tmp, ".anatomy"), readFileSync(join(fixDir, "anatomy"), "utf8"));
    writeFileSync(join(tmp, "AGENTS.md"), readFileSync(join(fixDir, "AGENTS.md.input"), "utf8"));
    const expected = readFileSync(join(fixDir, "expected-AGENTS.md"), "utf8");

    const rc = await renderCommand({ repo: tmp, yes: true });
    expect(rc).toBe(0);
    expect(readFileSync(join(tmp, "AGENTS.md"), "utf8")).toBe(expected);
    expect(existsSync(join(tmp, "AGENTS.md.bak"))).toBe(true);
    expect(readFileSync(join(tmp, "AGENTS.md.bak"), "utf8")).toBe(
      readFileSync(join(fixDir, "AGENTS.md.input"), "utf8"),
    );
  });

  it(".anatomy and AGENTS.md both write atomically in one call", async () => {
    writeFileSync(join(tmp, "AGENTS.md"), HANDWRITTEN);
    await writeArtifacts(
      tmp,
      [
        { path: ".anatomy", content: "anatomy_version = \"0.10\"\n" },
        { path: "AGENTS.md", content: FRESH },
      ],
      { yes: true },
    );
    expect(readFileSync(join(tmp, ".anatomy"), "utf8")).toContain("0.10");
    expect(readFileSync(join(tmp, "AGENTS.md"), "utf8")).toBe(FRESH);
    expect(readFileSync(join(tmp, "AGENTS.md.bak"), "utf8")).toBe(HANDWRITTEN);
  });
});
