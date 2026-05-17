import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectTerraform, terraformFormSuffix } from "../src/pass1/manifest/terraform.js";

describe("detectTerraform", () => {
  it("returns null without *.tf files", () => {
    expect(detectTerraform(mkdtempSync(join(tmpdir(), "anat-tf-")))).toBeNull();
  });

  it("detects main.tf at root", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-tf-"));
    writeFileSync(join(root, "main.tf"), 'resource "aws_vpc" "main" {}');
    const r = detectTerraform(root);
    expect(r?.kind).toBe("terraform");
    expect(r?.path).toBe(join(root, "main.tf"));
  });

  it("detects multi-file terraform module (variables.tf, outputs.tf, etc.)", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-tf-"));
    writeFileSync(join(root, "variables.tf"), "variable \"name\" {}");
    writeFileSync(join(root, "outputs.tf"), "output \"id\" {}");
    writeFileSync(join(root, "main.tf"), "resource \"x\" \"y\" {}");
    const r = detectTerraform(root);
    expect(r?.kind).toBe("terraform");
    // Prefers main.tf when present.
    expect(r?.path).toBe(join(root, "main.tf"));
  });

  it("falls back to first alphabetical .tf when no main.tf", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-tf-"));
    writeFileSync(join(root, "variables.tf"), "");
    writeFileSync(join(root, "outputs.tf"), "");
    const r = detectTerraform(root);
    expect(r?.path).toBe(join(root, "outputs.tf"));
  });
});

describe("terraformFormSuffix", () => {
  it("always library (terraform modules are reusable definitions)", () => {
    expect(terraformFormSuffix({ rootTfFiles: ["main.tf"] })).toBe("library");
    expect(terraformFormSuffix(undefined)).toBe("library");
  });
});
