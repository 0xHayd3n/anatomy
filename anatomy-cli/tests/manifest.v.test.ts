import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectV, vFormSuffix } from "../src/pass1/manifest/v.js";

describe("detectV", () => {
  it("returns null without v.mod", () => {
    expect(detectV(mkdtempSync(join(tmpdir(), "anat-v-")))).toBeNull();
  });

  it("detects v.mod", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-v-"));
    writeFileSync(join(root, "v.mod"), 'Module {\n  name: "myproject"\n  version: "0.1.0"\n}\n');
    expect(detectV(root)?.kind).toBe("v");
  });
});

describe("vFormSuffix", () => {
  it("vweb dep → service", () => {
    expect(vFormSuffix({ content: "dependencies = ['vweb']" })).toBe("service");
  });

  it("plain → library", () => {
    expect(vFormSuffix({ content: "Module { name: 'x' }" })).toBe("library");
  });
});
