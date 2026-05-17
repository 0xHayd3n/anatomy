// scripts/prebuild.mjs
// Clean the dist/ directory before tsc runs. Without this, files removed
// from src/ leave orphaned compiled artifacts in dist/ that the package's
// `files` array would still ship on publish (e.g. dist/pass1/code-intelligence.js
// after the code-intelligence pass was removed in commit ec73e00).
//
// Run via: npm run prebuild  (also invoked automatically by `build`).

import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const PKG_ROOT = resolve(import.meta.dirname, "..");
const DIST = resolve(PKG_ROOT, "dist");

await rm(DIST, { recursive: true, force: true });
console.log(`✓ cleaned ${DIST}`);
