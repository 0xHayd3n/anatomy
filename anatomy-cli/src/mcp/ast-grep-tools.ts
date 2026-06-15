// src/mcp/ast-grep-tools.ts
// In-process MCP tool: ast_grep_search. Loaded when `anatomy mcp` is invoked
// with --with-ast-grep. See docs/superpowers/specs/2026-06-15-anatomy-mcp-with-ast-grep-design.md.

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

/** Exposed for testing only. Do NOT import from outside this package. */
export const _internal = { inferLang, defaultExtensionsFor, LANG_TABLE };

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
