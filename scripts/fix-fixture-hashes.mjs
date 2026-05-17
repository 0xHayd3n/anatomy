// scripts/fix-fixture-hashes.mjs
// Rewrites every valid/* and valid-with-warnings/* fixture so its identity.<pillar>.hash
// and identity.fingerprint fields match canonical hashes computed from the .id values.
// Run via: npm run fix:hashes
//
// IMPORTANT: this script does NOT touch invalid/* fixtures (their hashes are
// often intentionally wrong).

import { readFile, writeFile, readdir } from "node:fs/promises";
import { resolve, relative, join } from "node:path";
import { glob } from "node:fs/promises";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { canonicalize, canonicalHash, fingerprintFromPillars } from "./canonical.mjs";

const ROOT = resolve(import.meta.dirname, "..");

const PILLARS = ["stack", "form", "domain", "function"];
// Glob-friendly patterns for non-dotfile filenames (Node's built-in glob does
// not match dotfiles, so cascading .anatomy files use the recursive walk below).
const PATTERNS = [
  "fixtures/valid/*/input.anatomy",
  "fixtures/valid-with-warnings/*/input.anatomy",
];
// Cascading roots — walked manually because .anatomy is a dotfile.
// Unlike fixtures/invalid/* (which keep placeholder hashes intentionally),
// cascading invalid fixtures get canonical hashes too: the failure mode for
// cascading invalid scenarios is at a sub-file (escape/missing-path), not at
// the identity hashes. The root .anatomy in a cascading invalid fixture
// should be fully valid; only the sub-anatomy is deliberately broken.
const CASCADING_ROOTS = [
  "fixtures/cascading/valid",
  "fixtures/cascading/valid-with-warnings",
  "fixtures/cascading/invalid",
];

async function* walkAnatomyFiles(absRoot) {
  let entries;
  try {
    entries = await readdir(absRoot, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const abs = join(absRoot, ent.name);
    if (ent.isDirectory()) {
      yield* walkAnatomyFiles(abs);
    } else if (ent.isFile() && ent.name === ".anatomy") {
      yield relative(ROOT, abs).split("\\").join("/");
    }
  }
}

async function* allFixturePaths() {
  for (const pattern of PATTERNS) {
    for await (const rel of await glob(pattern, { cwd: ROOT })) {
      yield rel;
    }
  }
  for (const cr of CASCADING_ROOTS) {
    yield* walkAnatomyFiles(resolve(ROOT, cr));
  }
}

let touched = 0;
{
  for await (const rel of allFixturePaths()) {
    const path = resolve(ROOT, rel);
    const text = await readFile(path, "utf8");
    const doc = parseToml(text);
    let changed = false;

    if (!doc.identity) {
      console.error(`✗ ${rel}: no [identity] table`);
      process.exit(1);
    }

    if (doc.anatomy_version !== "0.1" && doc.anatomy_version !== "0.2" &&
        doc.anatomy_version !== "0.4" && doc.anatomy_version !== "0.5" &&
        doc.anatomy_version !== "0.6") {
      // v0.7+: flat string pillars + single fingerprint via fingerprintFromPillars.
      // No per-pillar hashes to update.
      const { stack, form, domain } = doc.identity;
      const fn = doc.identity.function;
      if ([stack, form, domain, fn].some(v => typeof v !== "string")) {
        console.error(`✗ ${rel}: v0.7 identity pillars must all be strings`);
        process.exit(1);
      }
      if ([stack, form, domain, fn].some(v => canonicalize(v) !== v)) {
        console.error(`✗ ${rel}: v0.7 identity pillar(s) not in canonical form`);
        process.exit(1);
      }
      const expected = fingerprintFromPillars(stack, form, domain, fn);
      if (doc.identity.fingerprint !== expected) {
        doc.identity.fingerprint = expected;
        changed = true;
      }
    } else {
      // v0.1-v0.6: nested pillar objects with per-pillar hashes.
      for (const pillar of PILLARS) {
        const p = doc.identity[pillar];
        if (!p) {
          console.error(`✗ ${rel}: missing identity.${pillar}`);
          process.exit(1);
        }
        const expected = canonicalHash(p.id);
        if (expected === null) {
          console.error(`✗ ${rel}: identity.${pillar}.id ${JSON.stringify(p.id)} fails canonicalization`);
          process.exit(1);
        }
        if (p.hash !== expected) {
          p.hash = expected;
          changed = true;
        }
      }

      const concat =
        canonicalHash(doc.identity.stack.id) +
        canonicalHash(doc.identity.form.id) +
        canonicalHash(doc.identity.domain.id) +
        canonicalHash(doc.identity.function.id);
      if (doc.identity.fingerprint !== concat) {
        doc.identity.fingerprint = concat;
        changed = true;
      }
    }

    if (changed) {
      await writeFile(path, stringifyToml(doc));
      console.log(`✓ updated ${rel}`);
      touched++;
    } else {
      console.log(`  ${rel} already correct`);
    }
  }
}
console.log(`\n${touched} fixture(s) updated.`);
