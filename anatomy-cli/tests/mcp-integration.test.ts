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

describe("anatomy mcp --with-fff", () => {
  it("hard-fails with an actionable error when fff is not on PATH", () => {
    const repoDir = mkdtempSync(join(tmpdir(), "anat-mcp-fff-"));
    execSync("git init", { cwd: repoDir, stdio: "ignore", shell: true });
    writeFileSync(join(repoDir, ".anatomy"), ANATOMY);

    let stderr = "";
    let exitCode = 0;
    try {
      execSync(`node "${BIN}" mcp --with-fff`, {
        cwd: repoDir,
        env: {
          ...process.env,
          ANATOMY_FFF_BIN: "C:/definitely/not/a/real/path/to/fff.exe",
          ANATOMY_TELEMETRY_DISABLE: "1",
        },
        stdio: ["pipe", "pipe", "pipe"],
        shell: true,
      });
    } catch (e) {
      const err = e as { status?: number; stderr?: Buffer };
      exitCode = err.status ?? 0;
      stderr = err.stderr?.toString() ?? "";
    }
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/fff not found/i);
  });

  it("regression: anatomy mcp without --with-fff still advertises the anatomy-native tool count", async () => {
    const repoDir = mkdtempSync(join(tmpdir(), "anat-mcp-noflag-"));
    execSync("git init", { cwd: repoDir, stdio: "ignore", shell: true });
    writeFileSync(join(repoDir, ".anatomy"), ANATOMY);
    const [resp] = await spawnAndCall(repoDir, [
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
    ]);
    expect((resp as { result: { tools: unknown[] } }).result.tools.length).toBe(9);
  });
});

describe("anatomy mcp --with-ast-grep", () => {
  it("hard-fails with actionable error when @ast-grep/napi is unavailable", () => {
    const repoDir = mkdtempSync(join(tmpdir(), "anat-mcp-ast-"));
    execSync("git init", { cwd: repoDir, stdio: "ignore", shell: true });
    writeFileSync(join(repoDir, ".anatomy"), ANATOMY);

    let stderr = "";
    let exitCode = 0;
    try {
      execSync(`node "${BIN}" mcp --with-ast-grep`, {
        cwd: repoDir,
        env: {
          ...process.env,
          ANATOMY_AST_GREP_DISABLE: "1",
          ANATOMY_TELEMETRY_DISABLE: "1",
        },
        stdio: ["pipe", "pipe", "pipe"],
        shell: true,
      });
    } catch (e) {
      const err = e as { status?: number; stderr?: Buffer };
      exitCode = err.status ?? 0;
      stderr = err.stderr?.toString() ?? "";
    }
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/@ast-grep\/napi not available/i);
  });

  it("merges ast_grep_search into the tools list when enabled", { timeout: 30_000 }, async () => {
    const repoDir = mkdtempSync(join(tmpdir(), "anat-mcp-ast-on-"));
    execSync("git init", { cwd: repoDir, stdio: "ignore", shell: true });
    writeFileSync(join(repoDir, ".anatomy"), ANATOMY);

    const [resp] = await spawnAndCall(repoDir, [
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
    ]);
    // 9 anatomy-native tools — this call goes through the existing spawnAndCall
    // helper which does NOT pass --with-ast-grep. The 10-tool case is exercised
    // below by spawnAstGrep().
    expect((resp as { result: { tools: unknown[] } }).result.tools.length).toBe(9);

    const [respWith] = await spawnAstGrep(repoDir, [
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
    ]);
    const tools = (respWith as { result: { tools: Array<{ name: string }> } }).result.tools.map(
      (t) => t.name,
    );
    expect(tools).toContain("ast_grep_search");
    expect(tools).toHaveLength(10);
  });

  it("ast_grep_search round-trips through MCP and returns matches", { timeout: 30_000 }, async () => {
    const repoDir = mkdtempSync(join(tmpdir(), "anat-mcp-ast-roundtrip-"));
    execSync("git init", { cwd: repoDir, stdio: "ignore", shell: true });
    writeFileSync(join(repoDir, ".anatomy"), ANATOMY);
    writeFileSync(
      join(repoDir, "a.ts"),
      "console.log('alpha');\nconsole.log('beta');\nconsole.error('gamma');\n",
    );

    const [resp] = await spawnAstGrep(repoDir, [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "ast_grep_search",
          arguments: { pattern: "console.log($X)", file_path: "*.ts" },
        },
      },
    ]);
    const text = (resp as { result: { content: Array<{ text: string }> } }).result.content[0].text;
    const data = JSON.parse(text);
    expect(data.matches).toHaveLength(2);
    expect(data.language).toBe("ts");
    expect(data.matches[0].captures.X).toBe("'alpha'");
  });
});

async function spawnAstGrep(repoDir: string, requests: JsonRpcRequest[]): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", [BIN, "mcp", "--with-ast-grep"], {
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
        if (responses.length === requests.length) proc.stdin.end();
      }
    });
    proc.on("close", () => resolve(responses));
    proc.on("error", reject);
    setTimeout(() => { proc.kill(); reject(new Error("timeout")); }, 10_000);
    for (const req of requests) proc.stdin.write(JSON.stringify(req) + "\n");
  });
}

describe("anatomy mcp --with-git-history", () => {
  it("hard-fails with actionable error when git is unavailable", () => {
    const repoDir = mkdtempSync(join(tmpdir(), "anat-mcp-git-"));
    execSync("git init", { cwd: repoDir, stdio: "ignore", shell: true });
    writeFileSync(join(repoDir, ".anatomy"), ANATOMY);

    let stderr = "";
    let exitCode = 0;
    try {
      execSync(`node "${BIN}" mcp --with-git-history`, {
        cwd: repoDir,
        env: {
          ...process.env,
          ANATOMY_GIT_DISABLE: "1",
          ANATOMY_TELEMETRY_DISABLE: "1",
        },
        stdio: ["pipe", "pipe", "pipe"],
        shell: true,
      });
    } catch (e) {
      const err = e as { status?: number; stderr?: Buffer };
      exitCode = err.status ?? 0;
      stderr = err.stderr?.toString() ?? "";
    }
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/git not found/i);
  });

  it("hard-fails with actionable error when cwd is not a git repo", () => {
    const repoDir = mkdtempSync(join(tmpdir(), "anat-mcp-nogit-"));
    // No `git init` here — deliberately not a repo.
    writeFileSync(join(repoDir, ".anatomy"), ANATOMY);

    let stderr = "";
    let exitCode = 0;
    try {
      execSync(`node "${BIN}" mcp --with-git-history`, {
        cwd: repoDir,
        env: {
          ...process.env,
          ANATOMY_TELEMETRY_DISABLE: "1",
        },
        stdio: ["pipe", "pipe", "pipe"],
        shell: true,
      });
    } catch (e) {
      const err = e as { status?: number; stderr?: Buffer };
      exitCode = err.status ?? 0;
      stderr = err.stderr?.toString() ?? "";
    }
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/not in a git repository/i);
  });
});
