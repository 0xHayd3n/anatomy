import { describe, it, expect } from "vitest";
import { spawn, execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAnatomyToml } from "./_helpers/fixture.js";

const FFF_BIN = process.env.ANATOMY_FFF_INTEGRATION_BIN;
const BIN = join(__dirname, "..", "dist", "bin.js");
const ANATOMY = buildAnatomyToml({ tagline: "fff integration fixture" });

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

async function spawnAndCall(
  repoDir: string,
  requests: JsonRpcRequest[],
  env: Record<string, string>,
): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", [BIN, "mcp", "--with-fff"], {
      cwd: repoDir,
      stdio: ["pipe", "pipe", "pipe"],
      shell: true,
      env: { ...process.env, ANATOMY_TELEMETRY_DISABLE: "1", ...env },
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
          try {
            responses.push(JSON.parse(line));
          } catch {
            /* ignore non-JSON lines */
          }
        }
        if (responses.length === requests.length) {
          proc.stdin.end();
        }
      }
    });
    proc.on("close", () => resolve(responses));
    proc.on("error", reject);
    setTimeout(() => {
      proc.kill();
      reject(new Error("timeout"));
    }, 15_000);
    for (const req of requests) {
      proc.stdin.write(JSON.stringify(req) + "\n");
    }
  });
}

describe.skipIf(!FFF_BIN)("anatomy mcp --with-fff (real fff binary)", () => {
  it("merges fff tools into the anatomy tool list", async () => {
    const repoDir = mkdtempSync(join(tmpdir(), "anat-fff-int-"));
    execSync("git init", { cwd: repoDir, stdio: "ignore", shell: true });
    writeFileSync(join(repoDir, ".anatomy"), ANATOMY);
    writeFileSync(join(repoDir, "README.md"), "# fixture\nTODO marker line\n");
    const [resp] = await spawnAndCall(
      repoDir,
      [{ jsonrpc: "2.0", id: 1, method: "tools/list" }],
      { ANATOMY_FFF_BIN: FFF_BIN! },
    );
    const tools = (resp as { result: { tools: Array<{ name: string }> } }).result.tools.map(
      (t) => t.name,
    );
    // Anatomy's 9 tools must still be present.
    expect(tools).toEqual(
      expect.arrayContaining([
        "anatomy_brief",
        "anatomy_overview",
        "anatomy_memory_search",
      ]),
    );
    // At least one fff tool was bridged. The exact set depends on fff's
    // version; ffgrep is the canonical primary tool per fff's README.
    expect(tools.length).toBeGreaterThan(9);
  });
});
