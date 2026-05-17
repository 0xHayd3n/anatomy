import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { canonicalize, hash, canonicalHash } from "../src/canonical.js";

const CASES_PATH = resolve(import.meta.dirname, "../../fixtures/canonicalization-cases.json");
const cases = JSON.parse(readFileSync(CASES_PATH, "utf8")) as {
  valid: Array<{ input: string; canonical: string; expected_hash: string }>;
  invalid: Array<{ input: string; reason: string }>;
};

describe("canonicalize", () => {
  for (const c of cases.valid) {
    it(`canonicalizes ${JSON.stringify(c.input)} → ${JSON.stringify(c.canonical)}`, () => {
      expect(canonicalize(c.input)).toBe(c.canonical);
    });
  }
  for (const c of cases.invalid) {
    it(`rejects ${JSON.stringify(c.input)} (${c.reason})`, () => {
      expect(canonicalize(c.input)).toBeNull();
    });
  }
});

describe("hash", () => {
  for (const c of cases.valid) {
    it(`hashes ${JSON.stringify(c.canonical)} → ${c.expected_hash}`, () => {
      expect(hash(c.canonical)).toBe(c.expected_hash);
    });
  }
  it("throws when called on non-canonical input", () => {
    expect(() => hash("Rust")).toThrow();
  });
});

describe("canonicalHash", () => {
  for (const c of cases.valid) {
    it(`canonicalHashes ${JSON.stringify(c.input)} → ${c.expected_hash}`, () => {
      expect(canonicalHash(c.input)).toBe(c.expected_hash);
    });
  }
  it("returns null when canonicalization fails", () => {
    expect(canonicalHash("C++")).toBeNull();
  });
});
