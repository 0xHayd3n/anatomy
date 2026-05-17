import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectGithubAction, githubActionFormSuffix } from "../src/pass1/manifest/github-action.js";

describe("detectGithubAction", () => {
  it("returns null without action.yml/action.yaml", () => {
    expect(detectGithubAction(mkdtempSync(join(tmpdir(), "anat-gha-")))).toBeNull();
  });

  it("detects action.yml with runs:", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-gha-"));
    writeFileSync(join(root, "action.yml"), "name: My Action\nruns:\n  using: composite\n  steps:\n    - run: echo hi\n");
    expect(detectGithubAction(root)?.kind).toBe("github-action");
  });

  it("detects action.yaml (alternate extension)", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-gha-"));
    writeFileSync(join(root, "action.yaml"), "name: x\nruns:\n  using: docker\n  image: Dockerfile\n");
    expect(detectGithubAction(root)?.kind).toBe("github-action");
  });

  it("returns null when action.yml lacks runs: (could be unrelated YAML)", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-gha-"));
    writeFileSync(join(root, "action.yml"), "name: x\ndescription: y\n");
    expect(detectGithubAction(root)).toBeNull();
  });
});

describe("githubActionFormSuffix", () => {
  it("always library (actions are reusable workflow components)", () => {
    expect(githubActionFormSuffix({})).toBe("library");
  });
});
