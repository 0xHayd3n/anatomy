import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectCargo } from "../src/pass1/manifest/cargo.js";

describe("detectCargo", () => {
  it("returns null when no Cargo.toml exists", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-cargo-"));
    expect(detectCargo(root)).toBeNull();
  });

  it("returns DetectedManifest when Cargo.toml exists", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-cargo-"));
    writeFileSync(join(root, "Cargo.toml"), `[package]\nname = "x"\nversion = "1.0.0"\nedition = "2021"\n`);
    const result = detectCargo(root);
    expect(result?.kind).toBe("cargo");
    expect(result?.path).toBe(join(root, "Cargo.toml"));
    const pkg = (result?.parsed as { package: { name: string } }).package;
    expect(pkg.name).toBe("x");
  });
});
