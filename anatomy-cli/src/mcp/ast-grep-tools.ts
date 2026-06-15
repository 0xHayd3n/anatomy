// src/mcp/ast-grep-tools.ts
// In-process MCP tool: ast_grep_search. Loaded when `anatomy mcp` is invoked
// with --with-ast-grep. See docs/superpowers/specs/2026-06-15-anatomy-mcp-with-ast-grep-design.md.

import { glob, readFile } from "node:fs/promises";
import { loadAstGrep, type AstGrepModule } from "../ast-grep-loader.js";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: unknown;
}

export interface ToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

// Canonical language ↔ extension table. Single source of truth for both
// inferLang (extension → lang) and defaultExtensionsFor (lang → extensions).
// Languages not listed here cannot be inferred; the agent must pass `lang`
// explicitly and provide a `file_path` glob (since we can't build a default
// walk for an unknown lang).
const LANG_TABLE: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["ts", [".ts"]],
  ["tsx", [".tsx"]],
  ["js", [".js", ".mjs", ".cjs"]],
  ["jsx", [".jsx"]],
  ["py", [".py"]],
  ["rs", [".rs"]],
  ["go", [".go"]],
  ["java", [".java"]],
  ["c", [".c", ".h"]],
  ["cpp", [".cpp", ".cc", ".cxx", ".hpp", ".hh"]],
  ["rb", [".rb"]],
  ["php", [".php"]],
  ["swift", [".swift"]],
  ["kotlin", [".kt", ".kts"]],
  ["scala", [".scala"]],
  ["lua", [".lua"]],
  ["html", [".html", ".htm"]],
  ["css", [".css"]],
  ["yaml", [".yml", ".yaml"]],
  ["json", [".json"]],
  ["bash", [".sh", ".bash"]],
];

const EXT_TO_LANG: ReadonlyMap<string, string> = new Map(
  LANG_TABLE.flatMap(([lang, exts]) => exts.map((ext) => [ext, lang] as [string, string])),
);

const LANG_TO_EXTS: ReadonlyMap<string, readonly string[]> = new Map(LANG_TABLE);

function inferLang(filePath: string | undefined): string | null {
  if (!filePath) return null;
  // Handle the `{ts,tsx}` brace form by taking the first comma-split.
  const matchBrace = filePath.match(/\.\{([^}]+)\}$/);
  if (matchBrace) {
    const firstExt = matchBrace[1].split(",")[0]?.trim();
    if (firstExt) return EXT_TO_LANG.get("." + firstExt) ?? null;
  }
  const dot = filePath.lastIndexOf(".");
  if (dot === -1) return null;
  const ext = filePath.slice(dot).toLowerCase();
  return EXT_TO_LANG.get(ext) ?? null;
}

function defaultExtensionsFor(lang: string): readonly string[] | null {
  return LANG_TO_EXTS.get(lang) ?? null;
}

const DEFAULT_EXCLUDES: readonly string[] = [
  "node_modules",
  "dist",
  "build",
  "out",
  "target",
  ".git",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".cache",
  "coverage",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
  "env",
  ".tox",
  ".pytest_cache",
];

const PATH_SEP_RE = /[\\/]/;

/** Returns true if any path segment is in DEFAULT_EXCLUDES. */
function isExcluded(relPath: string): boolean {
  for (const segment of relPath.split(PATH_SEP_RE)) {
    if (DEFAULT_EXCLUDES.includes(segment)) return true;
  }
  return false;
}

interface WalkOptions {
  cwd: string;
  lang: string;
  globPattern?: string;
  maxFiles: number;
}

/** Yields repo-relative file paths matching the glob (or the lang's default
 *  extensions if no glob is given), skipping any path under DEFAULT_EXCLUDES.
 *  Stops after `maxFiles`. Files are yielded in the order Node's fs.glob
 *  produces them — no extra sorting. */
async function* walkFiles(opts: WalkOptions): AsyncIterable<string> {
  let pattern = opts.globPattern;
  if (!pattern) {
    const exts = defaultExtensionsFor(opts.lang);
    if (!exts || exts.length === 0) return; // unknown lang → empty walk
    // Build a brace expansion of extensions: **/*.{ts,tsx} etc.
    const stripped = exts.map((e) => e.startsWith(".") ? e.slice(1) : e);
    pattern = `**/*.${stripped.length === 1 ? stripped[0] : "{" + stripped.join(",") + "}"}`;
  }
  let count = 0;
  for await (const entry of glob(pattern, { cwd: opts.cwd })) {
    const rel = entry as string;
    if (isExcluded(rel)) continue;
    yield rel;
    count++;
    if (count >= opts.maxFiles) return;
  }
}

/** Exposed for testing only. Do NOT import from outside this package. */
export const _internal = { inferLang, defaultExtensionsFor, LANG_TABLE, walkFiles };

