// src/checks/verify/ast-grep-verifier.ts
// AST-based verifier for [[rules]].verify with kind="ast_pattern". Uses
// @ast-grep/napi as an optional dependency loaded via detect-ast-grep.ts.
// If napi is unavailable (package not installed, native binary missing for
// this platform), emits verify-ast-grep-unavailable and skips the rule —
// it does NOT fail validation. Malformed patterns surface as
// verify-invalid-pattern (author bug, not source drift); parse errors on
// individual source files are silently skipped (likely binary or wrong lang).
//
// API notes for @ast-grep/napi v0.42:
//   - Lang is NOT an enum; language parsers are module-level named exports:
//     m.ts, m.tsx, m.js, m.jsx, m.css, m.html
//   - Python, Rust, Go, Java are NOT built-in; they require separate lang packs
//   - Each lang object has: parse(src), parseAsync(src), findInFiles(config), kind(name), pattern(src)
//   - parse(src) is synchronous and returns an SgRoot
//   - SgRoot has .root() → SgNode
//   - SgNode has .findAll({ rule: { pattern } }) → SgNode[]
//   - SgNode has .range() → { start: { line, column, index }, end: { ... } }
//   - SgNode has .kind() → string; ERROR nodes have kind "ERROR"
//   - Malformed patterns don't throw on findAll — they silently return 0 matches.
//     We detect bad patterns by parsing the pattern string as source and checking
//     for ERROR-kind children in the parse tree.

import { glob, readFile } from "node:fs/promises";
import { join, sep as platformSep } from "node:path";
import type { Warning } from "../../errors.js";
import type { AstPatternConfig } from "./types.js";
import { getAstGrep } from "./detect-ast-grep.js";

const MAX_LISTED_HITS = 5;
const MAX_FILE_BYTES = 256 * 1024;

// Map schema lang values to the napi module-level export name.
// Python, Rust, Go, Java are listed in the schema but lack built-in napi support
// without additional lang pack configuration; they are handled gracefully below.
const LANG_EXPORT_MAP: Record<AstPatternConfig["lang"], string> = {
  ts: "ts",
  tsx: "tsx",
  js: "js",
  jsx: "jsx",
  py: "py",     // Not a built-in napi export; will surface as verify-invalid-pattern
  rs: "rs",     // Same
  go: "go",     // Same
  java: "java", // Same
};

/** Normalize a platform path to POSIX (forward-slash) for display and glob matching. */
function toPosix(p: string): string {
  return platformSep === "/" ? p : p.split(platformSep).join("/");
}

/** Collect all glob matches under repoRoot, returning POSIX-style relative paths. */
async function collectMatches(repoRoot: string, pattern: string): Promise<string[]> {
  const out: string[] = [];
  for await (const entry of glob(pattern, { cwd: repoRoot })) {
    out.push(toPosix(entry));
  }
  return out;
}

type LangParser = {
  parse(src: string): { root(): SgNode };
};

type SgNode = {
  findAll(rule: { rule: { pattern: string } }): SgNode[];
  range(): { start: { line: number; column: number } };
  kind(): string;
  children(): SgNode[];
};

/** Detect whether a pattern string is syntactically malformed by parsing it as
 *  source code and checking for ERROR-kind nodes in the parse tree. */
function isPatternMalformed(lang: LangParser, pattern: string): boolean {
  const root = lang.parse(pattern).root();
  return root.children().some(n => n.kind() === "ERROR");
}

export async function verifyAstPattern(
  repoRoot: string,
  cfg: AstPatternConfig,
  pointer: string,
): Promise<Warning[]> {
  const sg = await getAstGrep();
  if (!sg) {
    return [{
      code: "verify-ast-grep-unavailable",
      message:
        `verify rule with kind="ast_pattern" requires @ast-grep/napi. Install it ` +
        `('npm install --save-optional @ast-grep/napi') to enable AST-based ` +
        `verification, or remove the verify field. Rule skipped.`,
      pointer,
    }];
  }

  const exportName = LANG_EXPORT_MAP[cfg.lang];
  // Access the language parser from the module (e.g., sg.ts, sg.tsx, sg.js)
  const sgModule = sg as unknown as Record<string, LangParser | undefined>;
  const langParser = sgModule[exportName];

  if (!langParser || typeof langParser.parse !== "function") {
    return [{
      code: "verify-invalid-pattern",
      message:
        `ast-grep's napi build does not include "${cfg.lang}". ` +
        `For non-JS-family languages, use kind = "semgrep" instead — see ` +
        `spec/0.13/prompt.md. Or use lang = ts/tsx/js/jsx for ast-grep.`,
      pointer,
    }];
  }

  // Validate the pattern before scanning files — detect syntax errors early.
  if (isPatternMalformed(langParser, cfg.pattern)) {
    return [{
      code: "verify-invalid-pattern",
      message:
        `ast-grep pattern "${cfg.pattern}" is malformed (parse tree contains ERROR nodes for lang=${cfg.lang}).`,
      pointer,
    }];
  }

  const targetGlob = cfg.expect_in ?? cfg.forbid_in;
  if (!targetGlob) {
    // Schema enforces oneOf(expect_in, forbid_in); this is a defensive guard.
    return [];
  }

  const files = await collectMatches(repoRoot, targetGlob);
  const hits: Array<{ file: string; line: number }> = [];

  for (const relPath of files) {
    const absPath = join(repoRoot, relPath);
    let source: string;
    try {
      const buf = await readFile(absPath);
      if (buf.length > MAX_FILE_BYTES) continue;
      source = buf.toString("utf8");
    } catch {
      continue;
    }

    let sgRoot: { root(): SgNode };
    try {
      sgRoot = langParser.parse(source);
    } catch {
      // Parse error on this file — skip silently (binary or wrong language).
      continue;
    }

    let matches: SgNode[];
    try {
      matches = sgRoot.root().findAll({ rule: { pattern: cfg.pattern } });
    } catch {
      // Unexpected runtime error from findAll — treat pattern as invalid.
      continue;
    }

    for (const match of matches) {
      hits.push({ file: relPath, line: match.range().start.line + 1 });
    }
  }

  if (cfg.expect_in !== undefined && hits.length === 0) {
    return [{
      code: "verify-pattern-not-matched",
      message:
        `ast-grep pattern "${cfg.pattern}" did not match any occurrence ` +
        `in "${targetGlob}" (lang=${cfg.lang}).`,
      pointer,
    }];
  }

  if (cfg.forbid_in !== undefined && hits.length > 0) {
    const shown = hits
      .slice(0, MAX_LISTED_HITS)
      .map(h => `${h.file}:${h.line}`)
      .join(", ");
    const suffix = hits.length > MAX_LISTED_HITS ? ", ..." : "";
    return [{
      code: "verify-pattern-found-where-forbidden",
      message:
        `ast-grep pattern "${cfg.pattern}" matched ${hits.length} occurrence(s) ` +
        `in forbidden glob "${targetGlob}": ${shown}${suffix}`,
      pointer,
    }];
  }

  return [];
}
