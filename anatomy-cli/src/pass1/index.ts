// src/pass1/index.ts
// Pass 1 orchestrator: composes manifest detection + per-section derivation.

import { detectManifest } from "./manifest/index.js";
import { deriveIdentity } from "./identity.js";
import { deriveTagline } from "./tagline.js";
import { deriveOperation } from "./operation.js";
import { deriveSubstance } from "./substance.js";
import { deriveStructure } from "./structure.js";
import { deriveEnvironment } from "./environment.js";
import { deriveInterface, extractCommandNamesFromDir } from "./interface.js";
import { deriveCommit } from "./generated.js";
import type { Pass1Result } from "../types.js";
import { PKG_VERSION } from "../version.js";

function nowIsoMs(): string {
  // Date.toISOString() already includes ms precision and Z suffix.
  return new Date().toISOString();
}

export function runPass1(repoRoot: string): Pass1Result {
  const manifest = detectManifest(repoRoot);
  const identity = deriveIdentity(manifest, repoRoot);
  const { tagline, description } = deriveTagline(manifest, repoRoot);
  const operation = deriveOperation(manifest, repoRoot);
  const substance = deriveSubstance(manifest);
  const rootDescription = manifest?.kind === "npm"
    ? (manifest.parsed as Record<string, unknown>).description as string | undefined
    : undefined;
  const structure = deriveStructure(repoRoot, rootDescription ?? tagline.value);
  const environment = deriveEnvironment(manifest);
  // Subcommand names from src/commands/ feed interface.subcommands for CLI tools.
  const commandNames = identity.form.id.includes("cli") ? extractCommandNamesFromDir(repoRoot) : undefined;
  const interfaceField = deriveInterface(manifest, identity.form.id, repoRoot, commandNames && commandNames.length > 0 ? commandNames : undefined);

  const generatedAt = process.env.ANATOMY_GENERATED_AT ?? nowIsoMs();

  return {
    manifest,
    identity,
    tagline,
    description,
    operation,
    substance,
    structure,
    environment,
    interface: interfaceField,
    generatedAt,
    generatorId: `@anatomytool/cli@${PKG_VERSION}`,
    commit: deriveCommit(repoRoot),
  };
}
