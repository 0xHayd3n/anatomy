// src/mcp/ast-grep-tools.ts
// In-process MCP tool: ast_grep_search. Loaded when `anatomy mcp` is invoked
// with --with-ast-grep. See docs/superpowers/specs/2026-06-15-anatomy-mcp-with-ast-grep-design.md.

import { glob } from "node:fs/promises";

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

export const astGrepToolHandlers: Record<string, ToolHandler> = {
  ast_grep_search: async (_args: Record<string, unknown>): Promise<ToolResult> => {
    // Filled in by subsequent tasks.
    return {
      content: [{ type: "text", text: JSON.stringify({ error: "not_implemented" }) }],
      isError: true,
    };
  },
};
