// src/pass2/providers/index.ts
// Provider registry + selection logic. Built-in providers register here at
// module load; third-party providers (Phase 3) load lazily from the
// .anatomy-cli.toml config or ANATOMY_PASS2_PROVIDERS env var on first call.

import { claudeCliProvider } from "./claude-cli.js";
import { openaiHttpProvider } from "./openai-http.js";
import { anthropicHttpProvider } from "./anthropic-http.js";
import { readPass2Config } from "./config.js";
import { loadThirdPartyProvider } from "./loader.js";
import { ProviderError, type Pass2Provider } from "./types.js";

// Order matters for auto-detect: claude-cli is checked first because it
// represents the lowest-friction setup (already-authed Claude Code session,
// no API-key plumbing). The HTTP providers come next, so a user with both
// Claude Code installed AND an ANTHROPIC_API_KEY set still gets claude-cli
// by default. Override with --provider <name> or ANATOMY_PASS2_PROVIDER.
const BUILT_IN: Pass2Provider[] = [
  claudeCliProvider,
  anthropicHttpProvider,
  openaiHttpProvider,
];

// Third-party providers are loaded once per process from .anatomy-cli.toml /
// ANATOMY_PASS2_PROVIDERS. The cache is keyed on the cwd at first call so
// switching directories doesn't silently change the provider set; use
// _resetThirdPartyCache() in tests when you need to re-read.
let thirdPartyCache: { cwd: string; providers: Pass2Provider[]; defaultProvider?: string } | null = null;

async function ensureThirdPartyLoaded(): Promise<{ providers: Pass2Provider[]; defaultProvider?: string }> {
  const cwd = process.cwd();
  if (thirdPartyCache && thirdPartyCache.cwd === cwd) {
    return { providers: thirdPartyCache.providers, defaultProvider: thirdPartyCache.defaultProvider };
  }

  const cfg = readPass2Config(cwd);
  const loaded: Pass2Provider[] = [];
  if (cfg) {
    for (const spec of cfg.providers) {
      // Skip names that match built-ins — the user listed claude-cli /
      // openai-http / anthropic-http as a reminder, not as a request to
      // dynamic-import a same-named third-party shadow.
      if (BUILT_IN.find(p => p.name === spec)) continue;
      const p = await loadThirdPartyProvider(spec);
      if (p) loaded.push(p);
    }
  }
  thirdPartyCache = { cwd, providers: loaded, defaultProvider: cfg?.defaultProvider };
  return { providers: loaded, defaultProvider: cfg?.defaultProvider };
}

/** Reset the third-party provider cache. Test-only; not part of the public
 *  API surface that downstream consumers should depend on. */
export function _resetThirdPartyCache(): void {
  thirdPartyCache = null;
}

/** Return all known providers in registration order: built-ins first, then
 *  any third-party providers loaded from config in declaration order. */
export async function listProviders(): Promise<Pass2Provider[]> {
  const { providers: thirdParty } = await ensureThirdPartyLoaded();
  return [...BUILT_IN, ...thirdParty];
}

/** Look up a provider by exact name. Returns undefined if not registered. */
export async function getProvider(name: string): Promise<Pass2Provider | undefined> {
  const all = await listProviders();
  return all.find(p => p.name === name);
}

/** Resolve which provider to use, with four-level precedence:
 *    1. explicit name argument (from --provider <name>)
 *    2. ANATOMY_PASS2_PROVIDER env var
 *    3. .anatomy-cli.toml [pass2].default
 *    4. auto-detect: first registered provider whose available() returns true
 *
 *  Throws ProviderError("pass2-provider-not-available") if no provider is
 *  reachable at all or if the explicit name is unknown. */
export async function selectProvider(explicit?: string): Promise<Pass2Provider> {
  if (explicit) {
    const p = await getProvider(explicit);
    if (!p) {
      const known = (await listProviders()).map(b => b.name).join(", ");
      throw new ProviderError(
        "pass2-provider-not-available",
        `unknown provider "${explicit}" (known: ${known})`,
      );
    }
    return p;
  }
  const fromEnv = process.env.ANATOMY_PASS2_PROVIDER;
  if (typeof fromEnv === "string" && fromEnv.length > 0) {
    return selectProvider(fromEnv);
  }
  const { providers: thirdParty, defaultProvider } = await ensureThirdPartyLoaded();
  if (defaultProvider) {
    return selectProvider(defaultProvider);
  }
  for (const p of [...BUILT_IN, ...thirdParty]) {
    if (await p.available()) return p;
  }
  throw new ProviderError(
    "pass2-provider-not-available",
    "no Pass 2 provider available — install Claude Code (claude-cli, default), or set " +
      "ANTHROPIC_API_KEY (anthropic-http), OPENAI_API_KEY (openai-http), " +
      "or override with ANATOMY_PASS2_PROVIDER=<name>",
  );
}

export { ProviderError, type Pass2Provider, type ProviderInput, type ProviderErrorCode } from "./types.js";
