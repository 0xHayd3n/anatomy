import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectPerl, perlFormSuffix } from "../src/pass1/manifest/perl.js";

describe("detectPerl", () => {
  it("returns null without any manifest", () => {
    expect(detectPerl(mkdtempSync(join(tmpdir(), "anat-perl-")))).toBeNull();
  });

  it("detects cpanfile", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-perl-"));
    writeFileSync(join(root, "cpanfile"), "requires 'Test::More' => '0.99';");
    expect(detectPerl(root)?.kind).toBe("perl");
  });

  it("detects Makefile.PL", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-perl-"));
    writeFileSync(join(root, "Makefile.PL"), "use ExtUtils::MakeMaker;\nWriteMakefile(NAME => 'My::Module');");
    expect(detectPerl(root)?.kind).toBe("perl");
  });

  it("detects dist.ini (Dist::Zilla)", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-perl-"));
    writeFileSync(join(root, "dist.ini"), "name = My-Module\nversion = 1.0\n");
    expect(detectPerl(root)?.kind).toBe("perl");
  });
});

describe("perlFormSuffix", () => {
  it("Mojolicious → service", () => {
    expect(perlFormSuffix({ cpanfileContent: "requires 'Mojolicious';", makefilePLContent: "", distIniContent: "" })).toBe("service");
  });

  it("Dancer2 → service", () => {
    expect(perlFormSuffix({ cpanfileContent: "requires 'Dancer2';", makefilePLContent: "", distIniContent: "" })).toBe("service");
  });

  it("plain Test::More dep → library", () => {
    expect(perlFormSuffix({ cpanfileContent: "requires 'Test::More';", makefilePLContent: "", distIniContent: "" })).toBe("library");
  });
});
