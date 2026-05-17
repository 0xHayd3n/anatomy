// src/discovery.ts
// Pure filesystem discovery helpers per spec/0.3/cascading.md §3.
// No .anatomy content inspection.

import { existsSync, statSync, readdirSync } from "node:fs";
import { resolve, join, dirname, sep, relative } from "node:path";

export interface DiscoverOptions {
  /** Default 10. Per-subtree depth cap below repoRoot (repoRoot itself is depth 0). */
  maxDepth?: number;
  /** Default ['.git', 'node_modules']. Replaces, does not merge. The dot-prefix
   *  rule is applied IN ADDITION to skipDirs (always). */
  skipDirs?: string[];
}

const DEFAULT_SKIP = [".git", "node_modules", "target", "dist", "build", "__pycache__", ".next", ".turbo"];
const DEFAULT_MAX_DEPTH = 10;

function isUnderOrEqual(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !rel.includes(`..${sep}`));
}

export function findAnatomyForPath(repoRoot: string, queryPath: string): string | null {
  if (!existsSync(repoRoot) || !statSync(repoRoot).isDirectory()) {
    throw new TypeError(`repoRoot does not exist or is not a directory: ${repoRoot}`);
  }
  const absRoot = resolve(repoRoot);
  const absQuery = resolve(absRoot, queryPath);
  if (!isUnderOrEqual(absRoot, absQuery)) {
    throw new RangeError(`queryPath is not under repoRoot: ${queryPath}`);
  }

  // If absQuery is an existing dir OR equals absRoot, start there.
  // Otherwise (file path or non-existent), start at its dirname.
  let dir: string;
  if (absQuery === absRoot) {
    dir = absRoot;
  } else if (existsSync(absQuery) && statSync(absQuery).isDirectory()) {
    dir = absQuery;
  } else {
    dir = dirname(absQuery);
  }

  while (true) {
    const candidate = join(dir, ".anatomy");
    if (existsSync(candidate)) return candidate;
    if (dir === absRoot) return null;
    dir = dirname(dir);
  }
}

export function discoverAllAnatomies(
  repoRoot: string,
  options?: DiscoverOptions,
): Array<{ dirPath: string; absPath: string }> {
  if (!existsSync(repoRoot) || !statSync(repoRoot).isDirectory()) {
    throw new TypeError(`repoRoot does not exist or is not a directory: ${repoRoot}`);
  }
  const absRoot = resolve(repoRoot);
  const maxDepth = options?.maxDepth ?? DEFAULT_MAX_DEPTH;
  const skipDirs = options?.skipDirs ?? DEFAULT_SKIP;

  const out: Array<{ dirPath: string; absPath: string }> = [];

  function walk(dir: string, depth: number): void {
    // Process THIS directory (emit if has .anatomy).
    const candidate = join(dir, ".anatomy");
    if (existsSync(candidate)) {
      out.push({ dirPath: dir, absPath: candidate });
    }
    // Stop descending if at depth cap.
    if (depth >= maxDepth) return;

    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable directory: skip silently
    }
    for (const ent of entries) {
      if (!ent.isDirectory() || ent.isSymbolicLink()) continue;
      const name = ent.name;
      if (name.startsWith(".")) continue;          // dot-prefix skip
      if (skipDirs.includes(name)) continue;       // closed-list skip
      walk(join(dir, name), depth + 1);
    }
  }

  walk(absRoot, 0);

  // Sort by dirPath lexicographically for deterministic output.
  out.sort((a, b) => a.dirPath.localeCompare(b.dirPath));
  return out;
}
