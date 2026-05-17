// tests/fuzz.test.ts
// Property-based tests for the most adversarial-input-sensitive modules.
// Uses fast-check (devDep). Numbers are kept modest so CI time stays bounded.

import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as fc from "fast-check";
import { canonicalize, hash, canonicalHash } from "../src/canonical.js";
import { runPass1 } from "../src/pass1/index.js";
import { renderToml } from "../src/render/toml.js";
import { validate } from "@anatomytool/validate";

describe("canonical (property-based)", () => {
  it("idempotence: canonicalize(canonicalize(s)) === canonicalize(s)", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), s => {
        const once = canonicalize(s);
        if (once === null) return true; // invalid input, no claim
        const twice = canonicalize(once);
        return twice === once;
      }),
      { numRuns: 200 },
    );
  });

  it("hash stability: same canonical input → same hash", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z0-9]+(-[a-z0-9]+)*$/, { maxLength: 30 }), s => {
        return hash(s) === hash(s);
      }),
      { numRuns: 100 },
    );
  });

  it("canonicalHash returns 5-char Crockford or null", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), s => {
        const h = canonicalHash(s);
        if (h === null) return true;
        return /^[a-z0-9]{5}$/.test(h);
      }),
      { numRuns: 200 },
    );
  });
});

describe("Pass 1 → render → validate (property-based)", () => {
  // Build a random repo state and assert the validation gate invariant.
  const repoArb = fc.record({
    hasManifest: fc.boolean(),
    manifestKind: fc.constantFrom("npm", "cargo", "pyproject", "go"),
    hasTsconfig: fc.boolean(),
    hasReadme: fc.boolean(),
    readme: fc.string({ maxLength: 500 }),
    extraDirs: fc.array(fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/), { maxLength: 8 }),
  });

  it("every random repo produces schema-valid output", async () => {
    await fc.assert(
      fc.asyncProperty(repoArb, async (st) => {
        const root = mkdtempSync(join(tmpdir(), "anat-fz-"));
        if (st.hasManifest) {
          if (st.manifestKind === "npm") {
            writeFileSync(join(root, "package.json"), JSON.stringify({
              name: "x", version: "1.0.0", main: "./index.js",
              scripts: { build: "x" }, engines: { node: ">=20" },
            }));
          } else if (st.manifestKind === "cargo") {
            writeFileSync(join(root, "Cargo.toml"), `[package]\nname = "x"\nversion = "1.0.0"\n`);
          } else if (st.manifestKind === "pyproject") {
            writeFileSync(join(root, "pyproject.toml"), `[project]\nname = "x"\nversion = "1.0.0"\n`);
          } else {
            writeFileSync(join(root, "go.mod"), `module example.com/x\n\ngo 1.22\n`);
          }
        }
        if (st.hasTsconfig) writeFileSync(join(root, "tsconfig.json"), "{}");
        if (st.hasReadme) writeFileSync(join(root, "README.md"), st.readme);
        for (const d of new Set(st.extraDirs)) {
          try { mkdirSync(join(root, d)); } catch {}
        }

        const result = renderToml(runPass1(root));
        const v = await validate(result, { repoRoot: root, anatomyDir: "" });
        return v.ok;
      }),
      { numRuns: 50 }, // each run does FS work — keep modest
    );
  });
});
