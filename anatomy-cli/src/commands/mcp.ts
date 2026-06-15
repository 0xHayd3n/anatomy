// src/commands/mcp.ts
// `anatomy mcp` — boots an MCP stdio server registering all anatomy tools.
// Lazy-imports @modelcontextprotocol/sdk so the rest of the CLI stays SDK-free.
// With --with-fff, additionally spawns `fff mcp` as a child and proxies its
// tools through anatomy's MCP namespace. See
// docs/superpowers/specs/2026-06-15-anatomy-mcp-with-fff-design.md.

import type {
  FFFBridge as FFFBridgeType,
  ToolDefinition as FFFToolDefinition,
} from "../mcp/fff-bridge.js";

/** Truthy values that disable the MCP server entirely. Mirrors the
 *  ANATOMY_HOOK_DISABLE convention from hook.ts: any non-"0"/"false"/empty
 *  string disables. */
function isMcpDisabledByEnv(): boolean {
  const raw = process.env.ANATOMY_MCP_DISABLE;
  if (!raw) return false;
  if (raw === "0") return false;
  if (raw.toLowerCase() === "false") return false;
  return true;
}

export interface McpCommandOptions {
  withFff?: boolean;
  withAstGrep?: boolean;
}

export async function mcpCommand(opts: McpCommandOptions = {}): Promise<number> {
  if (isMcpDisabledByEnv()) {
    process.stderr.write("anatomy mcp: disabled via ANATOMY_MCP_DISABLE\n");
    return 0;
  }
  const { Server } = await import("@modelcontextprotocol/sdk/server/index.js");
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
  const { CallToolRequestSchema, ListToolsRequestSchema } = await import(
    "@modelcontextprotocol/sdk/types.js"
  );
  const { sectionToolDefinitions, sectionToolHandlers } = await import("../mcp/section-tools.js");
  const { memoryToolDefinitions, memoryToolHandlers } = await import("../mcp/memory-tools.js");

  const server = new Server(
    { name: "anatomy", version: "0.9.0" },
    { capabilities: { tools: {} } },
  );

  const anatomyDefs: Array<{ name: string; description: string; inputSchema: unknown }> =
    [...sectionToolDefinitions, ...memoryToolDefinitions];
  const anatomyHandlers: Record<string, (a: Record<string, unknown>) => Promise<unknown>> =
    { ...sectionToolHandlers, ...memoryToolHandlers };
  let fffBridge: FFFBridgeType | null = null;
  let fffDefs: FFFToolDefinition[] = [];
  // Resolved only when --with-fff is set, so the no-flag path stays free of
  // any fs / process / telemetry imports — keeps the regression invariant
  // honest (see design doc § Goals).
  let recordTelemetry:
    | typeof import("../telemetry.js").recordTelemetry
    | null = null;

  if (opts.withFff) {
    const { existsSync } = await import("node:fs");
    const { execSync } = await import("node:child_process");
    ({ recordTelemetry } = await import("../telemetry.js"));

    const binPath = resolveFffBin(existsSync, execSync);
    if (!binPath) {
      process.stderr.write(
        "error: fff not found on PATH; install fff or omit --with-fff\n",
      );
      return 1;
    }
    const { FFFBridge } = await import("../mcp/fff-bridge.js");
    // fff ships as a dedicated `fff-mcp` MCP server binary (releases publish
    // e.g. fff-mcp-x86_64-pc-windows-msvc.exe) that takes NO subcommand. The
    // default arg list is therefore empty. ANATOMY_FFF_ARGS overrides for the
    // rare case of a future binary that needs a subcommand.
    const argsEnv = process.env.ANATOMY_FFF_ARGS;
    const args =
      argsEnv !== undefined
        ? argsEnv.split(/\s+/).filter((s) => s.length > 0)
        : [];
    const timeoutMs = Number(process.env.ANATOMY_FFF_TIMEOUT_MS ?? "5000") || 5000;
    const reservedNames = anatomyDefs.map((d) => (d as { name: string }).name);
    const telemetry = recordTelemetry;
    fffBridge = new FFFBridge({
      binPath,
      args,
      timeoutMs,
      reservedNames,
      onStateChange: (_from, to) => {
        if (to === "restarting") {
          // The transition we care about reporting is the *successful*
          // re-handshake (→ healthy) or the failed one (→ degraded). The
          // 'restarting' transition itself is a marker; emit the actionable
          // events on the subsequent transition instead.
          return;
        }
        if (to === "healthy" && _from === "restarting") {
          telemetry({
            kind: "fff_bridge_lifecycle",
            ts: new Date().toISOString(),
            event: "restarted",
          });
          return;
        }
        if (to === "degraded") {
          telemetry({
            kind: "fff_bridge_lifecycle",
            ts: new Date().toISOString(),
            event: "degraded",
          });
        }
      },
    });
    try {
      await fffBridge.start();
      fffDefs = [...fffBridge.listTools()];
      recordTelemetry({
        kind: "fff_bridge_lifecycle",
        ts: new Date().toISOString(),
        event: "started",
      });
    } catch (e) {
      // Best-effort teardown of any partially-initialized child before exiting.
      await fffBridge.dispose().catch(() => undefined);
      process.stderr.write(
        `error: fff handshake failed: ${e instanceof Error ? e.message : String(e)}\n`,
      );
      return 1;
    }
  }

  if (opts.withAstGrep) {
    const { loadAstGrep } = await import("../ast-grep-loader.js");
    const napi = await loadAstGrep();
    if (!napi) {
      process.stderr.write(
        "error: @ast-grep/napi not available; reinstall with " +
        "'npm install --save-optional @ast-grep/napi' or omit --with-ast-grep\n",
      );
      return 1;
    }
    if (!recordTelemetry) {
      ({ recordTelemetry } = await import("../telemetry.js"));
    }
    const { astGrepToolDefinitions, astGrepToolHandlers } = await import("../mcp/ast-grep-tools.js");
    // Collision check against the names already in the dispatch map.
    for (const def of astGrepToolDefinitions) {
      if (def.name in anatomyHandlers) {
        process.stderr.write(`error: ast-grep tool name collision: ${def.name}\n`);
        return 1;
      }
      if (fffDefs.some((d) => d.name === def.name)) {
        process.stderr.write(`error: ast-grep tool name collision with fff bridge: ${def.name}\n`);
        return 1;
      }
    }
    anatomyDefs.push(...astGrepToolDefinitions);
    Object.assign(anatomyHandlers, astGrepToolHandlers);
  }

  const allDefs = [...anatomyDefs, ...fffDefs];

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: allDefs }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const handler = (
      anatomyHandlers as Record<string, (a: Record<string, unknown>) => Promise<unknown>>
    )[name];
    if (handler) {
      // ast-grep handlers get a telemetry wrapper; built-in section/memory
      // handlers already self-instrument inside section-tools.ts.
      if (opts.withAstGrep && name === "ast_grep_search" && recordTelemetry) {
        const t0 = Date.now();
        const result = await handler(args ?? {}) as { content: Array<{ text: string }>; isError?: boolean };
        const text = result.content[0]?.text ?? "{}";
        let parsed: { matches?: unknown[]; truncated?: boolean; language?: string; error?: string; files_scanned?: unknown };
        try { parsed = JSON.parse(text); } catch { parsed = {}; }
        const outcome: "ok" | "missing_pattern" | "missing_lang_or_file_path" | "pattern_parse_failed" | "error" =
          !result.isError ? "ok"
          : parsed.error === "missing_pattern" ? "missing_pattern"
          : parsed.error === "missing_lang_or_file_path" ? "missing_lang_or_file_path"
          : parsed.error === "pattern_parse_failed" ? "pattern_parse_failed"
          : "error";
        const filesScanned = typeof parsed.files_scanned === "number" ? parsed.files_scanned : 0;
        recordTelemetry({
          kind: "ast_grep_call",
          ts: new Date().toISOString(),
          tool: "ast_grep_search",
          lang: typeof parsed.language === "string" ? parsed.language : "",
          files_scanned: filesScanned,
          matches: Array.isArray(parsed.matches) ? parsed.matches.length : 0,
          truncated: !!parsed.truncated,
          duration_ms: Date.now() - t0,
          outcome,
        });
        return result;
      }
      const result = await handler(args ?? {});
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        isError: typeof result === "object" && result !== null && "error" in result,
      };
    }
    if (fffBridge && fffDefs.some((d) => d.name === name)) {
      const t0 = Date.now();
      const r = await fffBridge.callTool(
        name,
        (args ?? {}) as Record<string, unknown>,
      );
      const outcome: "ok" | "timeout" | "unavailable" | "restarted" | "error" = !r.isError
        ? "ok"
        : r.content[0]?.text?.includes("fff_timeout")
          ? "timeout"
          : r.content[0]?.text?.includes("fff_unavailable")
            ? "unavailable"
            : r.content[0]?.text?.includes("fff_restarted")
              ? "restarted"
              : "error";
      if (recordTelemetry) {
        recordTelemetry({
          kind: "fff_call",
          ts: new Date().toISOString(),
          tool: name,
          duration_ms: Date.now() - t0,
          outcome,
        });
      }
      // SDK's ServerResult includes optional fields (e.g. `task`) that the
      // bridge's ToolResult doesn't carry; the runtime shape (`content` +
      // `isError`) is compatible, so cast to the broader type.
      return r as unknown as { content: Array<{ type: string; text: string }>; isError?: boolean };
    }
    return {
      content: [{ type: "text", text: JSON.stringify({ error: "unknown_tool", tool: name }) }],
      isError: true,
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  try {
    await new Promise<void>((resolve) => {
      process.stdin.on("close", resolve);
      process.stdin.on("end", resolve);
    });
  } finally {
    if (fffBridge && recordTelemetry) {
      await fffBridge.dispose();
      recordTelemetry({
        kind: "fff_bridge_lifecycle",
        ts: new Date().toISOString(),
        event: "stopped",
      });
    }
  }
  return 0;
}

function resolveFffBin(
  existsSync: (p: string) => boolean,
  execSync: (cmd: string, opts: object) => Buffer | string,
): string | null {
  const envBin = process.env.ANATOMY_FFF_BIN;
  if (envBin && envBin.length > 0) return existsSync(envBin) ? envBin : null;
  try {
    const cmd = process.platform === "win32" ? "where fff" : "command -v fff";
    const shell = process.platform === "win32" ? "cmd.exe" : "/bin/sh";
    const out = execSync(cmd, { stdio: ["ignore", "pipe", "ignore"], shell })
      .toString()
      .trim();
    const first = out.split(/\r?\n/)[0]?.trim();
    return first && existsSync(first) ? first : null;
  } catch {
    return null;
  }
}
