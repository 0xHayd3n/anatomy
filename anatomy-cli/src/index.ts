// src/index.ts
// Public programmatic surface.

export type {
  Pass1Result,
  DetectedManifest,
  IdentityFields,
  StructureKind,
  ExportKind,
  ManifestKind,
} from "./types.js";

export { runPass1 } from "./pass1/index.js";
export { renderToml } from "./render/toml.js";
