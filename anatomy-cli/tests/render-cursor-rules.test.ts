import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderCursorRulesArtifact } from "../src/render/cursor-rules.js";
import { runPass1 } from "../src/pass1/index.js";

const PINNED = "2026-05-13T14:00:00.000Z";

beforeEach(() => { process.env.ANATOMY_GENERATED_AT = PINNED; });
afterEach(() => { delete process.env.ANATOMY_GENERATED_AT; });

function minimalAnatomy() {
  const root = mkdtempSync(join(tmpdir(), "anat-cursor-rules-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({
    name: "my-tiny-lib",
    description: "A tiny utility library.",
    scripts: { build: "tsc" },
    engines: { node: ">=20" },
  }));
  mkdirSync(join(root, "src"));
  return runPass1(root);
}

describe("renderCursorRulesArtifact", () => {
  it("emits .cursorrules as the path", () => {
    const r = minimalAnatomy();
    const out = renderCursorRulesArtifact(r, {});
    expect(out.path).toBe(".cursorrules");
  });

  it("emits the shared markdown body (banner + title)", () => {
    const r = minimalAnatomy();
    r.commit = "abc123f";
    const out = renderCursorRulesArtifact(r, {});
    expect(out.content).toMatch(/Regenerated from `\.anatomy` at commit `abc123f`/);
    expect(out.content).toMatch(/^# \S+ \S+ · \S+ · \S+/m);
  });
});
