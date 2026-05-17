// src/pass1/manifest/terraform.ts
// Detects Terraform projects via *.tf files at repo root. Stack:
// "terraform". Form: "module" by default — Terraform "modules" are the
// reusable unit, similar to libraries. Form="library" reuses an existing
// slug (we don't add "module" to the form taxonomy), and per the form
// pillar's regex `^[a-z0-9]+(-[a-z0-9]+)*$`, "library" is the closest
// existing slug for "reusable definition unit." Future: a `service`
// signal could fire on a top-level `provider "aws"` + many `resource`
// blocks (i.e. an actual deployable infra), but distinguishing modules
// from deployable confurations needs more parsing than is worthwhile
// here.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { DetectedManifest } from "../../types.js";

interface TerraformParsed {
  rootTfFiles: string[];
}

function findRootTfFiles(repoRoot: string): string[] {
  try {
    return readdirSync(repoRoot, { withFileTypes: true })
      .filter(e => e.isFile() && e.name.endsWith(".tf") && !e.name.startsWith("."))
      .map(e => e.name);
  } catch {
    return [];
  }
}

export function detectTerraform(repoRoot: string): DetectedManifest | null {
  const rootTfFiles = findRootTfFiles(repoRoot);
  if (rootTfFiles.length === 0) return null;

  // Pick a stable representative path — main.tf if present, else the first
  // alphabetically. The detector returns a path for staleness/checksum
  // tooling; the actual content of all *.tf files matters for downstream.
  const mainPath = join(repoRoot, rootTfFiles.includes("main.tf") ? "main.tf" : rootTfFiles[0]);
  if (!existsSync(mainPath)) return null;

  return {
    kind: "terraform",
    path: mainPath,
    parsed: { rootTfFiles } satisfies TerraformParsed,
  };
}

export function terraformFormSuffix(_parsed: unknown): "library" {
  return "library";
}
