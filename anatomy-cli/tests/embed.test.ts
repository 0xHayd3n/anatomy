import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  embedQuery,
  loadEmbedder,
  embeddingsDisabledByEnv,
  _setEmbedderForTesting,
  cosine,
} from "../src/embed/index.js";

describe("embed (shared)", () => {
  beforeEach(() => _setEmbedderForTesting(undefined));

  it("returns null when no embedder is available", async () => {
    _setEmbedderForTesting(null);
    expect(await embedQuery("hello")).toBeNull();
  });

  it("returns the injected embedder's output for a single query", async () => {
    _setEmbedderForTesting(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3]));
    expect(await embedQuery("hello")).toEqual([0.1, 0.2, 0.3]);
  });

  it("cosine returns 1 for identical normalized vectors", () => {
    const a = [1 / Math.sqrt(2), 1 / Math.sqrt(2), 0];
    expect(cosine(a, a)).toBeCloseTo(1, 5);
  });

  it("cosine returns 0 for orthogonal vectors", () => {
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });

  it("cosine returns 0 for length-mismatched or empty inputs", () => {
    expect(cosine([], [1, 0])).toBe(0);
    expect(cosine([1, 0, 0], [1, 0])).toBe(0);
  });
});

describe("ANATOMY_DISABLE_EMBEDDINGS escape hatch", () => {
  const KEY = "ANATOMY_DISABLE_EMBEDDINGS";
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env[KEY];
    delete process.env[KEY];
    _setEmbedderForTesting(undefined);
  });
  afterEach(() => {
    if (saved === undefined) delete process.env[KEY];
    else process.env[KEY] = saved;
    _setEmbedderForTesting(undefined);
  });

  it("parses truthy/falsy per the ANATOMY_TELEMETRY_DISABLE convention", () => {
    for (const v of ["1", "true", "TRUE", "yes", "on"]) {
      process.env[KEY] = v;
      expect(embeddingsDisabledByEnv()).toBe(true);
    }
    for (const v of ["0", "false", "False", ""]) {
      process.env[KEY] = v;
      expect(embeddingsDisabledByEnv()).toBe(false);
    }
    delete process.env[KEY];
    expect(embeddingsDisabledByEnv()).toBe(false);
  });

  it("loadEmbedder resolves null when disabled and no test override is set", async () => {
    process.env[KEY] = "1";
    expect(await loadEmbedder()).toBeNull();
  });

  it("an explicit test override beats the env disable", async () => {
    process.env[KEY] = "1";
    const fake = async (texts: string[]) => texts.map(() => [9, 9, 9]);
    _setEmbedderForTesting(fake);
    expect(await loadEmbedder()).toBe(fake);
  });

  it("embedQuery degrades to null under the env disable", async () => {
    process.env[KEY] = "1";
    expect(await embedQuery("anything")).toBeNull();
  });
});
