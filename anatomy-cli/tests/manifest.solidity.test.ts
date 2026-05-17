import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectSolidity, solidityFormSuffix } from "../src/pass1/manifest/solidity.js";
import { detectManifest } from "../src/pass1/manifest/index.js";

describe("detectSolidity", () => {
  it("returns null without any solidity config", () => {
    expect(detectSolidity(mkdtempSync(join(tmpdir(), "anat-sol-")))).toBeNull();
  });

  it("detects foundry.toml", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-sol-"));
    writeFileSync(join(root, "foundry.toml"), '[profile.default]\nsrc = "src"\n');
    const r = detectSolidity(root);
    expect(r?.kind).toBe("solidity");
    expect((r?.parsed as { configKind: string }).configKind).toBe("foundry");
  });

  it("detects hardhat.config.ts", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-sol-"));
    writeFileSync(join(root, "hardhat.config.ts"), 'export default {};');
    expect(detectSolidity(root)?.kind).toBe("solidity");
  });

  it("detects hardhat.config.js / .cjs / .mjs", () => {
    for (const ext of ["js", "cjs", "mjs"] as const) {
      const root = mkdtempSync(join(tmpdir(), "anat-sol-"));
      writeFileSync(join(root, `hardhat.config.${ext}`), "module.exports = {};");
      expect(detectSolidity(root)?.kind).toBe("solidity");
    }
  });
});

describe("detectManifest polyglot: Solidity wins over npm", () => {
  it("OpenZeppelin-shape: real package.json + foundry.toml → solidity", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-sol-"));
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "@openzeppelin/contracts", main: "./index.js" }));
    writeFileSync(join(root, "foundry.toml"), '[profile.default]\nsrc = "contracts"\n');
    expect(detectManifest(root)?.kind).toBe("solidity");
  });

  it("hardhat-only project + package.json → solidity", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-sol-"));
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "x", main: "index.js" }));
    writeFileSync(join(root, "hardhat.config.js"), "module.exports = {};");
    expect(detectManifest(root)?.kind).toBe("solidity");
  });
});

describe("solidityFormSuffix", () => {
  it("always library (smart contracts are libraries for other contracts)", () => {
    expect(solidityFormSuffix({ configKind: "foundry" })).toBe("library");
    expect(solidityFormSuffix({ configKind: "hardhat" })).toBe("library");
    expect(solidityFormSuffix(undefined)).toBe("library");
  });
});
