// src/verify-suggest/registry/parse.ts
// Walks a local semgrep-rules clone and extracts rule metadata. Uses a tiny
// hand-rolled yaml-of-rules reader; we only need the top-level `rules:` list
// with each rule's `id`, `message`, `languages`, and optional `metadata.category`.
// Full YAML parsing is intentionally avoided — the semgrep-rules format is
// regular enough that a line-based parser handles it deterministically.

import { glob, readFile } from "node:fs/promises";

export interface RegistryRecord {
  id: string;
  message: string;
  category: string;
  languages: string[];
  path: string;            // absolute path to the yaml file
}

const RULE_GLOB = "**/*.{yaml,yml}";
const EXCLUDE_DIRS = /(^|\/)(\.github|stats|node_modules)\//;

function dequote(s: string): string {
  s = s.trim();
  if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
  if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1);
  return s;
}

function parseLanguages(line: string): string[] {
  // Matches: [py, js] or [python]
  const m = line.match(/\[([^\]]*)\]/);
  if (!m) return [];
  return m[1].split(",").map(s => dequote(s.trim())).filter(Boolean);
}

/** Parses the rule entries in one yaml file. Returns [] if file isn't a rule file. */
function parseRuleFile(yamlText: string, path: string): RegistryRecord[] {
  const lines = yamlText.split(/\r?\n/);
  let inRules = false;
  const out: RegistryRecord[] = [];
  let cur: Partial<RegistryRecord> | null = null;
  let inMetadata = false;
  let inLanguagesList = false;

  for (const raw of lines) {
    if (!inRules) {
      if (/^rules:\s*$/.test(raw)) inRules = true;
      continue;
    }
    const indent = raw.match(/^( *)/)![1].length;
    const trimmed = raw.trim();

    // A new rule starts with "- id:" at indent 2.
    if (indent === 2 && /^- id:\s*/.test(trimmed)) {
      if (cur && cur.id) out.push({
        id: cur.id, message: cur.message ?? "",
        category: cur.category ?? "", languages: cur.languages ?? [],
        path,
      });
      cur = { id: dequote(trimmed.replace(/^- id:\s*/, "")) };
      inMetadata = false;
      inLanguagesList = false;
      continue;
    }
    if (!cur) continue;

    // Collect block-list languages items: indent 6, "- value".
    if (inLanguagesList && indent === 6 && /^- (.+)$/.test(trimmed)) {
      const item = dequote(trimmed.replace(/^- /, ""));
      if (!cur.languages) cur.languages = [];
      cur.languages.push(item);
      continue;
    }
    // Any non-list-item line at indent <= 4 ends languages-block mode.
    if (inLanguagesList && indent <= 4) {
      inLanguagesList = false;
    }

    if (indent === 4) {
      inMetadata = /^metadata:\s*$/.test(trimmed);
      // Detect block-list form: `languages:` with no value after the colon.
      inLanguagesList = /^languages:\s*$/.test(trimmed);
      if (/^id:\s*/.test(trimmed)) cur.id = dequote(trimmed.replace(/^id:\s*/, ""));
      else if (/^message:\s*/.test(trimmed)) {
        const value = dequote(trimmed.replace(/^message:\s*/, ""));
        // Block-scalar indicators (`|`, `>`) require real YAML semantics to
        // collect continuation lines. Suppress to empty rather than capture
        // the literal indicator character.
        cur.message = (value === "|" || value === ">") ? "" : value;
      }
      else if (/^languages:\s*/.test(trimmed)) cur.languages = parseLanguages(trimmed);
    }
    if (inMetadata && indent === 6 && /^category:\s*/.test(trimmed)) {
      cur.category = dequote(trimmed.replace(/^category:\s*/, ""));
    }
  }

  if (cur && cur.id) out.push({
    id: cur.id, message: cur.message ?? "",
    category: cur.category ?? "", languages: cur.languages ?? [],
    path,
  });
  return out;
}

export async function parseRegistry(cachePath: string): Promise<RegistryRecord[]> {
  const all: RegistryRecord[] = [];
  for await (const entry of glob(RULE_GLOB, { cwd: cachePath })) {
    const normalized = entry.split(/[\\/]/).join("/");
    if (EXCLUDE_DIRS.test("/" + normalized)) continue;
    const abs = `${cachePath}/${entry}`;
    let text: string;
    try { text = await readFile(abs, "utf8"); } catch { continue; }
    if (!/^rules:\s*$/m.test(text)) continue;
    all.push(...parseRuleFile(text, abs));
  }
  return all;
}
