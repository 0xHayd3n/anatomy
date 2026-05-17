// tests/security.test.ts
// Adversarial-input tests: prototype pollution, pathological README content,
// malformed manifests, deeply-nested objects.

import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectNpm } from "../src/pass1/manifest/npm.js";
import { runPass1 } from "../src/pass1/index.js";
import { renderToml } from "../src/render/toml.js";
import { validate } from "@anatomytool/validate";

function makeRepo(): string {
  return mkdtempSync(join(tmpdir(), "anat-sec-"));
}

describe("prototype pollution defense", () => {
  it("strips __proto__ from package.json during JSON.parse", () => {
    const root = makeRepo();
    writeFileSync(join(root, "package.json"), JSON.stringify({
      name: "evil",
      version: "1.0.0",
      __proto__: { polluted: true },
      dependencies: { __proto__: { polluted: true } },
    }));
    const result = detectNpm(root);
    expect(result?.kind).toBe("npm");
    const parsed = result?.parsed as Record<string, unknown> & { polluted?: boolean };
    expect(parsed.polluted).toBeUndefined();
    // Inherited from Object.prototype shouldn't have been polluted globally either:
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("strips constructor key from package.json", () => {
    const root = makeRepo();
    writeFileSync(join(root, "package.json"), JSON.stringify({
      name: "evil",
      constructor: { prototype: { polluted: true } },
    }));
    const result = detectNpm(root);
    const parsed = result?.parsed as Record<string, unknown>;
    expect(parsed.constructor).toBe(Object); // the genuine Object constructor, NOT the malicious one
  });

  it("end-to-end Pass 1 against a polluted package.json still produces valid output", async () => {
    const root = makeRepo();
    writeFileSync(join(root, "package.json"), JSON.stringify({
      name: "evil", version: "1.0.0",
      __proto__: { description: "evil-injected-description" },
      main: "./index.js",
      engines: { node: ">=20" },
    }));
    mkdirSync(join(root, "src"));
    const toml = renderToml(runPass1(root));
    const v = await validate(toml, { repoRoot: root, anatomyDir: "" });
    expect(v.ok).toBe(true);
    // The injected description should NOT have been picked up as the tagline.
    expect(toml).not.toContain("evil-injected-description");
  });
});

describe("malformed manifest handling", () => {
  it("throws a wrapped error (not raw stack) when package.json is invalid JSON", () => {
    const root = makeRepo();
    writeFileSync(join(root, "package.json"), "{ this is not json");
    expect(() => detectNpm(root)).toThrow(/not valid JSON/);
  });

  it("throws when package.json exceeds the 1MB size limit", () => {
    const root = makeRepo();
    writeFileSync(join(root, "package.json"), "x".repeat(2_000_000));
    expect(() => detectNpm(root)).toThrow(/limit is/);
  });
});

describe("pathological README handling", () => {
  it("README with NULL bytes doesn't crash Pass 1", async () => {
    const root = makeRepo();
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "x", version: "1" }));
    writeFileSync(join(root, "README.md"), "# Title\n\nSome text\x00with null\x00bytes.\n");
    // Should not throw — at worst, the tagline contains escaped null bytes,
    // which the renderer escapes via tomlString.
    const toml = renderToml(runPass1(root));
    const v = await validate(toml, { repoRoot: root, anatomyDir: "" });
    expect(v.ok).toBe(true);
  });

  it("README with very long single line still respects 120-char tagline cap", () => {
    const root = makeRepo();
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "x", version: "1" }));
    writeFileSync(join(root, "README.md"), "x".repeat(900_000) + "\n"); // <1MB so passes size check
    const result = runPass1(root);
    expect(result.tagline.value.length).toBeLessThanOrEqual(120);
  });

  it("README over the size limit is silently dropped, not thrown (best-effort read)", () => {
    const root = makeRepo();
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "x", version: "1", description: "from manifest" }));
    // Just over 1MB.
    writeFileSync(join(root, "README.md"), "x".repeat(1_500_000));
    // README is too large — readReadme silently returns null, tagline falls back to manifest description.
    const result = runPass1(root);
    expect(result.tagline.source).toBe("manifest-description");
    expect(result.tagline.value).toBe("from manifest");
  });
});

describe("structure walker hard limit", () => {
  it("truncates (does not throw) when top-level entry count exceeds 1000", () => {
    const root = makeRepo();
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "x", version: "1" }));
    for (let i = 0; i < 1001; i++) mkdirSync(join(root, `dir${i.toString().padStart(4, "0")}`));
    const result = runPass1(root);
    // entries capped at STRUCTURE_ENTRIES_CAP (25), not thrown
    expect(result.structure.entries.length).toBeLessThanOrEqual(25);
  });
});
