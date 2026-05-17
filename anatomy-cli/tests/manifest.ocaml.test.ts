import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectOcaml, ocamlFormSuffix } from "../src/pass1/manifest/ocaml.js";

describe("detectOcaml", () => {
  it("returns null without dune-project", () => {
    expect(detectOcaml(mkdtempSync(join(tmpdir(), "anat-ml-")))).toBeNull();
  });

  it("detects dune-project", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-ml-"));
    writeFileSync(join(root, "dune-project"), "(lang dune 3.0)\n(name myproject)\n");
    expect(detectOcaml(root)?.kind).toBe("ocaml");
  });
});

describe("ocamlFormSuffix", () => {
  it("default → library", () => {
    expect(ocamlFormSuffix({})).toBe("library");
  });
});
