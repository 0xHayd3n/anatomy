// src/pass2/providers/openai-http.ts
// OpenAI-compatible HTTP provider. Targets the /v1/chat/completions surface,
// which is the de-facto standard supported by OpenAI, vLLM, llama.cpp's
// server mode, OpenRouter, Together, and most local inference frameworks.
//
// Auth: OPENAI_API_KEY (preferred) or ANATOMY_PASS2_API_KEY (fallback).
// Endpoint: OPENAI_BASE_URL or ANATOMY_PASS2_BASE_URL, defaulting to
//           https://api.openai.com (no trailing /v1 — that's appended).

import { ProviderError, type Pass2Provider, type ProviderInput } from "./types.js";

const DEFAULT_BASE_URL = "https://api.openai.com";
const DEFAULT_MODEL = "gpt-4o";
const DEFAULT_MAX_TOKENS = 8000;

function apiKey(): string | undefined {
  return process.env.OPENAI_API_KEY ?? process.env.ANATOMY_PASS2_API_KEY;
}

function baseUrl(): string {
  return process.env.OPENAI_BASE_URL ?? process.env.ANATOMY_PASS2_BASE_URL ?? DEFAULT_BASE_URL;
}

function defaultModel(): string {
  return process.env.ANATOMY_PASS2_MODEL ?? DEFAULT_MODEL;
}

export const openaiHttpProvider: Pass2Provider = {
  name: "openai-http",
  description: "OpenAI-compatible HTTP API (works with OpenAI, vLLM, llama.cpp server, OpenRouter, etc.). Set OPENAI_API_KEY + optionally OPENAI_BASE_URL.",

  async available(): Promise<boolean> {
    return typeof apiKey() === "string" && apiKey()!.length > 0;
  },

  async generate(input: ProviderInput): Promise<string> {
    const key = apiKey();
    if (!key) {
      throw new ProviderError(
        "pass2-provider-auth",
        "openai-http: OPENAI_API_KEY (or ANATOMY_PASS2_API_KEY) is not set",
      );
    }

    const url = `${baseUrl().replace(/\/$/, "")}/v1/chat/completions`;
    const body = {
      model: input.model ?? defaultModel(),
      messages: [
        { role: "system", content: input.systemPrompt },
        { role: "user",   content: input.userPrompt },
      ],
      temperature: input.temperature ?? 0,
      max_tokens: input.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
      // JSON-mode: instructs OpenAI to return a parseable JSON body. Many
      // OpenAI-compatible servers honor this; those that don't fall back
      // to the CLI's extractJson tolerance for fenced/embedded JSON.
      response_format: { type: "json_object" },
      ...(input.seed !== undefined ? { seed: input.seed } : {}),
    };

    let resp: Response;
    try {
      resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${key}`,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new ProviderError(
        "pass2-provider-network",
        `openai-http: fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!resp.ok) {
      const text = await safeReadText(resp);
      const code = mapStatusToCode(resp.status);
      throw new ProviderError(code, `openai-http: ${resp.status} ${resp.statusText}: ${text.slice(0, 500)}`);
    }

    let parsed: unknown;
    try {
      parsed = await resp.json();
    } catch (err) {
      throw new ProviderError(
        "pass2-provider-parse",
        `openai-http: response was not JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Standard Chat Completions shape: { choices: [{ message: { content: "..." } }] }
    const content = (parsed as { choices?: Array<{ message?: { content?: unknown } }> })
      ?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new ProviderError(
        "pass2-provider-parse",
        `openai-http: response missing choices[0].message.content; first 200 chars of body: ${JSON.stringify(parsed).slice(0, 200)}`,
      );
    }
    return content;
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
