import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectDeno, denoFormSuffix } from "../src/pass1/manifest/deno.js";

describe("detectDeno", () => {
  it("returns null without deno.json[c]", () => {
    expect(detectDeno(mkdtempSync(join(tmpdir(), "anat-d-")))).toBeNull();
  });

  it("detects deno.json", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-d-"));
    writeFileSync(join(root, "deno.json"), '{"name":"@scope/x","exports":"./mod.ts"}');
    expect(detectDeno(root)?.kind).toBe("deno");
  });

  it("detects deno.jsonc with comments", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-d-"));
    writeFileSync(join(root, "deno.jsonc"), '// pkg config\n{"name":"x"} // trailing');
    const r = detectDeno(root);
    expect(r?.kind).toBe("deno");
    expect(((r?.parsed as { parsed: { name: string } }).parsed).name).toBe("x");
  });
});

describe("denoFormSuffix", () => {
  it("hono import → service", () => {
    expect(denoFormSuffix({ parsed: { imports: { hono: "https://deno.land/x/hono/mod.ts" } } })).toBe("service");
  });

  it("oak import → service", () => {
    expect(denoFormSuffix({ parsed: { imports: { oak: "jsr:@oak/oak@17" } } })).toBe("service");
  });

  it("bin field → cli-tool", () => {
    expect(denoFormSuffix({ parsed: { name: "x", bin: { mycli: "./main.ts" } } })).toBe("cli-tool");
  });

  it("workspace-style with deno run tasks → library (deno-std regression)", () => {
    // deno-std has many `deno run ./_tools/...` tasks for build/lint
    // but is itself a library workspace. Pre-fix the tasks-trigger
    // misclassified it as cli-tool.
    const parsed = {
      tasks: { test: "deno test -A", "lint:tools-types": "deno run -A _tools/check.ts" },
    };
    expect(denoFormSuffix({ parsed })).toBe("library");
  });
});
