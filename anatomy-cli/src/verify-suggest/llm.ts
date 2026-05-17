// src/verify-suggest/llm.ts
// Source 3: LLM fallback. Reuses Pass 2's claude-cli provider by default, but
// any registered provider works. Custom prompt asks for a TOML inline-table.
// One-shot — no retry on malformed output.
//
// Provider interface deviation from the plan: Pass2Provider exposes
// `generate({ systemPrompt, userPrompt }): Promise<string>` (not
// `call({ prompt })` returning `{ text }`). The loader entry-point is
// `getProvider(name)` in `../pass2/providers/index.js` (not `loader.js`)
// and is async, returning `Pass2Provider | undefined`.

import { parse as parseToml } from "smol-toml";
import { readFile } from "node:fs/promises";
import { buildLLMPrompt, LLM_SYSTEM } from "./llm-prompt.js";
import type { VerifyCandidate } from "./types.js";

type ProviderFn = ((prompt: string) => Promise<string>) | null;

let providerOverride: ProviderFn | undefined;
let _providerPromise: Promise<ProviderFn> | null = null;

/** Test-only: inject a mock provider or null to simulate "no provider available". */
export function _setProviderForTesting(p: ProviderFn | undefined): void {
  providerOverride = p;
  _providerPromise = null;
}

async function loadDefaultProvider(): Promise<ProviderFn> {
  try {
    const { getProvider } = await import("../pass2/providers/index.js");
    const provider = await getProvider("claude-cli");
    if (!provider) return null;
    if (!(await provider.available())) return null;
    return async (prompt: string) => {
      // The full prompt already includes the system role text via
      // buildLLMPrompt(). Pass it as the user prompt and reuse LLM_SYSTEM
      // as the system prompt so the provider's role-separation is honored.
      const text = await provider.generate({
        systemPrompt: LLM_SYSTEM,
        userPrompt: prompt,
      });
      return text ?? "";
    };
  } catch {
    return null;
  }
}

const SAMPLE_BUDGET = 4 * 1024;
const PATH_TOKEN_RE = /[a-z_-]+\/[a-z._-]+|\b[a-z][a-z_-]+\.[a-z]+\b/gi;

async function buildSample(
  repoRoot: string,
  rule: { rule: string; why?: string },
  structure: { entries: { path: string }[] } | undefined,
): Promise<string> {
  const text = `${rule.rule} ${rule.why ?? ""}`;
  const tokens = new Set<string>();
  for (const m of text.matchAll(PATH_TOKEN_RE)) tokens.add(m[0]);

  const includes: string[] = [];
  let remaining = SAMPLE_BUDGET;

  // Try to include each path token as a file from the repo.
  for (const tok of tokens) {
    if (remaining <= 0) break;
    try {
      const content = await readFile(`${repoRoot}/${tok}`, "utf8");
      const snippet = content.slice(0, Math.min(remaining, 1024));
      includes.push(`--- ${tok} ---\n${snippet}\n`);
      remaining -= snippet.length;
    } catch {
      // Not a real file; skip.
    }
  }

  // If no path tokens matched, sample a representative file from each
  // structure entry — try common entry-point filenames (index.*, main.*,
  // mod.*, lib.*) before falling back to a directory label.
  if (includes.length === 0 && structure) {
    const CANDIDATE_FILES = [
      "index.ts", "index.tsx", "index.js", "index.jsx",
      "main.ts", "main.js", "main.py", "main.go", "main.rs",
      "mod.rs", "lib.rs", "lib.ts", "lib.js",
      "__init__.py", "init.go",
    ];
    for (const entry of structure.entries) {
      if (remaining <= 0) break;
      let added = false;
      for (const fname of CANDIDATE_FILES) {
        try {
          const content = await readFile(`${repoRoot}/${entry.path}/${fname}`, "utf8");
          const snippet = content.slice(0, Math.min(remaining, 500));
          includes.push(`--- ${entry.path}/${fname} ---\n${snippet}\n`);
          remaining -= snippet.length;
          added = true;
          break;
        } catch {
          // Not present; try next candidate.
        }
      }
      if (!added) {
        const snippet = `[directory: ${entry.path}]\n`;
        includes.push(snippet);
        remaining -= snippet.length;
      }
    }
  }

  return includes.join("\n") || "(no relevant source files identified)";
}

export function parseLLMOutput(raw: string): VerifyCandidate | null {
  const trimmed = raw.trim();
  if (trimmed === "NO_VERIFIER_FEASIBLE") return null;
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  let parsed: unknown;
  try {
    // smol-toml expects key = value at top level; wrap in a temp key.
    parsed = parseToml(`v = ${trimmed}`);
  } catch {
    return null;
  }
  const v = (parsed as { v?: unknown }).v;
  if (!v || typeof v !== "object") return null;
  const obj = v as Record<string, unknown>;
  if (typeof obj.kind !== "string") return null;
  if (obj.kind === "glob_exists" && typeof obj.path === "string") {
    const out: VerifyCandidate = { kind: "glob_exists", path: obj.path };
    if (obj.should_not === true) out.should_not = true;
    return out;
  }
  if (obj.kind === "ast_pattern" && typeof obj.lang === "string" && typeof obj.pattern === "string") {
    const out: VerifyCandidate = {
      kind: "ast_pattern", lang: obj.lang, pattern: obj.pattern,
    };
    if (typeof obj.expect_in === "string") out.expect_in = obj.expect_in;
    if (typeof obj.forbid_in === "string") out.forbid_in = obj.forbid_in;
    if (!out.expect_in && !out.forbid_in) return null;
    return out;
  }
  if (obj.kind === "semgrep" && typeof obj.lang === "string" && typeof obj.pattern === "string") {
    const out: VerifyCandidate = {
      kind: "semgrep", lang: obj.lang, pattern: obj.pattern,
    };
    if (typeof obj.expect_in === "string") out.expect_in = obj.expect_in;
    if (typeof obj.forbid_in === "string") out.forbid_in = obj.forbid_in;
    if (!out.expect_in && !out.forbid_in) return null;
    return out;
  }
  return null;
}

export async function suggestFromLLM(
  repoRoot: string,
  rule: { rule: string; why?: string },
  structure: { entries: { path: string }[] } | undefined,
): Promise<VerifyCandidate | null> {
  let provider: ProviderFn;
  if (providerOverride !== undefined) {
    provider = providerOverride;
  } else {
    if (!_providerPromise) _providerPromise = loadDefaultProvider();
    provider = await _providerPromise;
  }
  if (!provider) return null;

  const sample = await buildSample(repoRoot, rule, structure);
  const prompt = buildLLMPrompt({ rule: rule.rule, why: rule.why, sample });

  let response: string;
  try {
    response = await provider(prompt);
  } catch {
    return null;
  }
  return parseLLMOutput(response);
}
