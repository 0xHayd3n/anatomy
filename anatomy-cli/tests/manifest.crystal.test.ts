import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectCrystal, crystalFormSuffix } from "../src/pass1/manifest/crystal.js";

describe("detectCrystal", () => {
  it("returns null without shard.yml", () => {
    expect(detectCrystal(mkdtempSync(join(tmpdir(), "anat-cr-")))).toBeNull();
  });

  it("detects shard.yml", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-cr-"));
    writeFileSync(join(root, "shard.yml"), "name: x\nversion: 1.0.0\n");
    expect(detectCrystal(root)?.kind).toBe("crystal");
  });
});

describe("crystalFormSuffix", () => {
  it("kemal dep → service", () => {
    expect(crystalFormSuffix({ content: "name: app\ndependencies:\n  kemal:\n    github: kemalcr/kemal\n" })).toBe("service");
  });

  it("targets: section → cli-tool", () => {
    expect(crystalFormSuffix({ content: "name: app\ntargets:\n  app:\n    main: src/app.cr\n" })).toBe("cli-tool");
  });

  it("plain shard → library", () => {
    expect(crystalFormSuffix({ content: "name: x\nversion: 1.0.0\n" })).toBe("library");
  });

  it("self-name disqualifier: name: kemal IS the framework → library", () => {
    // kemal's own shard.yml has `name: kemal` and depends on `radix`. The
    // top-level `name:` matching a framework slug means this package IS
    // the framework, not a service that uses it.
    const content = "name: kemal\nversion: 1.11.0\ndependencies:\n  radix:\n    github: luislavena/radix\n";
    expect(crystalFormSuffix({ content })).toBe("library");
  });
});
