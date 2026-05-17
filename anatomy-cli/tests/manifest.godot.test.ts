import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectGodot, godotFormSuffix } from "../src/pass1/manifest/godot.js";

describe("detectGodot", () => {
  it("returns null without project.godot", () => {
    expect(detectGodot(mkdtempSync(join(tmpdir(), "anat-godot-")))).toBeNull();
  });

  it("detects project.godot", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-godot-"));
    writeFileSync(join(root, "project.godot"), 'config_version=5\n[application]\nconfig/name="My Game"\n');
    expect(detectGodot(root)?.kind).toBe("godot");
  });
});

describe("godotFormSuffix", () => {
  it("always desktop-app (Godot games are conventionally GUI/desktop)", () => {
    expect(godotFormSuffix({})).toBe("desktop-app");
  });
});
