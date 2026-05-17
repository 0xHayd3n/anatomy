// Auto-derived from package.json so a release version bump propagates
// without a manual sync. The relative path resolves identically from
// src/version.ts and dist/version.js (both are one level under the
// package root, as enforced by tsconfig's outDir: ./dist + rootDir: ./src).
import pkg from "../package.json" with { type: "json" };
export const PKG_VERSION = pkg.version;
