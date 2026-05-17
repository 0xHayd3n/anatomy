import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectDart, dartFormSuffix } from "../src/pass1/manifest/dart.js";

describe("detectDart", () => {
  it("returns null without pubspec.yaml", () => {
    expect(detectDart(mkdtempSync(join(tmpdir(), "anat-d-")))).toBeNull();
  });

  it("detects pubspec.yaml", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-d-"));
    writeFileSync(join(root, "pubspec.yaml"), "name: x\nversion: 1.0.0\n");
    expect(detectDart(root)?.kind).toBe("dart");
  });
});

describe("dartFormSuffix", () => {
  it("flutter: section → desktop-app", () => {
    expect(dartFormSuffix({ content: "name: my_app\nflutter:\n  uses-material-design: true\n" })).toBe("desktop-app");
  });

  it("executables: section → cli-tool", () => {
    expect(dartFormSuffix({ content: "name: tool\nexecutables:\n  tool:\n" })).toBe("cli-tool");
  });

  it("plain pubspec → library", () => {
    expect(dartFormSuffix({ content: "name: x\nversion: 1.0.0\n" })).toBe("library");
  });
});
