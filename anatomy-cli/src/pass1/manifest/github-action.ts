// src/pass1/manifest/github-action.ts
// Detects GitHub Actions repos via action.yml or action.yaml at repo root.
// Stack: "github-action" (a domain-specific stack — the action runs in
// GitHub's runner; the implementation language is incidental). Form:
// "library" — actions are reusable workflow components, similar to
// libraries.
//
// Disambiguation: action.yml MUST have a top-level `runs:` key; without
// it, a file named action.yml could be unrelated. We don't differentiate
// composite vs JS vs Docker actions at the form level — they're all
// reusable units.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { DetectedManifest } from "../../types.js";

const MAX_MANIFEST_BYTES = 64 * 1024;

interface GithubActionParsed {
  content: string;
}

export function detectGithubAction(repoRoot: string): DetectedManifest | null {
  for (const name of ["action.yml", "action.yaml"]) {
    const path = join(repoRoot, name);
    if (!existsSync(path)) continue;
    let content = "";
    try {
      const st = statSync(path);
      if (!st.isFile() || st.size > MAX_MANIFEST_BYTES) return null;
      content = readFileSync(path, "utf8");
      if (!/^runs\s*:/m.test(content)) return null;
    } catch { return null; }
    return { kind: "github-action", path, parsed: { content } satisfies GithubActionParsed };
  }
  return null;
}

export function githubActionFormSuffix(_parsed: unknown): "library" {
  return "library";
}
