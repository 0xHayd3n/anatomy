// src/commands/mcp.ts
// `anatomy mcp` — boots an MCP stdio server registering all anatomy tools.
// Lazy-imports @modelcontextprotocol/sdk so the rest of the CLI stays SDK-free.

/** Truthy values that disable the MCP server entirely. Mirrors the
 *  ANATOMY_HOOK_DISABLE convention from hook.ts: any non-"0"/"false"/empty
 *  string disables. Used by the hook-vs-MCP eval baseline condition (per
 *  docs/superpowers/specs/2026-05-09-hook-vs-mcp-decomposition-design.md)
 *  to simulate "no MCP available" without uninstalling the plugin. */
function isMcpDisabledByEnv(): boolean {
  const raw = process.env.ANATOMY_MCP_DISABLE;
  if (!raw) return false;
  if (raw === "0") return false;
  if (raw.toLowerCase() === "false") return false;
  return true;
}

export async function mcpCommand(): Promise<number> {
  if (isMcpDisabledByEnv()) {
    // Eval-mode opt-out: exit cleanly so a SessionStart MCP wiring sees
    // a "no MCP available" condition without uninstalling the plugin.
    process.stderr.write("anatomy mcp: disabled via ANATOMY_MCP_DISABLE\n");
    return 0;
  }
  const { Server } = await import("@modelcontextprotocol/sdk/server/index.js");
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
  const { CallToolRequestSchema, ListToolsRequestSchema } = await import("@modelcontextprotocol/sdk/types.js");
  const { sectionToolDefinitions, sectionToolHandlers } = await import("../mcp/section-tools.js");
  const { memoryToolDefinitions, memoryToolHandlers } = await import("../mcp/memory-tools.js");

  const server = new Server(
    { name: "anatomy", version: "0.9.0" },
    { capabilities: { tools: {} } },
  );

  const allDefs = [...sectionToolDefinitions, ...memoryToolDefinitions];
  const allHandlers = { ...sectionToolHandlers, ...memoryToolHandlers };

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: allDefs }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const handler = allHandlers[name];
    if (!handler) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: "unknown_tool", tool: name }) }],
        isError: true,
      };
    }
    const result = await handler(args ?? {});
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      isError: "error" in result,
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // server.connect() returns immediately; wait for stdin to close so the
  // process stays alive long enough to serve all requests.
  await new Promise<void>((resolve) => {
    process.stdin.on("close", resolve);
    process.stdin.on("end", resolve);
  });
  return 0;
}
