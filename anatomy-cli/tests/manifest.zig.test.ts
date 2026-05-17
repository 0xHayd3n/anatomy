import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectZig, zigFormSuffix } from "../src/pass1/manifest/zig.js";

describe("detectZig", () => {
  it("returns null without build.zig", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-zig-"));
    expect(detectZig(root)).toBeNull();
  });

  it("detects build.zig", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-zig-"));
    writeFileSync(join(root, "build.zig"), "pub fn build(b: *std.Build) void {}");
    expect(detectZig(root)?.kind).toBe("zig");
  });

  it("detects build.zig.zon alone", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-zig-"));
    writeFileSync(join(root, "build.zig.zon"), ".{ .name = \"x\" }");
    expect(detectZig(root)?.kind).toBe("zig");
  });
});

describe("zigFormSuffix", () => {
  it("addExecutable → cli-tool", () => {
    expect(zigFormSuffix({ content: "const exe = b.addExecutable(.{ .name = \"x\" });", hasZon: true })).toBe("cli-tool");
  });

  it("only addModule → library", () => {
    expect(zigFormSuffix({ content: "const lib = b.addModule(\"x\", .{});", hasZon: true })).toBe("library");
  });
});
