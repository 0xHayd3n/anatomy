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
