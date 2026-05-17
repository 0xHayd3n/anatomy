// src/verify-suggest/registry/cache.ts
// Manages the local git clone of github.com/returntocorp/semgrep-rules under
// ~/.anatomy/semgrep-rules/. First-use clones; --refresh-registry removes it
// before this module runs.

import { existsSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";

export const DEFAULT_CACHE_PATH = join(homedir(), ".anatomy", "semgrep-rules");
export const PIN_FILE = join(homedir(), ".anatomy", "semgrep-rules.pin");
const REPO_URL = "https://github.com/returntocorp/semgrep-rules";

export interface EnsureClonedOptions {
  skipClone?: boolean;         // test-only: pretend the clone succeeded
  forceGitMissing?: boolean;   // test-only: pretend git isn't on PATH
}

/** Returns the cache path if cloned (or already present), or null on failure. */
export async function ensureCloned(
  cachePath: string = DEFAULT_CACHE_PATH,
  opts: EnsureClonedOptions = {},
): Promise<string | null> {
  if (opts.forceGitMissing) return null;
  if (existsSync(cachePath)) return cachePath;
  if (opts.skipClone) {
    await mkdir(cachePath, { recursive: true });
    return cachePath;
  }

  await mkdir(dirname(cachePath), { recursive: true });

  const probe = spawnSync("git", ["--version"], { encoding: "utf8", shell: true });
  if (probe.status !== 0) return null;

  const clone = spawnSync("git", ["clone", "--depth", "1", REPO_URL, cachePath], {
    encoding: "utf8",
    shell: true,
    timeout: 120_000,
  });
  if (clone.status !== 0) return null;

  // Record the SHA so users can see what they're matching against.
  const rev = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: cachePath, encoding: "utf8", shell: true,
  });
  if (rev.status === 0 && rev.stdout) {
    writeFileSync(PIN_FILE, rev.stdout.trim() + "\n");
  }

  return cachePath;
}

/** If refresh is true, removes the cache + pin so next ensureCloned re-clones. */
export async function refreshIfRequested(
  cachePath: string = DEFAULT_CACHE_PATH,
  refresh: boolean,
): Promise<void> {
  if (!refresh) return;
  if (existsSync(cachePath)) {
    rmSync(cachePath, { recursive: true, force: true });
  }
  if (existsSync(PIN_FILE)) {
    rmSync(PIN_FILE, { force: true });
  }
}
