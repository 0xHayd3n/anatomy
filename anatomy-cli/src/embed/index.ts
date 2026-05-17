// src/embed/index.ts
// Shared lazy loader for @xenova/transformers (optional dep). Used by
// verify-suggest's registry embedding and the anatomy_brief MCP tool.
// Returns null silently when the dep is not installed — callers handle
// that case explicitly rather than crashing.

type Embedder = ((texts: string[]) => Promise<number[][]>) | null;

let embedderOverride: Embedder | undefined;
let _embedderPromise: Promise<Embedder> | null = null;

export function _setEmbedderForTesting(embedder: Embedder | undefined): void {
  embedderOverride = embedder;
  _embedderPromise = null;
}

/** True when ANATOMY_DISABLE_EMBEDDINGS is set to anything other than "0" /
 *  "false" / "" — mirrors the ANATOMY_TELEMETRY_DISABLE convention
 *  (see src/telemetry.ts). The subprocess-based CLI tests use this to force
 *  lexical-only ranking deterministically, since the in-process
 *  _setEmbedderForTesting hook cannot reach a spawned `dist/bin.js`. */
export function embeddingsDisabledByEnv(): boolean {
  const v = process.env.ANATOMY_DISABLE_EMBEDDINGS;
  return !!v && v !== "0" && v.toLowerCase() !== "false";
}

export function loadEmbedder(): Promise<Embedder> {
  // An explicit in-process test override beats the env switch: a test that
  // injects a fake embedder wants that embedder regardless of a leaked env var.
  if (embedderOverride !== undefined) return Promise.resolve(embedderOverride);
  if (embeddingsDisabledByEnv()) return Promise.resolve(null);
  if (_embedderPromise) return _embedderPromise;
  _embedderPromise = (async () => {
    try {
      // "as string" prevents TS from statically resolving the optional dep
      // at compile time — anatomy-cli builds without @xenova/transformers
      // installed.
      const mod = await import("@xenova/transformers" as string);
      const pipe = await (mod as {
        pipeline: (task: string, model: string) =>
          Promise<(text: string, opts: object) => Promise<{ data: Float32Array }>>
      }).pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
      return async (texts: string[]) => {
        const out: number[][] = [];
        for (const t of texts) {
          const result = await pipe(t, { pooling: "mean", normalize: true });
          out.push(Array.from(result.data));
        }
        return out;
      };
    } catch {
      return null;
    }
  })();
  return _embedderPromise;
}

export async function embedQuery(text: string): Promise<number[] | null> {
  const embedder = await loadEmbedder();
  if (!embedder) return null;
  try {
    const [vec] = await embedder([text]);
    return vec;
  } catch {
    // A per-call inference failure (transient model error) degrades to "no
    // embedding" rather than propagating — callers treat null as lexical-only.
    return null;
  }
}

export async function embedBatch(texts: string[]): Promise<number[][] | null> {
  if (texts.length === 0) return [];
  const embedder = await loadEmbedder();
  if (!embedder) return null;
  try {
    return await embedder(texts);
  } catch {
    return null;
  }
}

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}
