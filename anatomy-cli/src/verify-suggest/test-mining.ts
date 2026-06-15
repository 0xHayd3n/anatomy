// src/verify-suggest/test-mining.ts
// Source 1 of the verifier-suggestion pipeline. Walks test files with
// ast-grep, extracts identifiers that tests assert are thrown, and for each
// anatomy rule scans for ALL_CAPS identifiers that match those throws.

import { glob, readFile } from "node:fs/promises";
import type { VerifyCandidate } from "./types.js";
import { loadAstGrep } from "../ast-grep-loader.js";

const TEST_GLOB = "{tests,test,__tests__,spec,specs}/**/*.{test,spec}.{ts,tsx,js,jsx,mjs,cjs}";
const MAX_FILES = 500;
const IDENT_RE = /[A-Z][A-Z0-9_]{3,}/g;

// ast-grep patterns for throw-assertions. Each `$CLASS` captures the second arg.
const ASSERTION_PATTERNS = [
  // Vitest/Jest
  "expect($EXPR).toThrow($CLASS)",
  "expect($EXPR).toThrowError($CLASS)",
  "expect($EXPR).rejects.toThrow($CLASS)",
  "expect($EXPR).rejects.toThrowError($CLASS)",
  // Node assert
  "assert.throws($EXPR, $CLASS)",
  "assert.rejects($EXPR, $CLASS)",
  // tap
  "t.throws($EXPR, $CLASS)",
  "t.rejects($EXPR, $CLASS)",
];

async function collectTestFiles(repoRoot: string): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of glob(TEST_GLOB, { cwd: repoRoot })) {
    if (files.length >= MAX_FILES) break;
    files.push(entry);
  }
  return files;
}

async function thrownIdentifiersInFile(
  sg: NonNullable<Awaited<ReturnType<typeof loadAstGrep>>>,
  repoRoot: string,
  relPath: string,
): Promise<Set<string>> {
  const out = new Set<string>();
  let source: string;
  try {
    source = await readFile(`${repoRoot}/${relPath}`, "utf8");
  } catch {
    return out;
  }
  type LangParser = { parse: (s: string) => { root(): { findAll: (rule: { rule: { pattern: string } }) => { children(): { kind(): string; text(): string }[]; text(): string }[] } } };
  const sgModule = sg as unknown as Record<string, LangParser | undefined>;
  const langKey = relPath.endsWith(".tsx") ? "tsx"
               : relPath.endsWith(".jsx") ? "jsx"
               : relPath.match(/\.(js|mjs|cjs)$/) ? "js"
               : "ts";
  const lang = sgModule[langKey];
  if (!lang) return out;
  // The eight assertion patterns use $CLASS as the second arg.
  for (const pattern of ASSERTION_PATTERNS) {
    let matches: { children(): { kind(): string; text(): string }[]; text(): string }[];
    try {
      const parsed = lang.parse(source);
      matches = parsed.root().findAll({ rule: { pattern } });
    } catch {
      continue;
    }
    // Heuristic: extract the last comma-split chunk inside the innermost paren.
    // Known limitation: constructor-with-args forms like `.toThrow(new ERR("msg"))`
    // produce a non-matching `inside` (e.g., `"msg"`) and are silently skipped.
    // Acceptable for a heuristic suggester — never a false positive.
    for (const match of matches) {
      // The full match text contains "...(EXPR, CLASS)" or "(EXPR).toThrow(CLASS)".
      // Extract the second top-level argument by walking match.children().
      const text = match.text();
      const lastParen = text.lastIndexOf("(");
      const lastClose = text.lastIndexOf(")");
      if (lastParen === -1 || lastClose === -1 || lastClose <= lastParen) continue;
      const inside = text.slice(lastParen + 1, lastClose).trim();
      // The CLASS may be the whole arg list (for .toThrow(CLASS)) or the
      // second comma-separated arg (for assert.throws(EXPR, CLASS)).
      // Use the last comma-split chunk.
      const parts = inside.split(",").map(s => s.trim());
      const cls = parts[parts.length - 1];
      if (/^[A-Z][A-Z0-9_]{3,}$/.test(cls)) {
        out.add(cls);
      }
    }
  }
  return out;
}

/**
 * Returns the first viable ast_pattern candidate found by scanning test files
 * for throw-assertions whose thrown identifier overlaps with an ALL_CAPS
 * identifier in the rule text. Returns null if no overlap is found.
 *
 * The "first match wins" policy is a heuristic — when multiple rule
 * identifiers have asserted throw-sites, the returned candidate depends on
 * glob walk order, which `node:fs/promises` does not guarantee. This is
 * acceptable for a suggestion mode where the human reviews each candidate.
 */
export async function suggestFromTests(
  repoRoot: string,
  rule: { rule: string; why?: string },
): Promise<VerifyCandidate | null> {
  const sg = await loadAstGrep();
  if (!sg) return null;

  const text = `${rule.rule}\n${rule.why ?? ""}`;
  const ruleIdents = new Set<string>();
  for (const m of text.matchAll(IDENT_RE)) ruleIdents.add(m[0]);
  if (ruleIdents.size === 0) return null;

  const testFiles = await collectTestFiles(repoRoot);
  if (testFiles.length === 0) return null;

  for (const file of testFiles) {
    const thrown = await thrownIdentifiersInFile(sg, repoRoot, file);
    for (const ident of thrown) {
      if (ruleIdents.has(ident)) {
        return {
          kind: "ast_pattern",
          lang: "ts",
          pattern: `throw new ${ident}($$$)`,
          expect_in: "**/*.{ts,js}",
        };
      }
    }
  }
  return null;
}
