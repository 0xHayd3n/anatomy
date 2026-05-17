import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectNim, nimFormSuffix } from "../src/pass1/manifest/nim.js";

describe("detectNim", () => {
  it("returns null without .nimble", () => {
    expect(detectNim(mkdtempSync(join(tmpdir(), "anat-nim-")))).toBeNull();
  });

  it("detects *.nimble at root", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-nim-"));
    writeFileSync(join(root, "myproject.nimble"), "version = \"0.1.0\"\nauthor = \"x\"\n");
    expect(detectNim(root)?.kind).toBe("nim");
  });
});

describe("nimFormSuffix", () => {
  it("requires \"jester ...\" → service", () => {
    expect(nimFormSuffix({ content: 'requires "nim >= 1.0"\nrequires "jester >= 0.5"', packageName: "myapp" })).toBe("service");
  });

  it("requires \"httpbeast ...\" → service", () => {
    expect(nimFormSuffix({ content: 'requires "httpbeast >= 0.4"', packageName: "myapp" })).toBe("service");
  });

  it("bin = @[\"x\"] → cli-tool", () => {
    expect(nimFormSuffix({ content: "version = \"0.1\"\nbin = @[\"mycli\"]\n", packageName: "myapp" })).toBe("cli-tool");
  });

  it("plain library → library", () => {
    expect(nimFormSuffix({ content: "version = \"0.1\"\nauthor = \"x\"\n", packageName: "myapp" })).toBe("library");
  });

  it("self-name disqualifier: jester.nimble (jester IS the framework) → library", () => {
    // jester.nimble itself has `requires \"httpbeast >= 0.4.0\"` — pre-fix
    // would match as service. The package IS the web framework, not a
    // service that uses it. Same class as compojure → library fix.
    const content = `version = "0.6.0"\nrequires "nim >= 1.0.0"\nrequires "httpbeast >= 0.4.0"`;
    expect(nimFormSuffix({ content, packageName: "jester" })).toBe("library");
  });
});
