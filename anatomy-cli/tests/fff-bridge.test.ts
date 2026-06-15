import { describe, it, expect, vi } from "vitest";
import { recordTelemetry } from "../src/telemetry.js";
import {
  FFFBridge,
  type MCPClientLike,
  type ToolDefinition,
  type ToolResult,
} from "../src/mcp/fff-bridge.js";

describe("FFFBridge telemetry types", () => {
  it("accepts fff_bridge_lifecycle records", () => {
    expect(() =>
      recordTelemetry({
        kind: "fff_bridge_lifecycle",
        ts: new Date().toISOString(),
        event: "started",
      })
    ).not.toThrow();
  });

  it("accepts fff_call records", () => {
    expect(() =>
      recordTelemetry({
        kind: "fff_call",
        ts: new Date().toISOString(),
        tool: "ffgrep",
        duration_ms: 12,
        outcome: "ok",
      })
    ).not.toThrow();
  });
});

interface MockClientHandle {
  client: MCPClientLike;
  /** Fires the registered onClose handler, simulating a child crash. */
  triggerClose: () => void;
  /** Last callTool argument received, or null if none yet. */
  lastCall: { name: string; arguments: Record<string, unknown> } | null;
  /** Number of times close() has been called. */
  closeCount: number;
}

function makeMockClient(opts: {
  catalog?: ToolDefinition[];
  callTool?: (req: { name: string; arguments: Record<string, unknown> }) => Promise<ToolResult>;
} = {}): MockClientHandle {
  const handle: MockClientHandle = {
    client: null as unknown as MCPClientLike,
    triggerClose: () => undefined,
    lastCall: null,
    closeCount: 0,
  };
  let onCloseHandler: (() => void) | null = null;
  handle.client = {
    connect: async () => undefined,
    listTools: async () => ({ tools: opts.catalog ?? [{ name: "ffgrep" }] }),
    callTool: async (req) => {
      handle.lastCall = req;
      if (opts.callTool) return opts.callTool(req);
      return { content: [{ type: "text", text: "ok" }] };
    },
    close: async () => {
      handle.closeCount++;
    },
    onClose: (h) => {
      onCloseHandler = h;
    },
  };
  handle.triggerClose = () => {
    if (onCloseHandler) onCloseHandler();
  };
  return handle;
}

describe("FFFBridge construction", () => {
  it("can be constructed with a binary path and starts as unstarted", () => {
    const bridge = new FFFBridge({
      binPath: "/fake/fff",
      args: ["mcp"],
      timeoutMs: 5000,
    });
    expect(bridge.state()).toBe("unstarted");
  });
});

describe("FFFBridge.start", () => {
  it("constructs the client with the right opts, handshakes, and caches tools", async () => {
    const handle = makeMockClient({ catalog: [{ name: "ffgrep" }, { name: "fffind" }] });
    let receivedOpts: { binPath: string; args: readonly string[] } | null = null;
    const bridge = new FFFBridge({
      binPath: "/fake/fff",
      args: ["mcp"],
      timeoutMs: 5000,
      __makeClient: (o) => {
        receivedOpts = o;
        return handle.client;
      },
    });

    await bridge.start();

    expect(receivedOpts).toEqual({ binPath: "/fake/fff", args: ["mcp"] });
    expect(bridge.state()).toBe("healthy");
    expect(bridge.listTools().map((t) => t.name)).toEqual(["ffgrep", "fffind"]);
  });
});

describe("FFFBridge.callTool", () => {
  it("forwards calls to the MCP client and returns the result", async () => {
    const handle = makeMockClient({
      catalog: [{ name: "ffgrep" }],
      callTool: async () => ({ content: [{ type: "text", text: "matches: 3" }] }),
    });
    const bridge = new FFFBridge({
      binPath: "/fake/fff",
      args: ["mcp"],
      timeoutMs: 5000,
      __makeClient: () => handle.client,
    });
    await bridge.start();

    const result = await bridge.callTool("ffgrep", { pattern: "TODO" });

    expect(handle.lastCall).toEqual({ name: "ffgrep", arguments: { pattern: "TODO" } });
    expect(result).toEqual({ content: [{ type: "text", text: "matches: 3" }] });
  });

  it("returns fff_unavailable when the bridge is not healthy", async () => {
    const bridge = new FFFBridge({
      binPath: "/fake/fff",
      args: ["mcp"],
      timeoutMs: 5000,
    });
    const r = await bridge.callTool("ffgrep", {});
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toContain("fff_unavailable");
  });
});

