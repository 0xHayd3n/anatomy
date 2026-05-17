import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectLua, luaFormSuffix } from "../src/pass1/manifest/lua.js";

describe("detectLua", () => {
  it("returns null without rockspec or .lua files", () => {
    expect(detectLua(mkdtempSync(join(tmpdir(), "anat-lua-")))).toBeNull();
  });

  it("detects *.rockspec at root", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-lua-"));
    writeFileSync(join(root, "mygem-1.0-1.rockspec"), 'package = "mygem"');
    expect(detectLua(root)?.kind).toBe("lua");
  });

  it("detects rockspec in rockspecs/ subdir (middleclass shape)", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-lua-"));
    mkdirSync(join(root, "rockspecs"));
    writeFileSync(join(root, "rockspecs", "middleclass-4.1-1.rockspec"), 'package = "middleclass"');
    expect(detectLua(root)?.kind).toBe("lua");
  });

  it("loose-Lua fallback: 1+ .lua at root → lua", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-lua-"));
    writeFileSync(join(root, "middleclass.lua"), "-- ...");
    expect(detectLua(root)?.kind).toBe("lua");
  });
});

describe("luaFormSuffix", () => {
  it("lapis dep → service", () => {
    expect(luaFormSuffix({ rockspecContent: 'dependencies = { "lapis >= 1.0" }' })).toBe("service");
  });

  it("plain rockspec → library", () => {
    expect(luaFormSuffix({ rockspecContent: 'package = "x"' })).toBe("library");
  });

  it("no rockspec content (loose-lua fallback) → library", () => {
    expect(luaFormSuffix({})).toBe("library");
  });
});
