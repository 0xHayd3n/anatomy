// scripts/validate-spec.mjs
// Verifies that the Anatomy spec content (schema, recommended-stacks, fixtures) is internally consistent.
// Run via: npm run validate

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { glob } from "node:fs/promises";
import { parse as parseToml } from "smol-toml";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { canonicalize, hash, canonicalHash, fingerprintFromPillars } from "./canonical.mjs";

const ROOT = resolve(import.meta.dirname, "..");

const VERSIONS = ["0.1", "0.2"];
// Newer schema versions loaded for fixture routing only — no full content checks required.
// INVARIANT: each entry must have a spec/{v}/schema.json file. Add the file before adding the version here.
const ROUTING_ONLY_VERSIONS = ["0.4", "0.5", "0.6", "0.7", "0.8", "0.9", "0.10", "0.11", "0.12", "0.13", "0.14", "0.15", "1.0"];
// Versions whose identity uses flat string pillars + fingerprintFromPillars(SHA-256(NUL-joined)).
// All others use the legacy nested {id, hash} pillar shape with concatenated per-pillar hashes.
const FLAT_PILLAR_VERSIONS = new Set(["0.7", "0.8", "0.9", "0.10", "0.11", "0.12", "0.13", "0.14", "0.15", "1.0"]);
const schemas = new Map();      // version → parsed JSON
const validators = new Map();   // version → AJV compiled validateFn
let ajv;                        // shared AJV instance (compile both onto it)

const checks = [];

function registerCheck(name, fn) {
  checks.push({ name, fn });
}

