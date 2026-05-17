import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { openaiHttpProvider } from "../src/pass2/providers/openai-http.js";
import { anthropicHttpProvider } from "../src/pass2/providers/anthropic-http.js";
import { ProviderError } from "../src/pass2/providers/types.js";

const SAMPLE_INPUT = {
  systemPrompt: "system content",
  userPrompt: "user content",
};

// Snapshot env vars so tests can mutate freely without leaking.
const ENV_KEYS = [
  "OPENAI_API_KEY", "OPENAI_BASE_URL",
  "ANTHROPIC_API_KEY",
  "ANATOMY_PASS2_API_KEY", "ANATOMY_PASS2_BASE_URL", "ANATOMY_PASS2_MODEL",
] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.restoreAllMocks();
});

function mockFetchOnce(response: { ok: boolean; status: number; statusText?: string; body: unknown; bodyText?: string }) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
    ok: response.ok,
    status: response.status,
    statusText: response.statusText ?? (response.ok ? "OK" : "Error"),
    json: async () => response.body,
    text: async () => response.bodyText ?? JSON.stringify(response.body),
  } as Response);
}

// ── openai-http ──────────────────────────────────────────────────────────────

describe("openaiHttpProvider", () => {
  describe("available()", () => {
    it("false when neither OPENAI_API_KEY nor ANATOMY_PASS2_API_KEY is set", async () => {
      expect(await openaiHttpProvider.available()).toBe(false);
    });
    it("true when OPENAI_API_KEY is set", async () => {
      process.env.OPENAI_API_KEY = "sk-test";
      expect(await openaiHttpProvider.available()).toBe(true);
    });
    it("true when ANATOMY_PASS2_API_KEY is set as fallback", async () => {
      process.env.ANATOMY_PASS2_API_KEY = "sk-fallback";
      expect(await openaiHttpProvider.available()).toBe(true);
    });
  });

  describe("generate()", () => {
    it("throws pass2-provider-auth when API key is missing", async () => {
      try {
        await openaiHttpProvider.generate(SAMPLE_INPUT);
        expect.fail("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(ProviderError);
        expect((err as ProviderError).code).toBe("pass2-provider-auth");
      }
    });

    it("POSTs to /v1/chat/completions with correct shape and returns the content", async () => {
      process.env.OPENAI_API_KEY = "sk-test-key";
      const spy = mockFetchOnce({
        ok: true, status: 200,
        body: { choices: [{ message: { content: '{"identity_domain": "developer-tools"}' } }] },
      });
      const out = await openaiHttpProvider.generate(SAMPLE_INPUT);
      expect(out).toBe('{"identity_domain": "developer-tools"}');

      expect(spy).toHaveBeenCalledTimes(1);
      const [url, init] = spy.mock.calls[0];
      expect(url).toBe("https://api.openai.com/v1/chat/completions");
      expect(init?.method).toBe("POST");
      const headers = init?.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe("Bearer sk-test-key");
      expect(headers["Content-Type"]).toBe("application/json");
      const body = JSON.parse(init?.body as string);
      expect(body.model).toBe("gpt-4o");
      expect(body.messages).toEqual([
        { role: "system", content: "system content" },
        { role: "user", content: "user content" },
      ]);
      expect(body.temperature).toBe(0);
      expect(body.response_format).toEqual({ type: "json_object" });
    });

    it("respects OPENAI_BASE_URL override (vLLM / OpenRouter / local)", async () => {
      process.env.OPENAI_API_KEY = "k";
      process.env.OPENAI_BASE_URL = "https://my.local.ai";
      const spy = mockFetchOnce({
        ok: true, status: 200,
        body: { choices: [{ message: { content: "{}" } }] },
      });
      await openaiHttpProvider.generate(SAMPLE_INPUT);
      expect(spy.mock.calls[0][0]).toBe("https://my.local.ai/v1/chat/completions");
    });

    it("strips a trailing slash from OPENAI_BASE_URL before appending /v1/...", async () => {
      process.env.OPENAI_API_KEY = "k";
      process.env.OPENAI_BASE_URL = "https://my.local.ai/";
      const spy = mockFetchOnce({
        ok: true, status: 200,
        body: { choices: [{ message: { content: "{}" } }] },
      });
      await openaiHttpProvider.generate(SAMPLE_INPUT);
      expect(spy.mock.calls[0][0]).toBe("https://my.local.ai/v1/chat/completions");
    });

    it("respects ANATOMY_PASS2_MODEL override on default model", async () => {
      process.env.OPENAI_API_KEY = "k";
      process.env.ANATOMY_PASS2_MODEL = "gpt-4o-mini";
      const spy = mockFetchOnce({
        ok: true, status: 200,
        body: { choices: [{ message: { content: "{}" } }] },
      });
      await openaiHttpProvider.generate(SAMPLE_INPUT);
      const body = JSON.parse(spy.mock.calls[0][1]?.body as string);
      expect(body.model).toBe("gpt-4o-mini");
    });

    it("explicit input.model wins over env override", async () => {
      process.env.OPENAI_API_KEY = "k";
      process.env.ANATOMY_PASS2_MODEL = "from-env";
      const spy = mockFetchOnce({
        ok: true, status: 200,
        body: { choices: [{ message: { content: "{}" } }] },
      });
      await openaiHttpProvider.generate({ ...SAMPLE_INPUT, model: "from-arg" });
      const body = JSON.parse(spy.mock.calls[0][1]?.body as string);
      expect(body.model).toBe("from-arg");
    });

    it("maps 401 to pass2-provider-auth", async () => {
      process.env.OPENAI_API_KEY = "k";
      mockFetchOnce({ ok: false, status: 401, statusText: "Unauthorized", body: { error: "bad key" } });
      try {
        await openaiHttpProvider.generate(SAMPLE_INPUT);
        expect.fail("expected throw");
      } catch (err) {
        expect((err as ProviderError).code).toBe("pass2-provider-auth");
      }
    });

    it("maps 429 to pass2-provider-quota", async () => {
      process.env.OPENAI_API_KEY = "k";
      mockFetchOnce({ ok: false, status: 429, statusText: "Too Many Requests", body: { error: "rate limit" } });
      try {
        await openaiHttpProvider.generate(SAMPLE_INPUT);
        expect.fail("expected throw");
      } catch (err) {
        expect((err as ProviderError).code).toBe("pass2-provider-quota");
      }
    });

    it("maps 500 to pass2-provider-network", async () => {
      process.env.OPENAI_API_KEY = "k";
      mockFetchOnce({ ok: false, status: 500, statusText: "Internal Server Error", body: { error: "boom" } });
      try {
        await openaiHttpProvider.generate(SAMPLE_INPUT);
        expect.fail("expected throw");
      } catch (err) {
        expect((err as ProviderError).code).toBe("pass2-provider-network");
      }
    });

    it("throws pass2-provider-parse when response shape is wrong", async () => {
      process.env.OPENAI_API_KEY = "k";
      mockFetchOnce({ ok: true, status: 200, body: { unexpected: "shape" } });
      try {
        await openaiHttpProvider.generate(SAMPLE_INPUT);
        expect.fail("expected throw");
      } catch (err) {
        expect((err as ProviderError).code).toBe("pass2-provider-parse");
      }
    });

    it("propagates fetch network failure as pass2-provider-network", async () => {
      process.env.OPENAI_API_KEY = "k";
      vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("ECONNREFUSED"));
      try {
        await openaiHttpProvider.generate(SAMPLE_INPUT);
        expect.fail("expected throw");
      } catch (err) {
        expect((err as ProviderError).code).toBe("pass2-provider-network");
        expect((err as ProviderError).message).toContain("ECONNREFUSED");
      }
    });
  });
});