export const astGrepToolDefinitions: ToolDefinition[] = [
  {
    name: "ast_grep_search",
    description:
      "Structural code search via ast-grep. Find by AST shape, not text. " +
      "Pattern syntax: https://ast-grep.github.io/guide/pattern-syntax.html. " +
      "Pass `pattern` plus EITHER `lang` (explicit) OR `file_path` (glob — lang inferred from extension).",
    inputSchema: {
      type: "object",
      required: ["pattern"],
      properties: {
        pattern: {
          type: "string",
          description:
            "ast-grep pattern (e.g. `spawnSync($X, $$$)`). Metavariables `$X` capture single nodes; `$$$` captures rests.",
        },
        lang: {
          type: "string",
          description:
            "Language id (ts, tsx, js, jsx, py, rs, go, java, c, cpp, rb, php, swift, kotlin, scala, lua, html, css, yaml, json, bash). Optional if file_path is provided.",
        },
        file_path: {
          type: "string",
          description:
            "Glob to scope the search (e.g. `src/**/*.ts`). When provided, `lang` is inferred from the extension. Without it the walk uses the language's default extensions under cwd.",
        },
        max_results: {
          type: "number",
          description: "Cap on returned matches. Default 50. Hard ceiling 500.",
        },
      },
    },
  },
];

const MAX_RESULTS_DEFAULT = 50;
const MAX_RESULTS_CEILING = 500;
const MAX_TEXT_LEN = 500;

interface SearchInput {
  pattern: string;
  lang?: string;
  file_path?: string;
  max_results?: number;
}

interface Match {
  file: string;
  line: number;
  column: number;
  text: string;
  captures: Record<string, string>;
}

interface SearchResult {
  matches: Match[];
  files_scanned: number;
  truncated: boolean;
  language: string;
}

function errorEnvelope(error: string, extra: Record<string, unknown> = {}): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ error, ...extra }) }],
    isError: true,
  };
}

function okEnvelope(data: SearchResult): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
    isError: false,
  };
}

function truncateText(s: string): string {
  return s.length > MAX_TEXT_LEN ? s.slice(0, MAX_TEXT_LEN) + "…" : s;
}

/** Pull the language-keyed parser off the napi module. The shape is
 *  loose because napi exposes one property per language (e.g., sg.ts,
 *  sg.python). Returns null when the language isn't supported by this
 *  napi build. */
function getLangParser(sg: AstGrepModule, lang: string): { parse: (s: string) => { root(): { findAll: (rule: { rule: { pattern: string } }) => unknown[] } } } | null {
  const sgModule = sg as unknown as Record<string, unknown>;
  // ast-grep uses "python" as the property name even though the lang id is "py".
  const propName = lang === "py" ? "python" : lang;
  const parser = sgModule[propName];
  if (!parser || typeof parser !== "object") return null;
  const obj = parser as { parse?: unknown };
  if (typeof obj.parse !== "function") return null;
  return parser as ReturnType<typeof getLangParser>;
}

async function runSearch(input: SearchInput): Promise<ToolResult> {
  if (typeof input.pattern !== "string" || input.pattern.length === 0) {
    return errorEnvelope("missing_pattern");
  }
  let lang = input.lang;
  if (!lang) {
    lang = inferLang(input.file_path) ?? undefined;
    if (!lang) {
      return errorEnvelope("missing_lang_or_file_path", {
        hint: "Pass `lang` explicitly (ts/py/rs/...) or a `file_path` glob whose extension is known.",
        supported_langs: LANG_TABLE.map(([l]) => l),
      });
    }
  }

  const sg = await loadAstGrep();
  if (!sg) {
    return errorEnvelope("ast_grep_unavailable", {
      hint: "Reinstall with `npm install --save-optional @ast-grep/napi` or omit --with-ast-grep.",
    });
  }

  const parser = getLangParser(sg, lang);
  if (!parser) {
    return errorEnvelope("unsupported_lang", { lang });
  }

  const maxResults = Math.min(
    Math.max(1, Math.floor(input.max_results ?? MAX_RESULTS_DEFAULT)),
    MAX_RESULTS_CEILING,
  );
  const maxFiles = Number(process.env.ANATOMY_AST_GREP_MAX_FILES ?? "5000") || 5000;

  const matches: Match[] = [];
  let files_scanned = 0;
  let truncated = false;

  for await (const rel of walkFiles({
    cwd: process.cwd(),
    lang,
    globPattern: input.file_path,
    maxFiles,
  })) {
    let source: string;
    try {
      source = await readFile(`${process.cwd()}/${rel}`, "utf8");
    } catch {
      continue; // unreadable file → skip silently, do NOT count in files_scanned
    }
    files_scanned++;
    let found: Array<{ text(): string; range(): { start: { line: number; column: number } }; getMatch(name: string): { text(): string } | null }>;
    try {
      const parsed = parser.parse(source);
      found = parsed.root().findAll({ rule: { pattern: input.pattern } }) as typeof found;
    } catch (e) {
      return errorEnvelope("pattern_parse_failed", {
        language: lang,
        detail: e instanceof Error ? e.message : String(e),
      });
    }
    for (const node of found) {
      const range = node.range();
      const captureNames = (input.pattern.match(/\$[A-Z][A-Z0-9_]*/g) ?? []).map((s) => s.slice(1));
      const captures: Record<string, string> = {};
      for (const name of captureNames) {
        const cap = node.getMatch(name);
        if (cap) captures[name] = truncateText(cap.text());
      }
      matches.push({
        file: rel,
        line: range.start.line + 1,
        column: range.start.column + 1,
        text: truncateText(node.text()),
        captures,
      });
      if (matches.length >= maxResults) {
        truncated = true;
        break;
      }
    }
    if (truncated) break;
  }

  return okEnvelope({ matches, files_scanned, truncated, language: lang });
}

export const astGrepToolHandlers: Record<string, ToolHandler> = {
  ast_grep_search: (args) => runSearch(args as unknown as SearchInput),
};
