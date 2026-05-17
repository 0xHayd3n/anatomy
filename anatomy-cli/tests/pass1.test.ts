import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPass1 } from "../src/pass1/index.js";

describe("runPass1 — end-to-end", () => {
  it("typescript library: derives stack=typescript, form=typescript-library, structure entries, environment", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-p1-"));
    writeFileSync(join(root, "package.json"), JSON.stringify({
      name: "my-tiny-lib",
      version: "1.0.0",
      description: "A tiny utility library.",
      main: "./dist/index.js",
      exports: { ".": "./dist/index.js" },
      scripts: { build: "tsc", test: "vitest" },
      engines: { node: ">=20" },
      dependencies: { "lodash-es": "^4" },
    }));
    writeFileSync(join(root, "tsconfig.json"), "{}");
    writeFileSync(join(root, "README.md"), "# my-tiny-lib\n\nA tiny utility library that does X.\n");
    mkdirSync(join(root, "src"));
    mkdirSync(join(root, "tests"));

    const r = runPass1(root);

    expect(r.identity.stack.id).toBe("typescript");
    expect(r.identity.form.id).toBe("typescript-library");
    expect(r.identity.domain.id).toBe("todo-domain");
    expect(r.tagline.value).toBe("A tiny utility library that does X.");
    expect(r.tagline.source).toBe("readme");
    expect(r.operation.commands).toEqual({ build: "tsc", test: "vitest" });
    expect(r.substance.keyDependencies).toEqual([
      { name: "lodash-es", why: "todo-why", isPlaceholder: true },
    ]);
    expect(r.structure.entries.map(e => e.path).sort()).toEqual(["src/", "tests/"]);
    expect(r.environment).toEqual({ languageVersion: ">=20", runtime: "node" });
    expect(r.interface?.variant).toBe("exports");
  });

  it("no manifest: produces all-placeholder identity", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-p1-"));
    const r = runPass1(root);
    expect(r.manifest).toBeNull();
    expect(r.identity.stack.id).toBe("todo-stack");
    expect(r.identity.form.id).toBe("todo-form");
  });

  it("respects ANATOMY_GENERATED_AT for reproducibility", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-p1-"));
    process.env.ANATOMY_GENERATED_AT = "2026-05-06T13:30:00.000Z";
    try {
      expect(runPass1(root).generatedAt).toBe("2026-05-06T13:30:00.000Z");
    } finally {
      delete process.env.ANATOMY_GENERATED_AT;
    }
  });

  it("typescript cli repo: src/commands/ files feed interface.subcommands", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-p1-"));
    writeFileSync(join(root, "package.json"), JSON.stringify({
      name: "my-cli",
      bin: { "my-cli": "./dist/index.js" },
    }));
    writeFileSync(join(root, "tsconfig.json"), "{}");
    const cmdDir = join(root, "src", "commands");
    mkdirSync(cmdDir, { recursive: true });
    writeFileSync(join(cmdDir, "build.ts"), "");
    writeFileSync(join(cmdDir, "test.ts"), "");

    const r = runPass1(root);
    expect(r.interface?.variant).toBe("subcommands");
    if (r.interface?.variant === "subcommands") {
      expect(r.interface.entries.map(e => e.name).sort()).toEqual(["build", "test"]);
    }
  });
});