async function main() {
  let passed = 0;
  let failed = 0;

  for (const check of checks) {
    try {
      await check.fn();
      console.log(`✓ ${check.name}`);
      passed++;
    } catch (err) {
      console.error(`✗ ${check.name}`);
      console.error(`  ${err.message}`);
      failed++;
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

// Helper: parse a TOML file into its JSON-equivalent object. smol-toml returns
// TOML datetimes as TomlDate (subclass of Date); convert them to ISO strings
// so AJV's format:date-time check validates the string representation (per
// design Section 5 — TOML <-> JSON Schema interplay).
async function parseAnatomyToml(absPath) {
  const text = await readFile(absPath, "utf8");
  const raw = parseToml(text);
  return normalizeDates(raw);
}

function normalizeDates(value) {
  if (value instanceof Date) return value.toISOString().replace(/\.\d{3}Z$/, "Z");
  if (Array.isArray(value)) return value.map(normalizeDates);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = normalizeDates(v);
    return out;
  }
  return value;
}

registerCheck("schema.json is valid JSON Schema Draft 2020-12 (all versions)", async () => {
  // strict:"log" rather than strict:true because the schemas use
  // propertyNames.pattern + additionalProperties:<subschema> for
  // [operation.commands] / [operation.conventions] (v0.1 and v0.2),
  // and v0.2 additionally has anyOf/oneOf branches that reference
  // properties defined on the parent schema. Both trigger AJV strict-mode
  // diagnostics that the validator package also accepts as warnings.
  ajv = new Ajv({ strict: "log", allErrors: true });
  addFormats(ajv);
  for (const v of VERSIONS) {
    const path = resolve(ROOT, `spec/${v}/schema.json`);
    const parsed = JSON.parse(await readFile(path, "utf8"));
    schemas.set(v, parsed);
    validators.set(v, ajv.compile(parsed));
  }
  for (const v of ROUTING_ONLY_VERSIONS) {
    const path = resolve(ROOT, `spec/${v}/schema.json`);
    const parsed = JSON.parse(await readFile(path, "utf8"));
    validators.set(v, ajv.compile(parsed));
  }
});

registerCheck("every valid/* fixture parses as TOML and validates against the matching version's schema", async () => {
  if (validators.size === 0) throw new Error("schemas must compile first");
  const dirs = [];
  for await (const entry of await glob("fixtures/valid/*/input.anatomy", { cwd: ROOT })) {
    dirs.push(entry);
  }
  if (dirs.length === 0) throw new Error("no valid fixtures found");
  const failures = [];
  for (const rel of dirs) {
    let doc;
    try {
      doc = await parseAnatomyToml(resolve(ROOT, rel));
    } catch (err) {
      failures.push({ rel, errors: [`TOML parse error: ${err.message}`] });
      continue;
    }
    const declared = doc?.anatomy_version;
    const fn = validators.get(declared);
    if (!fn) {
      failures.push({ rel, errors: [`unknown anatomy_version: ${JSON.stringify(declared)}`] });
      continue;
    }
    const ok = fn(doc);
    if (!ok) failures.push({ rel, errors: fn.errors });
  }
  if (failures.length > 0) {
    throw new Error(
      `${failures.length} valid fixture(s) failed validation:\n` +
      failures.map(f => `  ${f.rel}: ${JSON.stringify(f.errors)}`).join("\n")
    );
  }
});

registerCheck("every invalid/* fixture FAILS to validate, with errors matching expected.json", async () => {
  if (validators.size === 0) throw new Error("schemas must compile first");
  const dirs = [];
  for await (const entry of await glob("fixtures/invalid/*/input.anatomy", { cwd: ROOT })) {
    dirs.push(entry);
  }
  if (dirs.length === 0) throw new Error("no invalid fixtures found");
  const failures = [];
  for (const rel of dirs) {
    const inputPath = resolve(ROOT, rel);
    const expectedPath = inputPath.replace(/input\.anatomy$/, "expected.json");
    const expected = JSON.parse(await readFile(expectedPath, "utf8"));

    let doc;
    let parseError = null;
    try {
      doc = await parseAnatomyToml(inputPath);
    } catch (err) {
      parseError = err;
    }

    // Boundary case: schema cannot detect this. Fixture MUST parse cleanly AND
    // validate cleanly against the schema (validator will catch it later).
    // For schema_can_detect:false fixtures, the declared version may be missing
    // from required identity fields; route by version when possible, otherwise
    // try every loaded schema and accept if any compiles cleanly.
    if (expected.schema_can_detect === false) {
      if (parseError) {
        failures.push({ rel, reason: `marked schema_can_detect:false but TOML parse failed: ${parseError.message}` });
        continue;
      }
      const declared = doc?.anatomy_version;
      const fn = validators.get(declared);
      if (!fn) {
        failures.push({ rel, reason: `marked schema_can_detect:false but anatomy_version unknown: ${JSON.stringify(declared)}` });
        continue;
      }
      const ok = fn(doc);
      if (!ok) {
        failures.push({
          rel,
          reason: `marked schema_can_detect:false but schema rejected it: ${JSON.stringify(fn.errors)}`,
        });
      }
      continue;
    }

    if (parseError) {
      failures.push({ rel, reason: `TOML parse error (and not marked schema_can_detect:false): ${parseError.message}` });
      continue;
    }

    const declared = doc?.anatomy_version;
    const fn = validators.get(declared);
    if (!fn) {
      failures.push({ rel, reason: `unknown anatomy_version: ${JSON.stringify(declared)}` });
      continue;
    }
    const ok = fn(doc);
    if (ok) {
      failures.push({ rel, reason: "validated cleanly but should have failed" });
      continue;
    }
    for (const exp of expected.errors) {
      const found = (fn.errors ?? []).some(
        e => e.instancePath === exp.instancePath && e.keyword === exp.rule
      );
      if (!found) {
        failures.push({
          rel,
          reason: `expected error not found: ${JSON.stringify(exp)}; actual: ${JSON.stringify(fn.errors)}`,
        });
      }
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `${failures.length} invalid fixture(s) misbehaved:\n` +
      failures.map(f => `  ${f.rel}: ${f.reason}`).join("\n")
    );
  }
});

registerCheck("recommended-stacks.json validates against its meta-schema (all versions)", async () => {
  if (!ajv) throw new Error("ajv must be initialized first");
  for (const ver of VERSIONS) {
    const meta = JSON.parse(await readFile(resolve(ROOT, `spec/${ver}/recommended-stacks.meta.json`), "utf8"));
    const data = JSON.parse(await readFile(resolve(ROOT, `spec/${ver}/recommended-stacks.json`), "utf8"));
    // Versions may share an identical $id (the meta schemas are byte-identical
    // until something genuinely diverges). Reuse the compiled validator if AJV
    // already has it; otherwise compile fresh.
    const existing = meta.$id ? ajv.getSchema(meta.$id) : null;
    const v = existing ?? ajv.compile(meta);
    if (!v(data)) {
      throw new Error(`spec/${ver}/recommended-stacks.json invalid: ${JSON.stringify(v.errors)}`);
    }
  }
});

registerCheck("recommended-stacks.json: no duplicate IDs across entries and aliases (all versions)", async () => {
  for (const ver of VERSIONS) {
    const data = JSON.parse(await readFile(resolve(ROOT, `spec/${ver}/recommended-stacks.json`), "utf8"));
    const seen = new Map();
    for (const entry of data.entries) {
      const all = [entry.id, ...(entry.aliases ?? [])];
      for (const id of all) {
        if (seen.has(id)) {
          throw new Error(`spec/${ver}: duplicate id '${id}': appears in '${seen.get(id)}' and '${entry.id}'`);
        }
        seen.set(id, entry.id);
      }
    }
  }
});

registerCheck("canonicalization-cases.json is well-formed", async () => {
  const path = resolve(ROOT, "fixtures/canonicalization-cases.json");
  const data = JSON.parse(await readFile(path, "utf8"));
  if (!Array.isArray(data.valid)) throw new Error("missing 'valid' array");
  if (!Array.isArray(data.invalid)) throw new Error("missing 'invalid' array");
  for (const c of data.valid) {
    if (typeof c.input !== "string" || typeof c.canonical !== "string") {
      throw new Error(`malformed valid entry: ${JSON.stringify(c)}`);
    }
  }
  for (const c of data.invalid) {
    if (typeof c.input !== "string" || typeof c.reason !== "string") {
      throw new Error(`malformed invalid entry: ${JSON.stringify(c)}`);
    }
  }
});

registerCheck("canonicalization-cases.json: every valid case canonicalizes correctly", async () => {
  const data = JSON.parse(await readFile(resolve(ROOT, "fixtures/canonicalization-cases.json"), "utf8"));
  const failures = [];
  for (const c of data.valid) {
    const got = canonicalize(c.input);
    if (got !== c.canonical) {
      failures.push(`${JSON.stringify(c.input)} → ${JSON.stringify(got)} (expected ${JSON.stringify(c.canonical)})`);
    }
  }
  if (failures.length > 0) throw new Error("canonicalization mismatch:\n  " + failures.join("\n  "));
});

registerCheck("canonicalization-cases.json: every invalid case is rejected", async () => {
  const data = JSON.parse(await readFile(resolve(ROOT, "fixtures/canonicalization-cases.json"), "utf8"));
  const failures = [];
  for (const c of data.invalid) {
    const got = canonicalize(c.input);
    if (got !== null) {
      failures.push(`${JSON.stringify(c.input)} canonicalized to ${JSON.stringify(got)} but should have been rejected (${c.reason})`);
    }
  }
  if (failures.length > 0) throw new Error("invalid case not rejected:\n  " + failures.join("\n  "));
});

registerCheck("canonicalization-cases.json: every valid case has expected_hash matching computed hash", async () => {
  const data = JSON.parse(await readFile(resolve(ROOT, "fixtures/canonicalization-cases.json"), "utf8"));
  const failures = [];
  for (const c of data.valid) {
    if (typeof c.expected_hash !== "string") {
      failures.push(`${JSON.stringify(c.input)}: missing expected_hash`);
      continue;
    }
    const got = hash(c.canonical);
    if (got !== c.expected_hash) {
      failures.push(`${JSON.stringify(c.input)}: expected_hash ${c.expected_hash} but computed ${got}`);
    }
  }
  if (failures.length > 0) throw new Error("hash mismatch:\n  " + failures.join("\n  "));
});

registerCheck("every valid/* and valid-with-warnings/* fixture has identity.*.hash equal to canonical-form hashes", async () => {
  const dirs = [];
  for (const pattern of ["fixtures/valid/*/input.anatomy", "fixtures/valid-with-warnings/*/input.anatomy"]) {
    for await (const entry of await glob(pattern, { cwd: ROOT })) {
      dirs.push(entry);
    }
  }
  const failures = [];
  for (const rel of dirs) {
    const doc = await parseAnatomyToml(resolve(ROOT, rel));
    if (!doc.identity) {
      failures.push(`${rel}: no [identity] table`);
      continue;
    }
    if (FLAT_PILLAR_VERSIONS.has(doc.anatomy_version)) {
      const { stack, form, domain } = doc.identity;
      const fn = doc.identity.function;
      if ([stack, form, domain, fn].some(v => typeof v !== "string")) {
        failures.push(`${rel}: v${doc.anatomy_version} identity pillars must all be strings`);
        continue;
      }
      if ([stack, form, domain, fn].some(v => canonicalize(v) !== v)) {
        failures.push(`${rel}: v${doc.anatomy_version} identity pillar(s) not in canonical form: ${JSON.stringify({ stack, form, domain, function: fn })}`);
        continue;
      }
      const expected = fingerprintFromPillars(stack, form, domain, fn);
      if (doc.identity.fingerprint !== expected) {
        failures.push(`${rel}: identity.fingerprint is ${doc.identity.fingerprint} but expected ${expected}`);
      }
      continue;
    }
    for (const pillar of ["stack", "form", "domain", "function"]) {
      const p = doc.identity[pillar];
      const expected = canonicalHash(p?.id);
      if (expected === null) {
        failures.push(`${rel}: identity.${pillar}.id ${JSON.stringify(p?.id)} fails canonicalization`);
        continue;
      }
      if (p.hash !== expected) {
        failures.push(`${rel}: identity.${pillar}.hash is ${p.hash} but expected ${expected}`);
      }
    }
    const concat =
      canonicalHash(doc.identity.stack.id) +
      canonicalHash(doc.identity.form.id) +
      canonicalHash(doc.identity.domain.id) +
      canonicalHash(doc.identity.function.id);
    if (doc.identity.fingerprint !== concat) {
      failures.push(`${rel}: identity.fingerprint is ${doc.identity.fingerprint} but expected ${concat}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`${failures.length} hash mismatch(es):\n  ` + failures.join("\n  "));
  }
});

registerCheck("prompt.md exists and references the required output fields (all versions)", async () => {
  const requiredFieldsByVersion = {
    "0.1": ["form", "domain", "function", "description", "entry_points", "commands", "conventions", "key_dependencies", "capabilities", "limitations"],
    "0.2": ["form", "domain", "function", "tagline", "entry_points", "commands", "conventions", "key_dependencies", "capabilities", "limitations", "structure", "environment", "interface", "domain_model"],
  };
  for (const ver of VERSIONS) {
    const text = await readFile(resolve(ROOT, `spec/${ver}/prompt.md`), "utf8");
    for (const field of requiredFieldsByVersion[ver]) {
      if (!text.includes(field)) {
        throw new Error(`spec/${ver}/prompt.md does not mention required field '${field}'`);
      }
    }
  }
});

registerCheck("versioning-policy.md exists and is non-empty (all versions)", async () => {
  for (const ver of VERSIONS) {
    const text = await readFile(resolve(ROOT, `spec/${ver}/versioning-policy.md`), "utf8");
    if (text.length < 500) throw new Error(`spec/${ver}/versioning-policy.md suspiciously short`);
  }
});

registerCheck("every valid-with-warnings/* fixture parses + validates against the matching version's schema", async () => {
  if (validators.size === 0) throw new Error("schemas must compile first");
  const dirs = [];
  for await (const entry of await glob("fixtures/valid-with-warnings/*/input.anatomy", { cwd: ROOT })) {
    dirs.push(entry);
  }
  if (dirs.length === 0) return;
  const failures = [];
  for (const rel of dirs) {
    const doc = await parseAnatomyToml(resolve(ROOT, rel));
    const declared = doc?.anatomy_version;
    const fn = validators.get(declared);
    if (!fn) {
      failures.push({ rel, errors: [`unknown anatomy_version: ${JSON.stringify(declared)}`] });
      continue;
    }
    const ok = fn(doc);
    if (!ok) failures.push({ rel, errors: fn.errors });
  }
  if (failures.length > 0) {
    throw new Error(
      `${failures.length} valid-with-warnings fixture(s) failed validation:\n` +
      failures.map(f => `  ${f.rel}: ${JSON.stringify(f.errors)}`).join("\n")
    );
  }
});

registerCheck("every valid-with-warnings/* has expected.json with at least one warning", async () => {
  const dirs = [];
  for await (const entry of await glob("fixtures/valid-with-warnings/*/input.anatomy", { cwd: ROOT })) {
    dirs.push(entry);
  }
  if (dirs.length === 0) return;
  const failures = [];
  for (const rel of dirs) {
    const expectedPath = resolve(ROOT, rel).replace(/input\.anatomy$/, "expected.json");
    const expected = JSON.parse(await readFile(expectedPath, "utf8"));
    if (!Array.isArray(expected.warnings) || expected.warnings.length === 0) {
      failures.push(rel);
    }
  }
  if (failures.length > 0) throw new Error("missing/empty warnings array in:\n  " + failures.join("\n  "));
});

registerCheck("v0.2 schema: anatomy_version.const is '0.2'", async () => {
  const s = schemas.get("0.2");
  if (s.properties.anatomy_version.const !== "0.2") {
    throw new Error(`expected '0.2', got ${JSON.stringify(s.properties.anatomy_version.const)}`);
  }
});

registerCheck("v0.2 schema: top-level required includes 'tagline'", async () => {
  const s = schemas.get("0.2");
  if (!s.required.includes("tagline")) {
    throw new Error(`top-level required missing 'tagline': ${JSON.stringify(s.required)}`);
  }
});

registerCheck("every fixtures/cascading/**/.anatomy parses + validates against the matching version's schema", async () => {
  if (validators.size === 0) throw new Error("schemas must compile first");
  const { readdir } = await import("node:fs/promises");
  const { join, relative } = await import("node:path");

  async function* walk(absRoot) {
    let entries;
    try { entries = await readdir(absRoot, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      const abs = join(absRoot, ent.name);
      if (ent.isDirectory()) yield* walk(abs);
      else if (ent.isFile() && ent.name === ".anatomy") yield relative(ROOT, abs).split("\\").join("/");
    }
  }

  const dirs = [];
  for await (const rel of walk(resolve(ROOT, "fixtures/cascading"))) dirs.push(rel);
  if (dirs.length === 0) return; // no cascading fixtures yet — not an error

  const failures = [];
  for (const rel of dirs) {
    let doc;
    try {
      doc = await parseAnatomyToml(resolve(ROOT, rel));
    } catch (err) {
      failures.push({ rel, errors: [`TOML parse error: ${err.message}`] });
      continue;
    }
    const declared = doc?.anatomy_version;
    const fn = validators.get(declared);
    if (!fn) {
      failures.push({ rel, errors: [`unknown anatomy_version: ${JSON.stringify(declared)}`] });
      continue;
    }
    const ok = fn(doc);
    if (!ok) failures.push({ rel, errors: fn.errors });
  }
  if (failures.length > 0) {
    throw new Error(
      `${failures.length} cascading fixture file(s) failed validation:\n` +
      failures.map(f => `  ${f.rel}: ${JSON.stringify(f.errors)}`).join("\n")
    );
  }
});

registerCheck("every fixtures/cascading/{valid,valid-with-warnings,invalid}/**/.anatomy has canonical identity hashes", async () => {
  // (Cascading invalid fixtures have valid identity hashes too — only their
  //  sub-file path-bearing fields are deliberately broken. See T13 commit.)
  const { readdir } = await import("node:fs/promises");
  const { join, relative } = await import("node:path");

  async function* walk(absRoot) {
    let entries;
    try { entries = await readdir(absRoot, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      const abs = join(absRoot, ent.name);
      if (ent.isDirectory()) yield* walk(abs);
      else if (ent.isFile() && ent.name === ".anatomy") yield relative(ROOT, abs).split("\\").join("/");
    }
  }

  const dirs = [];
  for await (const rel of walk(resolve(ROOT, "fixtures/cascading"))) dirs.push(rel);
  if (dirs.length === 0) return;

  const failures = [];
  for (const rel of dirs) {
    const doc = await parseAnatomyToml(resolve(ROOT, rel));
    if (!doc.identity) { failures.push(`${rel}: no [identity] table`); continue; }
    if (FLAT_PILLAR_VERSIONS.has(doc.anatomy_version)) {
      const { stack, form, domain } = doc.identity;
      const fn = doc.identity.function;
      if ([stack, form, domain, fn].some(v => typeof v !== "string")) {
        failures.push(`${rel}: v${doc.anatomy_version} identity pillars must all be strings`);
        continue;
      }
      if ([stack, form, domain, fn].some(v => canonicalize(v) !== v)) {
        failures.push(`${rel}: v${doc.anatomy_version} identity pillar(s) not in canonical form`);
        continue;
      }
      const expected = fingerprintFromPillars(stack, form, domain, fn);
      if (doc.identity.fingerprint !== expected) {
        failures.push(`${rel}: identity.fingerprint is ${doc.identity.fingerprint} but expected ${expected}`);
      }
      continue;
    }
    for (const pillar of ["stack", "form", "domain", "function"]) {
      const p = doc.identity[pillar];
      const expected = canonicalHash(p?.id);
      if (expected === null) { failures.push(`${rel}: identity.${pillar}.id ${JSON.stringify(p?.id)} fails canonicalization`); continue; }
      if (p.hash !== expected) failures.push(`${rel}: identity.${pillar}.hash is ${p.hash} but expected ${expected}`);
    }
    const concat =
      canonicalHash(doc.identity.stack.id) +
      canonicalHash(doc.identity.form.id) +
      canonicalHash(doc.identity.domain.id) +
      canonicalHash(doc.identity.function.id);
    if (doc.identity.fingerprint !== concat) {
      failures.push(`${rel}: identity.fingerprint is ${doc.identity.fingerprint} but expected ${concat}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`${failures.length} cascading hash mismatch(es):\n  ` + failures.join("\n  "));
  }
});

registerCheck("v0.2 schema: declares the four new $defs", async () => {
  const s = schemas.get("0.2");
  for (const def of ["structure", "environment", "interface", "domain_model"]) {
    if (!s.$defs[def]) throw new Error(`missing $defs.${def}`);
  }
});

// Checks register here as later tasks add them.

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(2);
});
