// src/pass2/providers/loader.ts
// Dynamic-import wrapper for third-party Pass 2 provider packages.
// Each package MUST default-export an object satisfying the Pass2Provider
// interface (see ./types.ts and spec/0.8/pass2-prompt-contract.md §5).
//
// Failure modes are non-fatal: unknown package, import error, or wrong
// shape produce a stderr warning and the loader returns null. The CLI
// continues with the providers that did load successfully.

import type { Pass2Provider } from "./types.js";

/** Structural type-guard. The loader can't import the actual TS type from
 *  user code at runtime (third-party providers ship as compiled JS), so we
 *  validate the duck-typed shape instead. */
export function isPass2Provider(x: unknown): x is Pass2Provider {
  if (!x || typeof x !== "object") return false;
  const obj = x as Record<string, unknown>;
  return typeof obj.name === "string"
    && obj.name.length > 0
    && typeof obj.description === "string"
    && typeof obj.available === "function"
    && typeof obj.generate === "function";
}

/** Resolve a package's default export and validate its Pass2Provider shape.
 *  Tolerates both `module.default` (ES default) and the module itself being
 *  the provider (for transpiled CJS that exports the object directly). */
export function resolveProviderExport(mod: unknown): Pass2Provider | null {
  if (!mod || typeof mod !== "object") return null;
  const candidate = (mod as { default?: unknown }).default ?? mod;
  if (isPass2Provider(candidate)) return candidate;
  return null;
}

/** Dynamic-import a package by name and return the validated provider, or
 *  null on any failure. Writes a single stderr line per failure so users
 *  can debug their config. */
export async function loadThirdPartyProvider(packageSpecifier: string): Promise<Pass2Provider | null> {
  let mod: unknown;
  try {
    mod = await import(packageSpecifier);
  } catch (err) {
    process.stderr.write(
      `anatomy: failed to load Pass 2 provider "${packageSpecifier}" — ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return null;
  }
  const provider = resolveProviderExport(mod);
  if (!provider) {
    process.stderr.write(
      `anatomy: "${packageSpecifier}" loaded but its default export is not a valid Pass2Provider (must have name, description, available(), generate())\n`,
    );
    return null;
  }
  return provider;
}
