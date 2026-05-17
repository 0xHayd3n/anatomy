// src/verify-suggest/registry/match.ts
// Pure math: cosine similarity + top-1 over threshold.

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface MatchResult {
  id: string;
  similarity: number;
}

export function topMatch(
  query: number[],
  corpus: Map<string, number[]>,
  threshold: number,
): MatchResult | null {
  let best: MatchResult | null = null;
  for (const [id, vec] of corpus) {
    const sim = cosineSimilarity(query, vec);
    if (sim < threshold) continue;
    if (!best || sim > best.similarity) best = { id, similarity: sim };
  }
  return best;
}
