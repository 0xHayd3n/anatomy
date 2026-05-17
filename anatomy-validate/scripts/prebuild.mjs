// scripts/prebuild.mjs
// Generates files in src/ that are gitignored and regenerated on every
// build/test:
//   src/schema.json         — copy of ../spec/0.1/schema.json
//   src/schema-0.2.json     — copy of ../spec/0.2/schema.json
//   src/types.generated.ts  — TypeScript type from json-schema-to-typescript,
//                              built from the LATEST schema (latest)
//
// Run via: npm run prebuild  (also invoked automatically by build + pretest)

import { readFile, writeFile, copyFile } from "node:fs/promises";
import { resolve } from "node:path";
import { compile } from "json-schema-to-typescript";

const PKG_ROOT = resolve(import.meta.dirname, "..");
const VERSIONS = ["0.1", "0.2", "0.4", "0.5", "0.6", "0.7", "0.8", "0.9", "0.10", "0.11", "0.12", "0.13", "0.14", "0.15", "1.0"];
const LATEST = "1.0";
const TYPES_DST = resolve(PKG_ROOT, "src", "types.generated.ts");

function dstPath(version) {
  // Keep src/schema.json for v0.1 to avoid v0.1 source-import churn;
  // newer versions get versioned filenames.
  return version === "0.1"
    ? resolve(PKG_ROOT, "src", "schema.json")
    : resolve(PKG_ROOT, "src", `schema-${version}.json`);
}

async function main() {
  for (const v of VERSIONS) {
    const src = resolve(PKG_ROOT, "..", "spec", v, "schema.json");
    const dst = dstPath(v);
    await copyFile(src, dst);
    console.log(`✓ copied schema ${v} → ${dst}`);
  }

  // Memory schema (separate version track)
  const memoryVersions = ["0.1", "0.2"];
  for (const v of memoryVersions) {
    const memorySrc = resolve(PKG_ROOT, "..", "spec", "memory", v, "schema.json");
    const memoryDst = resolve(PKG_ROOT, "src", `schema-memory-${v}.json`);
    await copyFile(memorySrc, memoryDst);
    console.log(`✓ copied memory schema ${v} → ${memoryDst}`);
  }

  const latestSrc = resolve(PKG_ROOT, "..", "spec", LATEST, "schema.json");
  const schemaText = await readFile(latestSrc, "utf8");
  const schema = JSON.parse(schemaText);
  const ts = await compile(schema, "Anatomy", {
    bannerComment:
      `/* eslint-disable */\n/**\n * GENERATED FILE — DO NOT EDIT.\n * Regenerated on every build/test from ../spec/${LATEST}/schema.json by scripts/prebuild.mjs.\n */`,
    additionalProperties: false,
  });
  await writeFile(TYPES_DST, ts);
  console.log(`✓ generated types → ${TYPES_DST}`);
}

main().catch((err) => {
  console.error("prebuild failed:", err);
  process.exit(1);
});