describe("FFFBridge timeout", () => {
  it("returns fff_timeout when the client never resolves", async () => {
    vi.useFakeTimers();
    try {
      const handle = makeMockClient({
        catalog: [{ name: "ffgrep" }],
        callTool: () => new Promise<ToolResult>(() => undefined),
      });
      const bridge = new FFFBridge({
        binPath: "/fake/fff",
        args: ["mcp"],
        timeoutMs: 5000,
        __makeClient: () => handle.client,
      });
      await bridge.start();

      const callPromise = bridge.callTool("ffgrep", { pattern: "x" });
      await vi.advanceTimersByTimeAsync(5001);
      const result = await callPromise;

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("fff_timeout");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("FFFBridge.dispose", () => {
  it("is idempotent and closes the client", async () => {
    const handle = makeMockClient();
    const bridge = new FFFBridge({
      binPath: "/fake/fff",
      args: ["mcp"],
      timeoutMs: 5000,
      __makeClient: () => handle.client,
    });
    await bridge.start();

    await bridge.dispose();
    expect(bridge.state()).toBe("stopped");
    expect(handle.closeCount).toBe(1);

    await expect(bridge.dispose()).resolves.toBeUndefined();
    expect(handle.closeCount).toBe(1);
  });
});

describe("FFFBridge collision detection", () => {
  it("throws when an FFF tool name collides with a reserved anatomy name", async () => {
    const handle = makeMockClient({ catalog: [{ name: "anatomy_overview" }] });
    const bridge = new FFFBridge({
      binPath: "/fake/fff",
      args: ["mcp"],
      timeoutMs: 5000,
      reservedNames: ["anatomy_overview", "anatomy_brief"],
      __makeClient: () => handle.client,
    });

    await expect(bridge.start()).rejects.toThrow(/collision/i);
  });

  it("accepts catalogs that do not collide with reserved names", async () => {
    const handle = makeMockClient({ catalog: [{ name: "ffgrep" }, { name: "fffind" }] });
    const bridge = new FFFBridge({
      binPath: "/fake/fff",
      args: ["mcp"],
      timeoutMs: 5000,
      reservedNames: ["anatomy_overview", "anatomy_brief"],
      __makeClient: () => handle.client,
    });

    await expect(bridge.start()).resolves.toBeUndefined();
    expect(bridge.state()).toBe("healthy");
  });
});

describe("FFFBridge state observability", () => {
  it("emits onStateChange for every transition during the crash lifecycle", async () => {
    const handle1 = makeMockClient();
    const handle2 = makeMockClient();
    const handles = [handle1, handle2];
    let factoryCalls = 0;
    const transitions: Array<[string, string]> = [];
    const bridge = new FFFBridge({
      binPath: "/fake/fff",
      args: ["mcp"],
      timeoutMs: 5000,
      onStateChange: (from, to) => transitions.push([from, to]),
      __makeClient: () => {
        const h = handles[factoryCalls++];
        if (!h) throw new Error("unexpected factory call");
        return h.client;
      },
    });
    await bridge.start();
    // unstarted → healthy
    handle1.triggerClose();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    // healthy → restarting → healthy
    handle2.triggerClose();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    // healthy → degraded

    expect(transitions).toEqual([
      ["unstarted", "healthy"],
      ["healthy", "restarting"],
      ["restarting", "healthy"],
      ["healthy", "degraded"],
    ]);
  });

  it("fires the 'stopped' transition on dispose", async () => {
    const handle = makeMockClient();
    const transitions: Array<[string, string]> = [];
    const bridge = new FFFBridge({
      binPath: "/fake/fff",
      args: ["mcp"],
      timeoutMs: 5000,
      onStateChange: (from, to) => transitions.push([from, to]),
      __makeClient: () => handle.client,
    });
    await bridge.start();
    await bridge.dispose();

    expect(transitions).toEqual([
      ["unstarted", "healthy"],
      ["healthy", "stopped"],
    ]);
  });

  it("returns fff_restarted during the restarting window (in-flight contract)", async () => {
    // Make the first reconnect block until we release it, so we can observe
    // the bridge while it sits in the 'restarting' state.
    const handle1 = makeMockClient();
    let releaseConnect: () => void = () => undefined;
    const blocked: MCPClientLike = {
      connect: () => new Promise<void>((resolve) => { releaseConnect = resolve; }),
      listTools: async () => ({ tools: [{ name: "ffgrep" }] }),
      callTool: async () => ({ content: [{ type: "text", text: "ok" }] }),
      close: async () => undefined,
      onClose: () => undefined,
    };
    let factoryCalls = 0;
    const bridge = new FFFBridge({
      binPath: "/fake/fff",
      args: ["mcp"],
      timeoutMs: 5000,
      __makeClient: () => {
        factoryCalls++;
        return factoryCalls === 1 ? handle1.client : blocked;
      },
    });
    await bridge.start();

    handle1.triggerClose();
    // Yield so onChildExit transitions to 'restarting' and starts awaiting the
    // (blocked) reconnect. We don't release `connect` — we want the bridge to
    // sit in 'restarting' while we issue a call.
    await new Promise((r) => setImmediate(r));
    expect(bridge.state()).toBe("restarting");

    const r = await bridge.callTool("ffgrep", {});
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toContain("fff_restarted");

    // Cleanup so the bridge doesn't leak the pending connect promise.
    releaseConnect();
    await new Promise((r) => setImmediate(r));
  });
});

describe("FFFBridge crash recovery", () => {
  it("restarts the client after the first crash", async () => {
    const handle1 = makeMockClient();
    const handle2 = makeMockClient();
    const handles = [handle1, handle2];
    let factoryCalls = 0;
    const bridge = new FFFBridge({
      binPath: "/fake/fff",
      args: ["mcp"],
      timeoutMs: 5000,
      __makeClient: () => {
        const h = handles[factoryCalls++];
        if (!h) throw new Error("factory called more times than expected");
        return h.client;
      },
    });
    await bridge.start();
    expect(bridge.state()).toBe("healthy");

    handle1.triggerClose();
    // Yield twice so the async onChildExit → connectAndHandshake chain resolves.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(factoryCalls).toBe(2);
    expect(bridge.state()).toBe("healthy");
  });

  it("degrades after the second crash and stops re-creating the client", async () => {
    const handle1 = makeMockClient();
    const handle2 = makeMockClient();
    const handles = [handle1, handle2];
    let factoryCalls = 0;
    const bridge = new FFFBridge({
      binPath: "/fake/fff",
      args: ["mcp"],
      timeoutMs: 5000,
      __makeClient: () => {
        const h = handles[factoryCalls++];
        if (!h) throw new Error("unexpected factory call");
        return h.client;
      },
    });
    await bridge.start();
    handle1.triggerClose();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    handle2.triggerClose();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(bridge.state()).toBe("degraded");
    const r = await bridge.callTool("ffgrep", {});
    expect(r.content[0]?.text).toContain("fff_unavailable");
    expect(factoryCalls).toBe(2);
  });
});
