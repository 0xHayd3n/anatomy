import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname, resolve as pathResolve } from "node:path";

// Walk the static import graph from src/commands/hook.ts (and src/bin.ts when
// running 'hook'). Confirm @modelcontextprotocol/sdk is never reachable.

const SRC_ROOT = pathResolve(__dirname, "..", "src");

function staticImports(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const out: string[] = [];
  const re = /^import\s+(?:[^"']*\s+from\s+)?["']([^"']+)["']/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m[1]);
  return out;
}

function resolveSpecifier(fromFile: string, spec: string): string | null {
  if (spec.startsWith("node:") || !spec.startsWith(".")) return null;
  const dir = dirname(fromFile);
  let resolved = pathResolve(dir, spec.replace(/\.js$/, ".ts"));
  if (resolved.endsWith(".ts")) return resolved;
  return null;
}

function walk(entry: string): { files: Set<string>; externals: Set<string> } {
  const files = new Set<string>();
  const externals = new Set<string>();
  const stack = [entry];
  while (stack.length > 0) {
    const f = stack.pop()!;
    if (files.has(f)) continue;
    files.add(f);
    for (const spec of staticImports(f)) {
      const r = resolveSpecifier(f, spec);
      if (r) stack.push(r);
      else externals.add(spec);
    }
  }
  return { files, externals };
}

describe("lazy-import discipline", () => {
  it("hook.ts does not statically import @modelcontextprotocol/sdk", () => {
    const { externals } = walk(join(SRC_ROOT, "commands", "hook.ts"));
    const offenders = [...externals].filter(e => e.startsWith("@modelcontextprotocol/sdk"));
    expect(offenders).toEqual([]);
  });

  it("hook.ts does not statically import any mcp/* module", () => {
    const { files } = walk(join(SRC_ROOT, "commands", "hook.ts"));
    const mcpDir1 = `${SRC_ROOT}/mcp/`;
    const mcpDir2 = `${SRC_ROOT}\\mcp\\`;
    const offenders = [...files].filter(f => f.includes(mcpDir1) || f.includes(mcpDir2));
    expect(offenders).toEqual([]);
  });
});
