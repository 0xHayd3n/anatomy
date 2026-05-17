// src/pass1/environment.ts
// language_version + runtime per spec §4.2 step 8.
// Returns undefined when neither sub-field is derivable.

import type { DetectedManifest, Pass1Result } from "../types.js";

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? v as Record<string, unknown> : {};
}

export function deriveEnvironment(manifest: DetectedManifest | null): Pass1Result["environment"] {
  if (!manifest) return undefined;
  const parsed = asObj(manifest.parsed);
  let languageVersion: string | undefined;
  let runtime: string | undefined;

  switch (manifest.kind) {
    case "npm": {
      const node = (asObj(parsed.engines).node);
      if (typeof node === "string") languageVersion = node;
      runtime = "node";
      break;
    }
    case "cargo": {
      const rustVersion = asObj(parsed.package)["rust-version"];
      if (typeof rustVersion === "string") languageVersion = rustVersion;
      runtime = "rust";
      break;
    }
    case "pyproject": {
      const requiresPython = asObj(parsed.project)["requires-python"];
      if (typeof requiresPython === "string") languageVersion = requiresPython;
      runtime = "cpython";
      break;
    }
    case "go": {
      const goVersion = parsed.goVersion;
      if (typeof goVersion === "string" && goVersion.length > 0) languageVersion = goVersion;
      runtime = "go";
      break;
    }
  }

  if (languageVersion === undefined && runtime === undefined) return undefined;
  return {
    ...(languageVersion !== undefined ? { languageVersion } : {}),
    ...(runtime !== undefined ? { runtime } : {}),
  };
}
