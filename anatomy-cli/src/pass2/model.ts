// src/pass2/model.ts
// Pass 2 model selection + provenance id. Pure; no I/O. The CLI reads
// process.env at its boundary and passes the value in.

/**
 * Resolve the Pass 2 model. Precedence: explicit flag > env var >
 * undefined (meaning "use the provider's own default" — today's behavior).
 * Empty / whitespace-only strings count as unset.
 */
export function resolveModel(flag?: string, env?: string): string | undefined {
  const f = flag?.trim();
  if (f) return f;
  const e = env?.trim();
  if (e) return e;
  return undefined;
}

/**
 * The provenance string written to `[generated].model`. When no model
 * override is in effect the legacy literal is preserved (continuity with
 * v0.10-and-earlier .anatomy files / fixtures): claude-cli -> "claude-code",
 * any other provider -> its own name. When a model IS chosen, encode both
 * provider and model so a reader can tell exactly what produced the
 * human-knowledge fields.
 */
export function pass2ModelId(providerName: string, model?: string): string {
  if (model) return `${providerName}:${model}`;
  return providerName === "claude-cli" ? "claude-code" : providerName;
}
