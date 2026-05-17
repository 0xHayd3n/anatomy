// src/pass2/providers/anthropic-http.ts
// Direct Anthropic Messages API provider. Useful when the user has an
// Anthropic API key but does not have Claude Code installed (or wants
// to point at a specific model rather than letting Claude Code pick).
//
// Auth: ANTHROPIC_API_KEY (preferred) or ANATOMY_PASS2_API_KEY (fallback).
// Endpoint: https://api.anthropic.com/v1/messages.
// Headers: x-api-key + anthropic-version (frozen at "2023-06-01").

import { ProviderError, type Pass2Provider, type ProviderInput } from "./types.js";

const ENDPOINT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_MAX_TOKENS = 8000;

function apiKey(): string | undefined {
  return process.env.ANTHROPIC_API_KEY ?? process.env.ANATOMY_PASS2_API_KEY;
}

function defaultModel(): string {
  return process.env.ANATOMY_PASS2_MODEL ?? DEFAULT_MODEL;
}

export const anthropicHttpProvider: Pass2Provider = {
  name: "anthropic-http",
  description: "Anthropic Messages API direct (no Claude Code CLI required). Set ANTHROPIC_API_KEY.",

  async available(): Promise<boolean> {
    return typeof apiKey() === "string" && apiKey()!.length > 0;
  },

  async generate(input: ProviderInput): Promise<string> {
    const key = apiKey();
    if (!key) {
      throw new ProviderError(
        "pass2-provider-auth",
        "anthropic-http: ANTHROPIC_API_KEY (or ANATOMY_PASS2_API_KEY) is not set",
      );
    }

    const body = {
      model: input.model ?? defaultModel(),
      max_tokens: input.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
      // Anthropic's API takes the system prompt as a top-level field, separate
      // from messages. The single user message carries the dynamic context.
      system: input.systemPrompt,
      messages: [{ role: "user", content: input.userPrompt }],
      temperature: input.temperature ?? 0,
    };

    let resp: Response;
    try {
      resp = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new ProviderError(
        "pass2-provider-network",
        `anthropic-http: fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!resp.ok) {
      const text = await safeReadText(resp);
      const code = mapStatusToCode(resp.status);
      throw new ProviderError(code, `anthropic-http: ${resp.status} ${resp.statusText}: ${text.slice(0, 500)}`);
    }

    let parsed: unknown;
    try {
      parsed = await resp.json();
    } catch (err) {
      throw new ProviderError(
        "pass2-provider-parse",
        `anthropic-http: response was not JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Anthropic Messages shape: { content: [{ type: "text", text: "..." }, ...] }
    // We concatenate all text blocks (usually only one) and ignore non-text
    // (e.g. tool_use) since the contract doesn't request tool calls.
    const blocks = (parsed as { content?: Array<{ type?: string; text?: unknown }> })?.content;
    if (!Array.isArray(blocks)) {
      throw new ProviderError(
        "pass2-provider-parse",
        `anthropic-http: response missing content array; first 200 chars of body: ${JSON.stringify(parsed).slice(0, 200)}`,
      );
    }
    const text = blocks
      .filter(b => b?.type === "text" && typeof b.text === "string")
      .map(b => b.text as string)
      .join("");
    if (text.length === 0) {
      throw new ProviderError(
        "pass2-provider-parse",
        `anthropic-http: response had no text blocks; first 200 chars of body: ${JSON.stringify(parsed).slice(0, 200)}`,
      );
    }
    return text;
  },
};

function mapStatusToCode(status: number): "pass2-provider-auth" | "pass2-provider-quota" | "pass2-provider-network" {
  if (status === 401 || status === 403) return "pass2-provider-auth";
  if (status === 429) return "pass2-provider-quota";
  return "pass2-provider-network";
}

async function safeReadText(resp: Response): Promise<string> {
  try { return await resp.text(); } catch { return ""; }
}
