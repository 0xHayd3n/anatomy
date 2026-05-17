import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectGleam, gleamFormSuffix } from "../src/pass1/manifest/gleam.js";

describe("detectGleam", () => {
  it("returns null without gleam.toml", () => {
    expect(detectGleam(mkdtempSync(join(tmpdir(), "anat-g-")))).toBeNull();
  });

  it("detects gleam.toml", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-g-"));
    writeFileSync(join(root, "gleam.toml"), 'name = "my_app"\nversion = "1.0.0"\n');
    expect(detectGleam(root)?.kind).toBe("gleam");
  });
});

describe("gleamFormSuffix", () => {
  it("wisp dep → service", () => {
    expect(gleamFormSuffix({ parsed: { dependencies: { wisp: "1.0" } } })).toBe("service");
  });

  it("gleam_http dep → service", () => {
    expect(gleamFormSuffix({ parsed: { dependencies: { gleam_http: "3.0" } } })).toBe("service");
  });

  it("plain → library", () => {
    expect(gleamFormSuffix({ parsed: { dependencies: { gleam_stdlib: "0.30" } } })).toBe("library");
  });
});
