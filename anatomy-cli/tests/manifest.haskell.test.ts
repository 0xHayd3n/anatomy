import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectHaskell, haskellFormSuffix } from "../src/pass1/manifest/haskell.js";

describe("detectHaskell", () => {
  it("returns null without .cabal or stack.yaml", () => {
    expect(detectHaskell(mkdtempSync(join(tmpdir(), "anat-hs-")))).toBeNull();
  });

  it("detects *.cabal at root", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-hs-"));
    writeFileSync(join(root, "myproject.cabal"), "name: myproject\nversion: 0.1.0.0\n");
    expect(detectHaskell(root)?.kind).toBe("haskell");
  });

  it("detects stack.yaml alone", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-hs-"));
    writeFileSync(join(root, "stack.yaml"), "resolver: lts-22.0\n");
    expect(detectHaskell(root)?.kind).toBe("haskell");
  });

  it("detects cabal.project alone (multi-package Cabal — emanote regression)", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-hs-"));
    writeFileSync(join(root, "cabal.project"), "packages: ./pkg-a ./pkg-b\n");
    expect(detectHaskell(root)?.kind).toBe("haskell");
  });
});

describe("haskellFormSuffix", () => {
  it("executable stanza → cli-tool", () => {
    const cabal = "name: hpack\nversion: 0.36\n\nexecutable hpack\n  main-is: Main.hs\n";
    expect(haskellFormSuffix({ cabalContent: cabal, hasStackYaml: true })).toBe("cli-tool");
  });

  it("only library stanza → library", () => {
    const cabal = "name: mylib\nversion: 0.1\n\nlibrary\n  exposed-modules: My\n";
    expect(haskellFormSuffix({ cabalContent: cabal, hasStackYaml: false })).toBe("library");
  });

  it("no .cabal content (stack-only) → library default", () => {
    expect(haskellFormSuffix({ cabalContent: "", hasStackYaml: true })).toBe("library");
  });
});
