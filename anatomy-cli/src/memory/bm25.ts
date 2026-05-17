// src/memory/bm25.ts
// Pure BM25F implementation for .anatomy-memory search. No I/O, no decay
// logic. The orchestrator in search.ts composes BM25 scores with decay
// multipliers; this module owns the lexical / arithmetic core only.
//
// Field weights (topic > tags > content) reflect that topic is the entry's
// TL;DR — strongest relevance signal. k1 and b are standard BM25 defaults.

export const FIELD_WEIGHTS = { topic: 3.0, tags: 2.0, content: 1.0 } as const;
export const BM25_K1 = 1.2;
export const BM25_B = 0.75;

// Deliberately omits @, /, ., -, _ from the split class so identifiers like @scope/pkg, src/path.ts, snake_case, and kebab-case survive as single tokens.
const PUNCT_SPLIT_RE = /[\s,;:!?(){}\[\]<>'"`\\]+/;

/** Lowercase + split on whitespace and non-identifier punctuation.
 *  Preserves /, ., -, _, @ so technical identifiers (paths, scoped packages,
 *  memory IDs, snake_case, kebab-case) survive intact. No stemming. */
export function tokenize(text: string): string[] {
  if (typeof text !== "string" || text.length === 0) return [];
  return text.toLowerCase().split(PUNCT_SPLIT_RE).filter(Boolean);
}

/** Tokenized fields for one memory entry. Used both for IDF computation
 *  (which only needs presence-in-any-field) and for BM25 scoring (which
 *  needs per-field token frequency). */
export interface TokenizedEntry {
  topic: string[];
  content: string[];
  tags: string[];
}

/** Smoothed BM25 IDF for each unique query token, computed across the
 *  current candidate corpus. Document frequency = number of entries in
 *  which the token appears in ANY field (presence, not count).
 *
 *  Formula: idf(q) = log((N - df + 0.5) / (df + 0.5) + 1)
 *  Always non-negative thanks to the +1 inside the log. */
export function computeIdf(
  queryTokens: string[],
  corpus: TokenizedEntry[],
): Map<string, number> {
  const result = new Map<string, number>();
  if (queryTokens.length === 0 || corpus.length === 0) return result;
  const unique = new Set(queryTokens);
  const N = corpus.length;
  for (const term of unique) {
    let df = 0;
    for (const entry of corpus) {
      if (entry.topic.includes(term) || entry.content.includes(term) || entry.tags.includes(term)) {
        df++;
      }
    }
    const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
    result.set(term, idf);
  }
  return result;
}

type FieldName = keyof typeof FIELD_WEIGHTS;
const FIELD_NAMES: readonly FieldName[] = ["topic", "tags", "content"] as const;

/** BM25F score for one entry against a tokenized query.
 *
 *  Linear BM25F (per-field BM25, summed with field weights):
 *    score(q) = sum over fields f of:
 *      FIELD_WEIGHTS[f] × idf(q) × (tf × (k1+1)) / (tf + k1 × (1 - b + b × |f|/avg|f|))
 *    score(query) = sum over q in queryTokens of score(q)
 *
 *  Query tokens are deduplicated before scoring (matches the dedup behavior
 *  in computeIdf). A query like ["foo", "foo"] scores identically to ["foo"].
 *
 *  Returns 0 when no token matches anywhere. Caller is responsible for
 *  passing pre-deduped IDF (computeIdf already dedupes).
 *
 *  avgFieldLengths must be > 0 for each field to avoid division by zero.
 *  An empty corpus / empty field is guarded with `max(avgLen, 1)`. */
export function bm25fScore(
  queryTokens: string[],
  entry: TokenizedEntry,
  avgFieldLengths: { topic: number; content: number; tags: number },
  idf: Map<string, number>,
): number {
  if (queryTokens.length === 0) return 0;
  const uniqueTerms = queryTokens.length === 1 ? queryTokens : [...new Set(queryTokens)];
  let total = 0;
  for (const term of uniqueTerms) {
    const termIdf = idf.get(term);
    if (termIdf === undefined) continue;
    for (const field of FIELD_NAMES) {
      const fieldTokens = entry[field];
      const tf = countOccurrences(fieldTokens, term);
      if (tf === 0) continue;
      const fieldLen = fieldTokens.length;
      const avgLen = Math.max(avgFieldLengths[field], 1);
      const norm = 1 - BM25_B + BM25_B * (fieldLen / avgLen);
      const numerator = tf * (BM25_K1 + 1);
      const denominator = tf + BM25_K1 * norm;
      total += FIELD_WEIGHTS[field] * termIdf * (numerator / denominator);
    }
  }
  return total;
}

function countOccurrences(tokens: string[], term: string): number {
  let n = 0;
  for (const t of tokens) if (t === term) n++;
  return n;
}
