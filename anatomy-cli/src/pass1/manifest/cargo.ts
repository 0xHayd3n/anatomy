// src/pass1/manifest/cargo.ts
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import type { DetectedManifest } from "../../types.js";
import { readManifest } from "../../io.js";

/** A Cargo.toml is a primary product manifest when it has [package] (a
 *  publishable crate) or [workspace] (a workspace root containing crates).
 *  A Cargo.toml with neither is rare — possibly a tooling sidecar (e.g.
 *  cargo-features-only) — and shouldn't claim to be the primary stack. */
function isCargoPrimary(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== "object") return false;
  const p = parsed as Record<string, unknown>;
  if (p.package && typeof p.package === "object") return true;
  if (p.workspace && typeof p.workspace === "object") return true;
  return false;
}

export function detectCargo(repoRoot: string): DetectedManifest | null {
  const path = join(repoRoot, "Cargo.toml");
  if (!existsSync(path)) return null;
  const text = readManifest(path);
  let parsed: unknown;
  try {
    parsed = parseToml(text);
  } catch (err) {
    throw new Error(`Cargo.toml at ${path} is not valid TOML: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { kind: "cargo", path, parsed, isPrimary: isCargoPrimary(parsed) };
}
