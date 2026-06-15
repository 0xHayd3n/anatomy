// src/mcp/fff-bridge.ts
// Bridge between anatomy's MCP server and a child `fff mcp` process.
// See docs/superpowers/specs/2026-06-15-anatomy-mcp-with-fff-design.md.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export type BridgeState =
  | "unstarted"
  | "healthy"
  | "restarting"
  | "degraded"
  | "stopped";

export interface ToolDefinition {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface ToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

export interface MCPClientLike {
  connect: () => Promise<void>;
  listTools: () => Promise<{ tools: ToolDefinition[] }>;
  callTool: (req: { name: string; arguments: Record<string, unknown> }) => Promise<ToolResult>;
  close: () => Promise<void>;
  /** Register a handler invoked when the underlying transport / child closes
   *  unexpectedly. Calling this replaces any previously-registered handler. */
  onClose: (handler: () => void) => void;
}

export interface FFFBridgeOptions {
  binPath: string;
  args: string[];
  timeoutMs: number;
  /** Tool names that must not appear in FFF's advertised catalog. Startup
   *  fails if collision is detected. */
  reservedNames?: readonly string[];
  /** Observer invoked on every state transition. The bridge stays a pure
   *  state machine — telemetry and logging live in the caller. */
  onStateChange?: (from: BridgeState, to: BridgeState) => void;
  /** Test seam — production code constructs a real MCP client via SDK. */
  __makeClient?: (opts: { binPath: string; args: readonly string[] }) => MCPClientLike;
}

export class FFFBridge {
  private _state: BridgeState = "unstarted";
  private client: MCPClientLike | null = null;
  private catalog: ToolDefinition[] = [];
  private restartCount = 0;
  private readonly makeClient: (opts: { binPath: string; args: readonly string[] }) => MCPClientLike;

  constructor(private readonly opts: FFFBridgeOptions) {
    this.makeClient =
      opts.__makeClient ?? defaultMakeClient;
  }

  state(): BridgeState {
    return this._state;
  }

  listTools(): readonly ToolDefinition[] {
    return this.catalog;
  }

  private setState(next: BridgeState): void {
    const prev = this._state;
    if (prev === next) return;
    this._state = next;
    if (this.opts.onStateChange) {
      try {
        this.opts.onStateChange(prev, next);
      } catch {
        // Observer errors must not break the state machine.
      }
    }
  }

  async start(): Promise<void> {
    await this.connectAndHandshake();
  }

  private async connectAndHandshake(): Promise<void> {
    // Best-effort close of the prior client (restart path). The old client's
    // transport has already emitted onclose at this point, so close() is
    // largely defensive — it prevents the prior reference from outliving us.
    if (this.client) {
      try {
        await this.client.close();
      } catch {
        // Ignore — the underlying child is already dead.
      }
      this.client = null;
    }
    this.client = this.makeClient({ binPath: this.opts.binPath, args: this.opts.args });
    this.client.onClose(() => {
      void this.onChildExit();
    });
    await this.client.connect();
    const list = await this.client.listTools();
    const reserved = new Set(this.opts.reservedNames ?? []);
    const collisions = list.tools
      .map((t) => t.name)
      .filter((n) => reserved.has(n));
    if (collisions.length > 0) {
      throw new Error(
        `FFFBridge: tool-name collision with anatomy-native tools: ${collisions.join(", ")}`,
      );
    }
    this.catalog = list.tools;
    this.setState("healthy");
  }

  private async onChildExit(): Promise<void> {
    if (this._state === "stopped" || this._state === "degraded") return;
    if (this.restartCount >= 1) {
      this.setState("degraded");
      return;
    }
    this.restartCount++;
    this.setState("restarting");
    try {
      await this.connectAndHandshake();
    } catch {
      this.setState("degraded");
    }
  }

  async dispose(): Promise<void> {
    if (this._state === "stopped") return;
    this.setState("stopped");
    if (this.client) {
      try {
        await this.client.close();
      } catch {
        // Best-effort: never throw from dispose().
      }
      this.client = null;
    }
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    // The 'restarting' state is a transient window between a child crash and
    // a successful re-handshake. Spec contract: in-flight calls during this
    // window receive fff_restarted so the agent can retry, distinct from
    // fff_unavailable (terminal degradation).
    if (this._state === "restarting") {
      return errorResult("fff_restarted");
    }
    if (this._state !== "healthy" || !this.client) {
      return errorResult("fff_unavailable");
    }
    const client = this.client;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<ToolResult>((resolve) => {
      timer = setTimeout(
        () => resolve(errorResult("fff_timeout")),
        this.opts.timeoutMs,
      );
    });
    try {
      return await Promise.race([
        client.callTool({ name, arguments: args }),
        timeoutPromise,
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

function errorResult(code: string): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: code }) }],
    isError: true,
  };
}

/** Default MCP client factory using @modelcontextprotocol/sdk. The transport
 *  owns the child process — anatomy never spawns FFF directly in production.
 *
 *  Windows note: StdioClientTransport spawns via `cross-spawn`, which resolves
 *  `.cmd` shims natively. We therefore do NOT need `shell: true` here, despite
 *  the repo-wide rule about spawnSync requiring it on Windows (memory entry
 *  t9ykw3em) — that rule applies to direct child_process.spawn calls, not
 *  cross-spawn-backed ones. */
function defaultMakeClient({
  binPath,
  args,
}: {
  binPath: string;
  args: readonly string[];
}): MCPClientLike {
  const transport = new StdioClientTransport({
    command: binPath,
    args: [...args],
    stderr: "inherit",
  });
  const client = new Client(
    { name: "anatomy-fff-bridge", version: "1.0.0" },
    { capabilities: {} },
  );
  let onCloseHandler: (() => void) | null = null;
  transport.onclose = () => {
    if (onCloseHandler) onCloseHandler();
  };
  return {
    connect: () => client.connect(transport),
    listTools: async () => {
      const r = await client.listTools();
      return { tools: r.tools as ToolDefinition[] };
    },
    callTool: async (req) => {
      const r = await client.callTool(req);
      return r as unknown as ToolResult;
    },
    close: () => client.close(),
    onClose: (handler) => {
      onCloseHandler = handler;
    },
  };
}
