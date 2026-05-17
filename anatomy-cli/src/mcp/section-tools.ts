// src/mcp/section-tools.ts
// Discovery + section tools for the anatomy MCP server.

import { resolve as pathResolve } from "node:path";
import { resolveAnatomy } from "../resolve.js";
import { wrapResponse, wrapError, type SuccessEnvelope, type ErrorEnvelope } from "./envelope.js";
import { recordTelemetry } from "../telemetry.js";
import { pillarString } from "../render/identity.js";
import { readAnatomyFile } from "../io.js";
import { discoverAllAnatomies, validate } from "@anatomytool/validate";
import { briefToolHandler, briefToolDefinition } from "./brief-tool.js";

type ToolResult<T> = SuccessEnvelope<T> | ErrorEnvelope;
type Args = Record<string, unknown>;

function getPath(args: Args): string {
  const p = args.path;
  return typeof p === "string" ? pathResolve(p) : process.cwd();
}

function instrument<T>(name: string, fn: (args: Args) => Promise<ToolResult<T>>): (args: Args) => Promise<ToolResult<T>> {
  return async (args) => {
    const t0 = Date.now();
    let result: ToolResult<T>;
    try {
      result = await fn(args);
    } catch (e) {
      result = { error: "validation_failed", code: "internal", pointer: "", message: e instanceof Error ? e.message : String(e) } as ErrorEnvelope;
    }
    const elapsed = Date.now() - t0;
    const json = JSON.stringify(result);
    recordTelemetry({
      kind: "mcp_call",
      ts: new Date().toISOString(),
      tool: name,
      args,
      repo_fingerprint: typeof (result as { repo_fingerprint?: string }).repo_fingerprint === "string" ? (result as { repo_fingerprint: string }).repo_fingerprint : "",
      result_count: Array.isArray((result as { data?: unknown }).data) ? ((result as { data: unknown[] }).data).length : undefined,
      result_bytes: json.length,
      error: "error" in result ? result.error : null,
      latency_ms: elapsed,
    });
    return result;
  };
}

// ── anatomy_overview ──
async function overview(args: Args): Promise<ToolResult<unknown>> {
  const r = await resolveAnatomy(getPath(args));
  if ("error" in r) return wrapError(r);
  const doc = r.doc as unknown as Record<string, unknown>;
  const data: Record<string, unknown> = {
    tagline: doc.tagline,
    description: doc.description,
    identity: doc.identity,
  };
  if (args.prose === true) {
    // No full anatomy prose renderer exists — produce a simple prose summary.
    const tagline = typeof doc.tagline === "string" ? doc.tagline : "";
    const description = typeof doc.description === "string" ? doc.description : "";
    const identity = doc.identity as Record<string, unknown> | undefined;
    const lines: string[] = [`# ${tagline}`];
    if (description) lines.push("", description);
    if (identity) {
      // pillarString handles both v0.7 flat strings and v0.1-v0.6 nested {id,hash}.
      lines.push("", `Stack: ${pillarString(identity.stack)}  Form: ${pillarString(identity.form)}`);
    }
    data.prose = lines.join("\n");
  }
  return wrapResponse(data, r);
}

// ── per-section tools (factory) ──
function sectionTool(key: string): (args: Args) => Promise<ToolResult<unknown>> {
  return async (args) => {
    const r = await resolveAnatomy(getPath(args));
    if ("error" in r) return wrapError(r);
    const section = (r.doc as unknown as Record<string, unknown>)[key];
    if (section === undefined) return wrapResponse(null, r);
    return wrapResponse(section, r);
  };
}

// anatomy_structure → drills into structure.entries
async function structureTool(args: Args): Promise<ToolResult<unknown>> {
  const r = await resolveAnatomy(getPath(args));
  if ("error" in r) return wrapError(r);
  const entries = (r.doc as unknown as { structure?: { entries?: unknown[] } }).structure?.entries ?? [];
  return wrapResponse(entries, r);
}

// ── anatomy_tree ──
async function treeTool(args: Args): Promise<ToolResult<unknown>> {
  const startPath = getPath(args);
  const found = discoverAllAnatomies(startPath);
  const out: Array<Record<string, unknown>> = [];
  for (const { dirPath, absPath } of found) {
    try {
      const text = readAnatomyFile(absPath);
      const v = await validate(text, { repoRoot: dirPath });
      if (!v.ok) continue; // skip malformed; agent can pull individually
      const doc = v.value as unknown as Record<string, unknown>;
      out.push({
        dirPath,
        anatomy_path: absPath,
        identity: doc.identity,
        tagline: doc.tagline,
      });
    } catch {
      continue; // skip oversize / unreadable; agent can pull individually
    }
  }
  // No single resolved anatomy for tree — anatomy_path is the search root.
  return {
    anatomy_path: startPath,
    staleness: null,
    repo_fingerprint: "",
    data: out,
  };
}

export const sectionToolHandlers: Record<string, (args: Args) => Promise<ToolResult<unknown>>> = {
  anatomy_brief: briefToolHandler as (args: Args) => Promise<ToolResult<unknown>>,
  anatomy_overview: instrument("anatomy_overview", overview),
  anatomy_tree: instrument("anatomy_tree", treeTool),
  anatomy_structure: instrument("anatomy_structure", structureTool),
  anatomy_environment: instrument("anatomy_environment", sectionTool("environment")),
  // anatomy_interface, anatomy_substance, anatomy_domain_model were removed
  // in v0.9 — the cross-repo N=3 eval recorded 0/27, 0/27, 1/27 cite rates
  // for these sections, and their fields are re-derivable from source.
};

// MCP SDK tool definitions (for ListToolsRequestSchema).
export const sectionToolDefinitions = [
  briefToolDefinition,
  {
    name: "anatomy_overview",
    description: "Returns identity + tagline only. Use only for high-level repo summary — prefer anatomy_brief for actual rules / memory / flows context.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to resolve nearest .anatomy from. Defaults to cwd." },
        prose: { type: "boolean", description: "Include a full prose render of the file." },
      },
    },
  },
  {
    name: "anatomy_tree",
    description: "Returns all .anatomy files discovered under path (default repo root). Lets agents see what sub-anatomies exist in a monorepo.",
    inputSchema: { type: "object", properties: { path: { type: "string" } } },
  },
  {
    name: "anatomy_structure",
    description: "Returns the structure.entries array of the resolved .anatomy.",
    inputSchema: { type: "object", properties: { path: { type: "string" } } },
  },
  {
    name: "anatomy_environment",
    description: "Returns environment fields (language_version, runtime, os, required_services, required_env).",
    inputSchema: { type: "object", properties: { path: { type: "string" } } },
  },
];
