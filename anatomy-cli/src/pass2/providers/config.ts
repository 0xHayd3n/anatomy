// src/pass2/providers/config.ts
// Reads .anatomy-cli.toml at the repo root for third-party Pass 2 provider
// registration (Phase 3 of the portability design). Empty / missing /
// malformed config silently degrades to "no third-party providers" — the
// CLI never crashes from a bad config file.
//
// Two precedence sources:
//   1. ANATOMY_PASS2_PROVIDERS env var: comma-separated package names. Wins
//      over the file when both are set; useful for CI and one-off testing.
//   2. .anatomy-cli.toml [pass2] section. Schema:
//        [pass2]
//        providers = ["anatomy-pass2-gemini", "@org/my-provider"]
//        default   = "anatomy-pass2-gemini"  # optional

import { existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { readAnatomyFile } from "../../io.js";

export interface Pass2Config {
  /** Third-party provider package specifiers to dynamic-import. */
  providers: string[];
  /** Optional default provider name (used when --provider isn't passed and
   *  ANATOMY_PASS2_PROVIDER isn't set). */
  defaultProvider?: string;
}

export function readPass2Config(repoRoot: string): Pass2Config | null {
  // Env-var override: comma-separated package names.
  const fromEnv = process.env.ANATOMY_PASS2_PROVIDERS;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    const providers = fromEnv.split(",").map(s => s.trim()).filter(Boolean);
    if (providers.length > 0) return { providers };
  }

  const path = join(repoRoot, ".anatomy-cli.toml");
  if (!existsSync(path)) return null;

  let text: string;
  try {
    text = readAnatomyFile(path);
  } catch (err) {
    process.stderr.write(`anatomy: ignoring .anatomy-cli.toml — ${err instanceof Error ? err.message : String(err)}\n`);
    return null;
  }

  let parsed: unknown;
  try {
    parsed = parseToml(text);
  } catch (err) {
    process.stderr.write(`anatomy: ignoring malformed .anatomy-cli.toml — ${err instanceof Error ? err.message : String(err)}\n`);
    return null;
  }

  const pass2 = (parsed as { pass2?: unknown }).pass2;
  if (!pass2 || typeof pass2 !== "object") return null;

  const obj = pass2 as { providers?: unknown; default?: unknown };
  const providers = Array.isArray(obj.providers)
    ? obj.providers.filter((s): s is string => typeof s === "string")
    : [];
  const defaultProvider = typeof obj.default === "string" ? obj.default : undefined;

  if (providers.length === 0 && defaultProvider === undefined) return null;
  return { providers, defaultProvider };
}