// ── anthropic-http ───────────────────────────────────────────────────────────

describe("anthropicHttpProvider", () => {
  describe("available()", () => {
    it("false when neither ANTHROPIC_API_KEY nor ANATOMY_PASS2_API_KEY is set", async () => {
      expect(await anthropicHttpProvider.available()).toBe(false);
    });
    it("true when ANTHROPIC_API_KEY is set", async () => {
      process.env.ANTHROPIC_API_KEY = "sk-ant-test";
      expect(await anthropicHttpProvider.available()).toBe(true);
    });
  });

  describe("generate()", () => {
    it("throws pass2-provider-auth when API key is missing", async () => {
      try {
        await anthropicHttpProvider.generate(SAMPLE_INPUT);
        expect.fail("expected throw");
      } catch (err) {
        expect((err as ProviderError).code).toBe("pass2-provider-auth");
      }
    });

    it("POSTs to /v1/messages with system + user shape and returns concatenated text", async () => {
      process.env.ANTHROPIC_API_KEY = "sk-ant-key";
      const spy = mockFetchOnce({
        ok: true, status: 200,
        body: { content: [{ type: "text", text: '{"identity_domain": "x"}' }] },
      });
      const out = await anthropicHttpProvider.generate(SAMPLE_INPUT);
      expect(out).toBe('{"identity_domain": "x"}');

      const [url, init] = spy.mock.calls[0];
      expect(url).toBe("https://api.anthropic.com/v1/messages");
      const headers = init?.headers as Record<string, string>;
      expect(headers["x-api-key"]).toBe("sk-ant-key");
      expect(headers["anthropic-version"]).toBe("2023-06-01");
      expect(headers["Content-Type"]).toBe("application/json");
      const body = JSON.parse(init?.body as string);
      expect(body.system).toBe("system content");
      expect(body.messages).toEqual([{ role: "user", content: "user content" }]);
      expect(body.temperature).toBe(0);
      expect(body.model).toBe("claude-sonnet-4-6");
    });

    it("concatenates multiple text blocks and ignores non-text blocks", async () => {
      process.env.ANTHROPIC_API_KEY = "k";
      mockFetchOnce({
        ok: true, status: 200,
        body: {
          content: [
            { type: "text", text: "hello " },
            { type: "tool_use", id: "x", name: "y", input: {} },
            { type: "text", text: "world" },
          ],
        },
      });
      const out = await anthropicHttpProvider.generate(SAMPLE_INPUT);
      expect(out).toBe("hello world");
    });

    it("maps 401 to pass2-provider-auth, 429 to quota, 500 to network", async () => {
      process.env.ANTHROPIC_API_KEY = "k";
      const cases: Array<[number, string]> = [
        [401, "pass2-provider-auth"],
        [429, "pass2-provider-quota"],
        [500, "pass2-provider-network"],
      ];
      for (const [status, expected] of cases) {
        mockFetchOnce({ ok: false, status, body: { error: "x" } });
        try {
          await anthropicHttpProvider.generate(SAMPLE_INPUT);
          expect.fail(`expected throw for ${status}`);
        } catch (err) {
          expect((err as ProviderError).code).toBe(expected);
        }
      }
    });

    it("throws pass2-provider-parse when response has no text blocks", async () => {
      process.env.ANTHROPIC_API_KEY = "k";
      mockFetchOnce({ ok: true, status: 200, body: { content: [{ type: "tool_use", id: "x", name: "y", input: {} }] } });
      try {
        await anthropicHttpProvider.generate(SAMPLE_INPUT);
        expect.fail("expected throw");
      } catch (err) {
        expect((err as ProviderError).code).toBe("pass2-provider-parse");
      }
    });

    it("throws pass2-provider-parse when response is missing the content array entirely", async () => {
      process.env.ANTHROPIC_API_KEY = "k";
      mockFetchOnce({ ok: true, status: 200, body: { something_else: true } });
      try {
        await anthropicHttpProvider.generate(SAMPLE_INPUT);
        expect.fail("expected throw");
      } catch (err) {
        expect((err as ProviderError).code).toBe("pass2-provider-parse");
      }
    });
  });
});
