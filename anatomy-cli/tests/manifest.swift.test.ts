import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectSwift, swiftFormSuffix } from "../src/pass1/manifest/swift.js";

describe("detectSwift", () => {
  it("returns null without Package.swift", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-sw-"));
    expect(detectSwift(root)).toBeNull();
  });

  it("detects Package.swift", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-sw-"));
    writeFileSync(join(root, "Package.swift"), "// swift-tools-version: 5.9\nimport PackageDescription");
    expect(detectSwift(root)?.kind).toBe("swift");
  });
});

describe("swiftFormSuffix", () => {
  it("library product → library (swift-argument-parser regression)", () => {
    const content = `
let package = Package(
  name: "swift-argument-parser",
  products: [
    .library(name: "ArgumentParser", targets: ["ArgumentParser"]),
  ],
  targets: [
    .target(name: "ArgumentParser"),
    .executableTarget(name: "math-example"),
    .executableTarget(name: "roll-example"),
  ]
)`;
    expect(swiftFormSuffix({ content })).toBe("library");
  });

  it("only executable products → cli-tool", () => {
    const content = `
products: [
  .executable(name: "mycli", targets: ["mycli"]),
],
targets: [
  .executableTarget(name: "mycli"),
]`;
    expect(swiftFormSuffix({ content })).toBe("cli-tool");
  });

  it("no products block, only executableTarget → cli-tool fallback", () => {
    expect(swiftFormSuffix({ content: ".executableTarget(name: \"x\")" })).toBe("cli-tool");
  });

  it("no products block, only target → library", () => {
    expect(swiftFormSuffix({ content: ".target(name: \"x\")" })).toBe("library");
  });
});
