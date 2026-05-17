import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ingestCommand } from "../src/commands/ingest.js";

function tmpRepo(): string {
  return mkdtempSync(join(tmpdir(), "anat-ingest-cmd-"));
}

function writePkg(repo: string): void {
  writeFileSync(join(repo, "package.json"), JSON.stringify({
    name: "test-pkg",
    version: "0.0.1",
    description: "Test package for ingest integration",
  }, null, 2));
}

const CLAUDE_MD = `# Test repo

## Project conventions

- Tests live in tests/ next to source
- Use TypeScript strict mode
  - Why: caught three bugs in v0.4
- Database queries go through the repository layer
`;

const AGENTS_MD_OVERLAP = `# Agents

## Guidelines

- Run npm test before pushing
- Tests live in tests/ next to source
`;

describe("ingestCommand — e2e", () => {
  it("scan + ingest + validate writes a v1.0 .anatomy", async () => {
    const repo = tmpRepo();
    writePkg(repo);
    writeFileSync(join(repo, "CLAUDE.md"), CLAUDE_MD);

    await ingestCommand({ repo });

    const anatomyPath = join(repo, ".anatomy");
    expect(existsSync(anatomyPath)).toBe(true);
    const content = readFileSync(anatomyPath, "utf8");
    expect(content).toMatch(/anatomy_version = "1\.0"/);
    expect(content).toMatch(/Tests live in tests\/ next to source/);
    expect(content).toMatch(/Use TypeScript strict mode/);
  });

  it("refuses on existing .anatomy without --force", async () => {
    const repo = tmpRepo();
    writePkg(repo);
    writeFileSync(join(repo, "CLAUDE.md"), CLAUDE_MD);
    writeFileSync(join(repo, ".anatomy"), "existing content");

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    // fatal() throws "unreachable" after the mocked process.exit; catch it.
    await ingestCommand({ repo }).catch(() => undefined);

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringMatching(/An \.anatomy already exists/));
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("--force overwrites existing .anatomy", async () => {
    const repo = tmpRepo();
    writePkg(repo);
    writeFileSync(join(repo, "CLAUDE.md"), CLAUDE_MD);
    writeFileSync(join(repo, ".anatomy"), "existing content");

    await ingestCommand({ repo, force: true });

    const content = readFileSync(join(repo, ".anatomy"), "utf8");
    expect(content).not.toBe("existing content");
    expect(content).toMatch(/anatomy_version = "1\.0"/);
  });

  it("--stdout prints without writing", async () => {
    const repo = tmpRepo();
    writePkg(repo);
    writeFileSync(join(repo, "CLAUDE.md"), CLAUDE_MD);

    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await ingestCommand({ repo, stdout: true });

    expect(existsSync(join(repo, ".anatomy"))).toBe(false);
    const printed = stdoutSpy.mock.calls.map(c => String(c[0])).join("");
    expect(printed).toMatch(/anatomy_version = "1\.0"/);

    stdoutSpy.mockRestore();
  });

  it("--no-pass1 emits placeholder identity when there's no manifest", async () => {
    const repo = tmpRepo();
    writeFileSync(join(repo, "CLAUDE.md"), CLAUDE_MD);

    await ingestCommand({ repo, noPass1: true });

    const content = readFileSync(join(repo, ".anatomy"), "utf8");
    expect(content).toMatch(/stack = "unknown"/);
    expect(content).toMatch(/Tests live in tests\/ next to source/);
  });

  it("dedupes rules across CLAUDE.md and AGENTS.md", async () => {
    const repo = tmpRepo();
    writePkg(repo);
    writeFileSync(join(repo, "CLAUDE.md"), CLAUDE_MD);
    writeFileSync(join(repo, "AGENTS.md"), AGENTS_MD_OVERLAP);

    await ingestCommand({ repo });

    const content = readFileSync(join(repo, ".anatomy"), "utf8");
    const matches = content.match(/Tests live in tests\/ next to source/g) ?? [];
    expect(matches.length).toBe(1);
    expect(content).toMatch(/Run npm test before pushing/);
  });

  it("errors when no recognized input files are present", async () => {
    const repo = tmpRepo();
    writePkg(repo);

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await ingestCommand({ repo }).catch(() => undefined);

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringMatching(/No recognized rule files found/));
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
    stderrSpy.mockRestore();
  });
});
