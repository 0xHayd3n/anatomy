// src/mcp/memory-reverify-tool.ts
// MCP tool handler for anatomy_memory_reverify. Validates input, finds the
// target entry via loadMemory, then calls reverifyEntry to compute per-ref
// status. Returns the standard success envelope or one of: invalid_id,
// entry_not_found, memory_not_found_for_anatomy, anatomy_not_found.

import type { SuccessEnvelope, ErrorEnvelope } from "./envelope.js";
import { reverifyEntry, type ReverifyResult } from "../memory/reverify.js";
import type { MemoryEntry } from "../memory/io.js";
import type { StalenessInfo } from "./envelope.js";

const ID_RE = /^[a-z0-9]{8}$/;

export type ReverifyArgs = { id?: unknown; path?: unknown };

type LoadedMemory = {
  entries: MemoryEntry[];
  anatomy_path: string;
  anatomy_dir: string;
  repo_root: string;
  staleness: StalenessInfo | null;
  repo_fingerprint: string;
};

export function makeReverifyHandler(
  loadMemory: (args: ReverifyArgs) => Promise<LoadedMemory | ErrorEnvelope>,
): (args: ReverifyArgs) => Promise<SuccessEnvelope<ReverifyResult> | ErrorEnvelope> {
  return async (args) => {
    if (typeof args.id !== "string" || !ID_RE.test(args.id)) {
      return { error: "invalid_id", id: String(args.id ?? "") };
    }
    const loaded = await loadMemory(args);
    if ("error" in loaded) return loaded;
    const entry = loaded.entries.find(e => e.id === args.id);
    if (!entry) return { error: "entry_not_found", id: args.id };
    const data = reverifyEntry(loaded.repo_root, entry);
    return {
      anatomy_path: loaded.anatomy_path,
      staleness: loaded.staleness,
      repo_fingerprint: loaded.repo_fingerprint,
      data,
    };
  };
}
