import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectRuby, rubyFormSuffix } from "../src/pass1/manifest/ruby.js";

describe("detectRuby", () => {
  it("returns null when no manifest exists", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-rb-"));
    expect(detectRuby(root)).toBeNull();
  });

  it("detects Gemfile alone", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-rb-"));
    writeFileSync(join(root, "Gemfile"), "source 'https://rubygems.org'\ngem 'rake'\n");
    const r = detectRuby(root);
    expect(r?.kind).toBe("ruby");
    expect((r?.parsed as { hasGemfile: boolean }).hasGemfile).toBe(true);
  });

  it("detects bare *.gemspec without Gemfile", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-rb-"));
    writeFileSync(join(root, "mygem.gemspec"), "Gem::Specification.new do |s| ... end");
    const r = detectRuby(root);
    expect(r?.kind).toBe("ruby");
    expect((r?.parsed as { hasGemspec: boolean }).hasGemspec).toBe(true);
  });
});

describe("detectRuby — tooling-only Gemfile demotion (isPrimary=false)", () => {
  it("Gemfile with only fastlane+cocoapods sets isPrimary=false (Alamofire-shape)", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-rb-"));
    writeFileSync(join(root, "Gemfile"),
      `source "https://rubygems.org"\ngem "fastlane"\ngem "cocoapods"\ngem "jazzy"\n`);
    const r = detectRuby(root);
    expect(r?.kind).toBe("ruby");
    expect(r?.isPrimary).toBe(false);
  });

  it("Gemfile with rake+rubocop alone is tooling-only too", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-rb-"));
    writeFileSync(join(root, "Gemfile"), `gem "rake"\ngem "rubocop"\n`);
    const r = detectRuby(root);
    expect(r?.isPrimary).toBe(false);
  });

  it("Gemfile with even one real Ruby app gem stays primary (default)", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-rb-"));
    writeFileSync(join(root, "Gemfile"), `gem "rails"\ngem "fastlane"\n`);
    const r = detectRuby(root);
    expect(r?.isPrimary).toBeUndefined();
  });

  it("Gemfile + sibling gemspec stays primary even when Gemfile is tooling-only", () => {
    // gemspec is the canonical signal of a publishable Ruby gem; presence of
    // tooling-only Gemfile does not demote.
    const root = mkdtempSync(join(tmpdir(), "anat-rb-"));
    writeFileSync(join(root, "Gemfile"), `gem "rake"\n`);
    writeFileSync(join(root, "mygem.gemspec"), `Gem::Specification.new {|s| s.name = "mygem"}`);
    const r = detectRuby(root);
    expect(r?.isPrimary).toBeUndefined();
  });

  it("comments after gem declarations are stripped before classification", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-rb-"));
    writeFileSync(join(root, "Gemfile"),
      `gem "fastlane" # CI tooling\ngem "cocoapods"  # iOS deps\n`);
    const r = detectRuby(root);
    expect(r?.isPrimary).toBe(false);
  });

  it("empty Gemfile (no gem declarations) is NOT classified as tooling-only", () => {
    // Conservative: zero declarations means we have no signal either way;
    // keep it primary so the existing detect-order behavior wins.
    const root = mkdtempSync(join(tmpdir(), "anat-rb-"));
    writeFileSync(join(root, "Gemfile"), `source "https://rubygems.org"\n# no gems yet\n`);
    const r = detectRuby(root);
    expect(r?.isPrimary).toBeUndefined();
  });
});

describe("rubyFormSuffix", () => {
  it("Rails dep → service", () => {
    expect(rubyFormSuffix({ gemfileContent: "gem 'rails', '~> 7'", hasGemfile: true, hasGemspec: false })).toBe("service");
  });

  it("Sinatra dep → service", () => {
    expect(rubyFormSuffix({ gemfileContent: 'gem "sinatra"', hasGemfile: true, hasGemspec: false })).toBe("service");
  });

  it("plain Gemfile with no service framework → library", () => {
    expect(rubyFormSuffix({ gemfileContent: "gem 'rake'", hasGemfile: true, hasGemspec: false })).toBe("library");
  });

  it("self-name disqualifier: gemspec with s.name='sinatra' → library", () => {
    const r = rubyFormSuffix({
      gemfileContent: "source 'https://rubygems.org'\ngemspec\ngem 'rake'\n",
      gemspecContent: "Gem::Specification.new do |s|\n  s.name = 'sinatra'\n  s.version = '4.0'\nend",
      hasGemfile: true,
      hasGemspec: true,
    });
    expect(r).toBe("library");
  });

  it("self-name disqualifier: positional Gem::Specification.new 'sinatra' → library (sinatra.gemspec shape)", () => {
    // Sinatra's actual gemspec uses positional first-arg name:
    //   Gem::Specification.new 'sinatra', version do |s| ... end
    // Pre-fix this didn't match the s.name=NAME pattern.
    const gemspec = `version = File.read('VERSION').strip\nGem::Specification.new 'sinatra', version do |s|\n  s.summary = 'web framework'\nend`;
    const r = rubyFormSuffix({
      gemfileContent: "source 'https://rubygems.org'\ngemspec\ngem 'rake'\n",
      gemspecContent: gemspec,
      hasGemfile: true,
      hasGemspec: true,
    });
    expect(r).toBe("library");
  });
});
