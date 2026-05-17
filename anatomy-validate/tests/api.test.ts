import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { validate, ECOSYSTEM_VERSION } from "../src/index.js";
import type { AnatomyDoc } from "../src/index.js";

const minimalValidToml = `anatomy_version = "0.1"
description = "x"

[identity]
fingerprint = "a8fybpg4nh2b5vpw498v"

[identity.stack]
id = "rust"
hash = "a8fyb"

[identity.form]
id = "cli-tool"
hash = "pg4nh"

[identity.domain]
id = "web-publishing"
hash = "2b5vp"

[identity.function]
id = "markdown-to-static-html"
hash = "w498v"

[generated]
at = 2026-05-05T14:22:00Z
by = "x"
model = "x"
schema = "https://example.com"
`;

describe("validate (public API)", () => {
  it("returns ok:true with typed value for a valid file", async () => {
    const result = await validate(minimalValidToml);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const doc: AnatomyDoc = result.value;
      expect(doc.identity.stack.id).toBe("rust");
      expect(result.warnings).toEqual([]);
    }
  });

  it("returns ok:false with toml-parse-error on bad TOML", async () => {
    const result = await validate("this is = = invalid");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0].code).toBe("toml-parse-error");
    }
  });

  it("returns version-mismatch when expectedVersion mismatches", async () => {
    const result = await validate(minimalValidToml, { expectedVersion: "0.2" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const versionErr = result.errors.find(e => e.code === "version-mismatch");
      expect(versionErr).toBeDefined();
      expect(versionErr!.pointer).toBe("/anatomy_version");
      expect(versionErr!.expected).toBe("0.2");
      expect(versionErr!.actual).toBe("0.1");
    }
  });

  it("returns ok:true with description-too-long warning", async () => {
    const long = "x".repeat(600);
    const toml = minimalValidToml.replace(`description = "x"`, `description = """${long}"""`);
    const result = await validate(toml);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings.length).toBe(1);
      expect(result.warnings[0].code).toBe("description-too-long");
    }
  });

  it("repoRoot option does not affect a v0.1 file with no path-bearing fields", async () => {
    const result = await validate(minimalValidToml, { repoRoot: "/some/path" });
    expect(result.ok).toBe(true);
  });

  it("propagates structure-path-not-found through the public API for a v0.2 file", async () => {
    // Use fixture 07 — its [structure].entries lists src/store/, src/react/, tests/.
    // Create only src/store/ and tests/ in the temp root so src/react/ triggers the error.
    const root = mkdtempSync(join(tmpdir(), "anat-api-"));
    mkdirSync(join(root, "src", "store"), { recursive: true });
    mkdirSync(join(root, "tests"));
    const text = readFileSync(
      resolve(import.meta.dirname, "../../fixtures/valid/07-typescript-library-with-structure/input.anatomy"),
      "utf8",
    );
    const r = await validate(text, { repoRoot: root });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const missing = r.errors.find(e => e.code === "structure-path-not-found");
      expect(missing).toBeDefined();
      expect(missing?.actual).toBe("src/react/");
    }
  });

  it("collects multiple errors in one call", async () => {
    const broken = minimalValidToml
      .replace('hash = "a8fyb"', 'hash = "wrong"')
      .replace('fingerprint = "a8fybpg4nh2b5vpw498v"', 'fingerprint = "00000000000000000000"');
    const result = await validate(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const codes = result.errors.map(e => e.code).sort();
      expect(codes).toContain("hash-content-mismatch");
      expect(codes).toContain("fingerprint-mismatch");
    }
  });
});

describe("v0.3 surface", () => {
  it("exports ECOSYSTEM_VERSION = '0.3'", () => {
    expect(ECOSYSTEM_VERSION).toBe("0.3");
  });

  it("validate() accepts anatomyDir option without breaking v0.2 behavior", async () => {
    const result = await validate(minimalValidToml, { repoRoot: "/some/path", anatomyDir: "" });
    expect(result.ok).toBe(true);
  });

  const minimalSubToml = `anatomy_version = "0.2"
tagline = "sub anatomy smoke"

[identity]
fingerprint = "jtambpg4nh2b5vpw498v"

[identity.stack]
id = "typescript"
hash = "jtamb"

[identity.form]
id = "cli-tool"
hash = "pg4nh"

[identity.domain]
id = "web-publishing"
hash = "2b5vp"

[identity.function]
id = "markdown-to-static-html"
hash = "w498v"

[generated]
at = 2026-05-06T12:00:00.000Z
by = "x"
model = "x"
schema = "https://example.com"

[[structure.entries]]
path = "subsrc/"
purpose = "sub-package source"
kind = "source"
`;

  it("validate() resolves structure paths relative to anatomyDir when supplied", async () => {
    const root = mkdtempSync(join(tmpdir(), "anat-api-"));
    mkdirSync(join(root, "sub", "subsrc"), { recursive: true });
    const r = await validate(minimalSubToml, { repoRoot: root, anatomyDir: "sub" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  it("validate() reports structure-path-not-found when sub-anatomy path is missing", async () => {
    const root = mkdtempSync(join(tmpdir(), "anat-api-"));
    mkdirSync(join(root, "sub"));
    const r = await validate(minimalSubToml, { repoRoot: root, anatomyDir: "sub" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some(e => e.code === "structure-path-not-found")).toBe(true);
    }
  });
});
