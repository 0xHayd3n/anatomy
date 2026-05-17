// src/pass1/manifest/npm.ts
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { DetectedManifest } from "../../types.js";
import { readManifest } from "../../io.js";

// Defense-in-depth reviver: strip prototype-pollution keys from untrusted
// JSON. Even though our access patterns use Object.keys / Object.entries
// (which don't follow the prototype chain), a malicious package.json with
// __proto__ or constructor keys could surprise downstream consumers of
// Pass1Result.
function safeReviver(key: string, value: unknown): unknown {
  if (key === "__proto__" || key === "constructor" || key === "prototype") {
    return undefined; // omit from the parsed object
  }
  return value;
}

export function detectNpm(repoRoot: string): DetectedManifest | null {
  const path = join(repoRoot, "package.json");
  if (!existsSync(path)) return null;
  const text = readManifest(path);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text, safeReviver);
  } catch (err) {
    throw new Error(`package.json at ${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { kind: "npm", path, parsed, isPrimary: !isNpmStub(parsed) };
}

/** True when a package.json is a tooling stub rather than a real project
 *  manifest. Surfaced by the 2026-05-09 stress test on mdBook (which
 *  ships a package.json containing only ESLint dev deps + lint scripts —
 *  no name, no main, no exports). A package.json claims project-hood by
 *  declaring ANY of: name, main, module, bin, exports, workspaces, or
 *  private:true. webext-mdn and astro-starlight regressed under a
 *  stricter rule (only main/module/bin/exports counted) — they have name
 *  + scripts but no main, yet are real projects (examples collection,
 *  workspace root respectively). The looser rule keeps them as primary. */
export function isNpmStub(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== "object") return true;
  const p = parsed as Record<string, unknown>;
  if (typeof p.name === "string") return false;
  if (p.main !== undefined) return false;
  if (p.module !== undefined) return false;
  if (p.exports !== undefined) return false;
  if (p.bin !== undefined) return false;
  if (p.workspaces !== undefined) return false;
  if (p.private === true) return false;
  return true;
}
