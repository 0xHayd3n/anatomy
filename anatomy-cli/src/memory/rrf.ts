// src/memory/rrf.ts
// Pure reciprocal rank fusion. No I/O, no domain types beyond string ids.
// score(id) = sum over each list containing id of 1 / (k + rank), where
// rank is 1-based and the first (best) occurrence of an id in a list wins.
// k=60 is the standard RRF constant (Cormack et al. 2009).

export const RRF_K = 60;

export function rrfFuse(
  lexicalIdsRanked: string[],
  denseIdsRanked: string[],
  k: number = RRF_K,
): Map<string, number> {
  const scores = new Map<string, number>();
  for (const list of [lexicalIdsRanked, denseIdsRanked]) {
    const seen = new Set<string>();
    for (let i = 0; i < list.length; i++) {
      const id = list[i];
      if (seen.has(id)) continue; // first occurrence = best rank
      seen.add(id);
      const contribution = 1 / (k + i + 1); // i is 0-based; rank is i+1
      scores.set(id, (scores.get(id) ?? 0) + contribution);
    }
  }
  return scores;
}
