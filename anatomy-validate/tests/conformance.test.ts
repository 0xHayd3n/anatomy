import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { validate, validateTree } from "../src/index.js";

const FIXTURES_ROOT = resolve(import.meta.dirname, "../../fixtures");

interface ExpectedJson {
  errors?: Array<{
    instancePath: string;
    rule: string;
    params?: { missingProperty?: string };
  }>;
  warnings?: Array<{ code: string; field?: string; comment?: string }>;
  schema_can_detect?: boolean;
  validator_code?: string;
  validator_must_detect?: string;
  comment?: string;
}

function readFixture(category: string, name: string): { input: string; expected: ExpectedJson | null } {
  const dir = join(FIXTURES_ROOT, category, name);
  const input = readFileSync(join(dir, "input.anatomy"), "utf8");
  const expectedPath = join(dir, "expected.json");
  const expected = existsSync(expectedPath)
    ? (JSON.parse(readFileSync(expectedPath, "utf8")) as ExpectedJson)
    : null;
  return { input, expected };
}

function listFixtures(category: string): string[] {
  return readdirSync(join(FIXTURES_ROOT, category));
}

describe("conformance: valid/*", () => {
  for (const name of listFixtures("valid")) {
    it(`accepts ${name}`, async () => {
      const { input } = readFixture("valid", name);
      const result = await validate(input);
      if (!result.ok) {
        throw new Error(
          `Expected ok:true, got errors: ${JSON.stringify(result.errors, null, 2)}`,
        );
      }
      expect(result.ok).toBe(true);
      expect(result.warnings).toEqual([]);
    });
  }
});

describe("conformance: valid-with-warnings/*", () => {
  for (const name of listFixtures("valid-with-warnings")) {
    it(`accepts ${name} with expected warnings`, async () => {
      const { input, expected } = readFixture("valid-with-warnings", name);
      expect(expected?.warnings).toBeDefined();
      const result = await validate(input);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      for (const expectedWarn of expected!.warnings!) {
        expect(result.warnings.some(w => w.code === expectedWarn.code)).toBe(true);
      }
    });
  }
});

describe("conformance: invalid/*", () => {
  for (const name of listFixtures("invalid")) {
    it(`rejects ${name}`, async () => {
      const { input, expected } = readFixture("invalid", name);
      expect(expected).toBeDefined();
      const result = await validate(input);
      expect(result.ok).toBe(false);
      if (result.ok) return;

      if (expected!.schema_can_detect === false) {
        // Boundary case: validator-side rule. Match on validator_code.
        expect(expected!.validator_code).toBeDefined();
        const found = result.errors.some(e => e.code === expected!.validator_code);
        if (!found) {
          throw new Error(
            `Expected validator_code "${expected!.validator_code}" in errors, got: ${JSON.stringify(result.errors, null, 2)}`,
          );
        }
        expect(found).toBe(true);
      } else {
        // Schema-side rule. Match on instancePath + rule (= schemaKeyword).
        for (const exp of expected!.errors ?? []) {
          const found = result.errors.some(
            e =>
              e.code === "schema-violation" &&
              e.pointer === exp.instancePath &&
              e.schemaKeyword === exp.rule,
          );
          if (!found) {
            throw new Error(
              `Expected schema-violation at ${exp.instancePath} with rule ${exp.rule}, got: ${JSON.stringify(result.errors, null, 2)}`,
            );
          }
          expect(found).toBe(true);
        }
      }
    });
  }
});

interface CascadingExpectedJson {
  ok: boolean;
  results: Array<{
    relPath: string;
    ok: boolean;
    errors?: Array<{ code?: string; instancePath?: string; rule?: string }>;
    warnings?: Array<{ code: string }>;
  }>;
  crossFileWarnings?: Array<{ code: string }>;
}

const CASCADING_ROOT = resolve(import.meta.dirname, "../../fixtures/cascading");

describe("conformance: cascading/*", () => {
  for (const category of ["valid", "valid-with-warnings", "invalid"] as const) {
    const catDir = join(CASCADING_ROOT, category);
    if (!existsSync(catDir)) continue;
    for (const name of readdirSync(catDir)) {
      const fixtureRoot = join(catDir, name);
      const expectedPath = join(fixtureRoot, "expected.json");
      if (!existsSync(expectedPath)) continue;
      it(`${category}/${name}`, async () => {
        const expected: CascadingExpectedJson = JSON.parse(readFileSync(expectedPath, "utf8"));
        const tree = await validateTree(fixtureRoot);

        // ok matches
        expect(tree.ok).toBe(expected.ok);

        // results length and relPath order match
        expect(tree.results.map(r => r.relPath)).toEqual(expected.results.map(r => r.relPath));

        // per-result error/warning matching.
        // When an expected error has BOTH instancePath and rule, treat as a
        // schema-violation match (mirrors v0.2 single-file harness logic).
        // Otherwise do a code-only match.
        for (let i = 0; i < expected.results.length; i++) {
          const exp = expected.results[i];
          const got = tree.results[i].result;
          expect(got.ok).toBe(exp.ok);
          for (const expErr of exp.errors ?? []) {
            const matchesByPathRule =
              typeof expErr.instancePath === "string" && typeof expErr.rule === "string";
            const found = matchesByPathRule
              ? got.errors.some(
                  e =>
                    e.code === "schema-violation" &&
                    e.pointer === expErr.instancePath &&
                    e.schemaKeyword === expErr.rule,
                )
              : got.errors.some(e => e.code === expErr.code);
            if (!found) {
              throw new Error(
                `[${category}/${name}] result ${i} missing expected error ${JSON.stringify(expErr)}; got: ${JSON.stringify(got.errors)}`,
              );
            }
          }
          for (const expWarn of exp.warnings ?? []) {
            expect(got.warnings.some(w => w.code === expWarn.code)).toBe(true);
          }
        }

        // crossFileWarnings code matching
        for (const expCfw of expected.crossFileWarnings ?? []) {
          expect(tree.crossFileWarnings.some(w => w.code === expCfw.code)).toBe(true);
        }
      });
    }
  }
});
