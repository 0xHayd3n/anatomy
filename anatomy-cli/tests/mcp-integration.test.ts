import { describe, it, expect, beforeAll } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { buildAnatomyToml } from "./_helpers/fixture.js";

const BIN = join(__dirname, "..", "dist", "bin.js");

const ANATOMY = buildAnatomyToml({ tagline: "integration test fixture" });

beforeAll(() => {
  if (!existsSync(BIN)) {
    execSync("npm run build", { cwd: join(__dirname, ".."), stdio: "inherit" });
  }
});

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

async function spawnAndCall(repoDir: string, requests: JsonRpcRequest[]): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", [BIN, "mcp"], {
      cwd: repoDir,
      stdio: ["pipe", "pipe", "pipe"],
      shell: true,
      env: { ...process.env, ANATOMY_TELEMETRY_DISABLE: "1" },
    });
    let buffer = "";
    const responses: unknown[] = [];
    proc.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) {
          try { responses.push(JSON.parse(line)); } catch {}
        }
        if (responses.length === requests.length) {
          proc.stdin.end();
        }
      }
    });
    proc.on("close", () => resolve(responses));
    proc.on("error", reject);
    setTimeout(() => { proc.kill(); reject(new Error("timeout")); }, 10_000);
    for (const req of requests) {
      proc.stdin.write(JSON.stringify(req) + "\n");
    }
  });
}

describe("anatomy mcp (integration)", () => {
  it("responds to tools/list with all 9 tools (anatomy_brief added v0.14)", async () => {
    const repoDir = mkdtempSync(join(tmpdir(), "anat-mcp-int-"));
    execSync("git init", { cwd: repoDir, stdio: "ignore", shell: true });
    writeFileSync(join(repoDir, ".anatomy"), ANATOMY);
    const [resp] = await spawnAndCall(repoDir, [
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
    ]);
    expect((resp as { result: { tools: unknown[] } }).result.tools.length).toBe(9);
  });

  it("responds to tools/call anatomy_overview with the parsed file", async () => {
    const repoDir = mkdtempSync(join(tmpdir(), "anat-mcp-int-"));
    execSync("git init", { cwd: repoDir, stdio: "ignore", shell: true });
    writeFileSync(join(repoDir, ".anatomy"), ANATOMY);
    const [resp] = await spawnAndCall(repoDir, [
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "anatomy_overview", arguments: { path: repoDir } } },
    ]);
    const text = (resp as { result: { content: Array<{ text: string }> } }).result.content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.data.tagline).toBe("integration test fixture");
  });
});
