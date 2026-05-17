import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectHelm, helmFormSuffix } from "../src/pass1/manifest/helm.js";

describe("detectHelm", () => {
  it("returns null without Chart.yaml", () => {
    expect(detectHelm(mkdtempSync(join(tmpdir(), "anat-helm-")))).toBeNull();
  });

  it("detects Chart.yaml with apiVersion + name", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-helm-"));
    writeFileSync(join(root, "Chart.yaml"), "apiVersion: v2\nname: my-app\nversion: 0.1.0\n");
    expect(detectHelm(root)?.kind).toBe("helm");
  });

  it("returns null when Chart.yaml lacks apiVersion (could be other tooling)", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-helm-"));
    writeFileSync(join(root, "Chart.yaml"), "some_other_field: value\n");
    expect(detectHelm(root)).toBeNull();
  });
});

describe("helmFormSuffix", () => {
  it("always library (charts are reusable definitions)", () => {
    expect(helmFormSuffix({})).toBe("library");
  });
});
