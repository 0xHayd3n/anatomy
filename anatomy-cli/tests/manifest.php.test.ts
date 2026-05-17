import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectPhp, phpFormSuffix } from "../src/pass1/manifest/php.js";

describe("detectPhp", () => {
  it("returns null when composer.json is absent", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-php-"));
    expect(detectPhp(root)).toBeNull();
  });

  it("detects composer.json", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-php-"));
    writeFileSync(join(root, "composer.json"), '{"name":"x/y","require":{"php":"^8.2"}}');
    expect(detectPhp(root)?.kind).toBe("php");
  });

  it("tolerates malformed composer.json", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-php-"));
    writeFileSync(join(root, "composer.json"), "{not valid json");
    expect(detectPhp(root)?.kind).toBe("php");
  });
});

describe("phpFormSuffix", () => {
  it("Laravel framework → service", () => {
    expect(phpFormSuffix({ parsed: { require: { "laravel/framework": "^11.0" } } })).toBe("service");
  });

  it("Symfony framework-bundle → service", () => {
    expect(phpFormSuffix({ parsed: { require: { "symfony/framework-bundle": "^7" } } })).toBe("service");
  });

  it("composer bin field → cli-tool", () => {
    expect(phpFormSuffix({ parsed: { bin: ["bin/mycli"] } })).toBe("cli-tool");
  });

  it("default → library", () => {
    expect(phpFormSuffix({ parsed: { require: { "psr/log": "^3" } } })).toBe("library");
  });
});
