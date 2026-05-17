// src/pass2/providers/types.ts
// Pass 2 provider interface — the model-agnostic contract any LLM backend
// must satisfy to fill in TODO fields during `anatomy generate --ai`.
// See spec/0.8/pass2-prompt-contract.md for the normative description.

/** Free-form input bundled into a single Pass 2 invocation. The system
 *  prompt is frozen per schema version (kept verbatim from
 *  spec/<ver>/pass2-prompt-contract.md); the user prompt is the dynamic
 *  Pass 1 + repo-context payload. */
export interface ProviderInput {
  /** The frozen system prompt for the schema version being generated. */
  systemPrompt: string;
  /** The dynamic per-repo context: TODO manifest + README + entry-point head
   *  + structure summary + git log + test/import samples. */
  userPrompt: string;
  /** Sampling temperature. Default 0 (deterministic). Some providers ignore. */
  temperature?: number;
  /** Output token cap. Default 8000. */
  maxOutputTokens?: number;
  /** Provider-specific model identifier (e.g. "gpt-4o", "claude-sonnet-4-6").
   *  Each provider has its own default. */
  model?: string;
  /** Optional seed for providers that support it. */
  seed?: number;
}

/** Categorical error codes a Pass 2 provider can surface. The CLI maps these
 *  to user-facing error messages with consistent shape regardless of which
 *  provider was selected. */
export type ProviderErrorCode =
  | "pass2-provider-network"
  | "pass2-provider-auth"
  | "pass2-provider-quota"
  | "pass2-provider-parse"
  | "pass2-provider-schema"
  | "pass2-provider-not-available";

export class ProviderError extends Error {
  constructor(public readonly code: ProviderErrorCode, message: string) {
    super(message);
    this.name = "ProviderError";
  }
}

/** Pass 2 LLM-call backend. Each provider owns its own auth, transport, and
 *  default model. The CLI only knows the contract: send a system + user
 *  prompt, get a string back. JSON extraction and schema validation happen
 *  in the orchestrator (pass2/index.ts), not the provider. */
export interface Pass2Provider {
  /** Stable identifier. Matches the value users pass to `--provider <name>`. */
  name: string;
  /** Human-readable one-liner shown in `anatomy generate --providers`. */
  description: string;
  /** Returns true if this provider can run in the current environment
   *  (PATH, env vars, network reachability). Used by auto-detection so the
   *  CLI picks the first available provider when the user doesn't specify. */
  available(): Promise<boolean>;
  /** Issue a Pass 2 fill. Throws ProviderError on failure. The returned
   *  string is the raw provider response — the CLI extracts JSON from it. */
  generate(input: ProviderInput): Promise<string>;
}
