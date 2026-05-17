import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectR, rFormSuffix } from "../src/pass1/manifest/r.js";

describe("detectR", () => {
  it("returns null without DESCRIPTION", () => {
    expect(detectR(mkdtempSync(join(tmpdir(), "anat-r-")))).toBeNull();
  });

  it("detects DESCRIPTION with Package: header", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-r-"));
    writeFileSync(join(root, "DESCRIPTION"), "Package: dplyr\nVersion: 1.1.4\nType: Package\n");
    expect(detectR(root)?.kind).toBe("r");
  });

  it("returns null when DESCRIPTION lacks Package: header (not an R package)", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-r-"));
    writeFileSync(join(root, "DESCRIPTION"), "Some random file\nThat happens to be named DESCRIPTION\n");
    expect(detectR(root)).toBeNull();
  });
});

describe("rFormSuffix", () => {
  it("shiny in Imports → service", () => {
    expect(rFormSuffix({ content: "Package: myapp\nImports: shiny, dplyr\n" })).toBe("service");
  });

  it("plain package → library", () => {
    expect(rFormSuffix({ content: "Package: dplyr\nImports: rlang, tibble\n" })).toBe("library");
  });
});
