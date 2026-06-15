// src/mcp/git-history-tools.ts
// In-process MCP tool set: git_blame, git_log_search, git_show. Loaded when
// `anatomy mcp` is invoked with --with-git-history. See
// docs/superpowers/specs/2026-06-15-anatomy-mcp-with-git-history-design.md.

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

export const gitHistoryToolDefinitions: ToolDefinition[] = [
  {
    name: "git_blame",
    description:
      "Show who last touched each line of a file. Returns one record per line in the requested range. " +
      "Pass `lines: \"10-25\"` to scope; default returns the whole file (up to ANATOMY_GIT_MAX_BLAME_LINES, default 500). " +
      "Set `follow: true` to track moves/renames across the file's history.",
    inputSchema: {
      type: "object",
      required: ["file_path"],
      properties: {
        file_path: {
          type: "string",
          description: "Repo-relative path to the file to blame.",
        },
        lines: {
          type: "string",
          description: "Line range like \"10-25\" or single line \"42\". Optional.",
        },
        follow: {
          type: "boolean",
          description: "Follow file moves/renames across history. Default false.",
        },
      },
    },
  },
  {
    name: "git_log_search",
    description:
      "Find commits by content change (pickaxe), commit message (regex), or path filter. " +
      "Returns commit metadata + filenames touched, capped at ANATOMY_GIT_MAX_LOG_COMMITS (default 100).",
    inputSchema: {
      type: "object",
      required: ["kind"],
      properties: {
        kind: {
          type: "string",
          enum: ["pickaxe", "message", "path"],
          description:
            "Search axis: pickaxe = `git log -S <query>` (commits where the string appears or disappears); " +
            "message = `git log --grep=<query>` (commit message regex); " +
            "path = `git log -- <query>` (commits touching the path/glob).",
        },
        query: {
          type: "string",
          description: "Search string. Required for pickaxe and message; optional for path (then returns all commits in the time window).",
        },
        limit: {
          type: "number",
          description: "Max commits returned. Default 30. Hard ceiling = ANATOMY_GIT_MAX_LOG_COMMITS.",
        },
        since: {
          type: "string",
          description: "ISO date or git-relative (e.g. \"2 weeks ago\").",
        },
        until: {
          type: "string",
          description: "ISO date or git-relative.",
        },
        author: {
          type: "string",
          description: "Filter by author substring (matched against name or email).",
        },
      },
    },
  },
  {
    name: "git_show",
    description:
      "Metadata for one commit. By default returns commit, parents, author, date, full message, and file list with status + numstat. " +
      "Set with_diff: true to include the patch body (truncated at ANATOMY_GIT_MAX_DIFF_BYTES, default 4096).",
    inputSchema: {
      type: "object",
      required: ["commit"],
      properties: {
        commit: {
          type: "string",
          description: "Commit SHA or alias (HEAD, HEAD~3, branch name). Output canonicalizes to full 40-char SHA.",
        },
        with_diff: {
          type: "boolean",
          description: "Include the patch body. Default false.",
        },
      },
    },
  },
];

export const gitHistoryToolHandlers: Record<string, ToolHandler> = {
  git_blame: async (_args) => placeholder("git_blame"),
  git_log_search: async (_args) => placeholder("git_log_search"),
  git_show: async (_args) => placeholder("git_show"),
};

async function placeholder(name: string): Promise<ToolResult> {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: "not_implemented", tool: name }) }],
    isError: true,
  };
}
