import { describe, it, expect } from "vitest";
import { deriveInterface, extractSignature } from "../src/pass1/interface.js";
import type { DetectedManifest } from "../src/types.js";

const npm = (parsed: object): DetectedManifest => ({ kind: "npm", path: "", parsed });

describe("deriveInterface", () => {
  it("cli form + string bin → one subcommand", () => {
    const r = deriveInterface(npm({ name: "my-tool", bin: "./cli.js" }), "javascript-cli-tool");
    expect(r?.variant).toBe("subcommands");
    if (r?.variant === "subcommands") {
      expect(r.entries).toEqual([{ name: "my-tool", summary: "TODO describe subcommand", isPlaceholder: true }]);
    }
  });

  it("cli form + object bin → one entry per key", () => {
    const r = deriveInterface(npm({ bin: { foo: "./foo.js", bar: "./bar.js" } }), "javascript-cli-tool");
    if (r?.variant === "subcommands") {
      expect(r.entries.map(e => e.name).sort()).toEqual(["bar", "foo"]);
    }
  });

  it("strips scope from package name", () => {
    const r = deriveInterface(npm({ name: "@scope/my-tool", bin: "./cli.js" }), "javascript-cli-tool");
    if (r?.variant === "subcommands") {
      expect(r.entries[0].name).toBe("my-tool");
    }
  });

  it("library form + string exports → one namespace export", () => {
    const r = deriveInterface(npm({ exports: "./index.js" }), "typescript-library");
    expect(r?.variant).toBe("exports");
    if (r?.variant === "exports") {
      expect(r.entries[0]).toMatchObject({ symbol: ".", kind: "namespace" });
    }
  });

  it("library form + object exports → one entry per key with kind by path shape", () => {
    const r = deriveInterface(npm({ exports: { ".": "./i.js", "./util": "./u.js" } }), "typescript-library");
    if (r?.variant === "exports") {
      expect(r.entries).toEqual([
        { symbol: ".", kind: "namespace", summary: "TODO describe export", isPlaceholder: true },
        { symbol: "./util", kind: "function", summary: "TODO describe export", isPlaceholder: true },
      ]);
    }
  });

  it("library form + only main → namespace export", () => {
    const r = deriveInterface(npm({ main: "./index.js" }), "typescript-library");
    if (r?.variant === "exports") {
      expect(r.entries[0]).toMatchObject({ symbol: ".", kind: "namespace" });
    }
  });

  it("undefined when no bin and no exports/main", () => {
    expect(deriveInterface(npm({ name: "x" }), "javascript-cli-tool")).toBeUndefined();
  });

  it("undefined for cargo/python/go in v0.1", () => {
    const m: DetectedManifest = { kind: "cargo", path: "", parsed: { bin: [{ name: "x" }] } };
    expect(deriveInterface(m, "rust-cli-tool")).toBeUndefined();
  });

  it("undefined for null manifest", () => {
    expect(deriveInterface(null, "todo-form")).toBeUndefined();
  });

  it("undefined when form matches neither cli nor library", () => {
    expect(deriveInterface(npm({ bin: "./x" }), "todo-form")).toBeUndefined();
  });
});

describe("extractSignature", () => {
  it("extracts a function signature from a single-line export", () => {
    const line = `export function runPass1(opts: RunPass1Opts): Promise<Pass1Result> {`;
    expect(extractSignature(line, "function")).toBe("(opts: RunPass1Opts): Promise<Pass1Result>");
  });

  it("extracts a type alias RHS from a single-line export", () => {
    const line = `export type Pass1Result = { identity: IdentityResult };`;
    expect(extractSignature(line, "type")).toBe("{ identity: IdentityResult }");
  });

  it("returns undefined for a multi-line function (no closing paren on line)", () => {
    const line = `export function foo(`;
    expect(extractSignature(line, "function")).toBeUndefined();
  });

  it("returns undefined when kind is not function or type", () => {
    const line = `export class Foo {`;
    expect(extractSignature(line, "class")).toBeUndefined();
  });

  it("returns undefined when signature exceeds 200 chars", () => {
    // "(aaa...193): void" = 1+193+8 = 202 chars > 200
    const longSig = "a".repeat(193);
    const line = `export function foo(${longSig}): void {`;
    expect(extractSignature(line, "function")).toBeUndefined();
  });

  it("returns undefined for a type with no = sign", () => {
    expect(extractSignature(`export type Foo`, "type")).toBeUndefined();
  });

  it("strips leading = and whitespace from a type alias", () => {
    const line = `export type Foo = string | number;`;
    expect(extractSignature(line, "type")).toBe("string | number");
  });
});
