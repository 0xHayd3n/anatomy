// src/verify-suggest/registry/index.ts
// Composes cache → parse → embed → match into one `suggestFromRegistry` entry.

import { join } from "node:path";
import { homedir } from "node:os";
import type { VerifyCandidate } from "../types.js";
import { ensureCloned, refreshIfRequested, DEFAULT_CACHE_PATH } from "./cache.js";
import { parseRegistry, type RegistryRecord } from "./parse.js";
import { buildOrLoadEmbeddings, embedQuery } from "./embed.js";
import { topMatch } from "./match.js";

const EMBEDDINGS_PATH = join(homedir(), ".anatomy", "registry-embeddings.json");
const THRESHOLD = 0.70;

interface RegistryState {
  records: RegistryRecord[];
  embeddings: Map<string, number[]>;
}

let state: RegistryState | null = null;
let hasRefreshed = false;

/** Test-only: clear the in-process registry cache. */
export function _resetRegistryState(): void {
  state = null;
  hasRefreshed = false;
}

async function ensureLoaded(refresh: boolean): Promise<RegistryState | null> {
  if (state && !refresh) return state;
  if (refresh && !hasRefreshed) {
    await refreshIfRequested(DEFAULT_CACHE_PATH, true);
    state = null;
    hasRefreshed = true;
  }
  const cachePath = await ensureCloned();
  if (!cachePath) return null;
  const records = await parseRegistry(cachePath);
  if (records.length === 0) return null;
  const embeddings = await buildOrLoadEmbeddings(records, EMBEDDINGS_PATH);
  if (embeddings.size === 0) return null;
  state = { records, embeddings };
  return state;
}

export async function suggestFromRegistry(
  _repoRoot: string,
  rule: { rule: string; why?: string },
  opts: { refresh?: boolean } = {},
): Promise<VerifyCandidate | null> {
  const loaded = await ensureLoaded(opts.refresh ?? false);
  if (!loaded) return null;

  const query = await embedQuery(`${rule.rule}\n${rule.why ?? ""}`);
  if (!query) return null;

  const top = topMatch(query, loaded.embeddings, THRESHOLD);
  if (!top) return null;

  const record = loaded.records.find(r => r.id === top.id);
  if (!record) return null;

  return {
    kind: "semgrep",
    rule_file: record.path,
  };
}
