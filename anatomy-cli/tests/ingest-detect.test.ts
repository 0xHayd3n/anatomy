import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { detectIngestSources, detectParser } from "../src/ingest/detect.js";

function tmpRepo(): string {
  return mkdtempSync(join(tmpdir(), "anat-ingest-detect-"));
}

describe("detectIngestSources", () => {
  it("returns empty array when no known files exist", () => {
    const repo = tmpRepo();
    expect(detectIngestSources(repo)).toEqual([]);
  });

  it("finds CLAUDE.md at repo root", () => {
    const repo = tmpRepo();
    writeFileSync(join(repo, "CLAUDE.md"), "# x");
    const result = detectIngestSources(repo);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ parser: "claude-md" });
  });

  it("finds all 4 formats when present", () => {
    const repo = tmpRepo();
    writeFileSync(join(repo, "CLAUDE.md"), "x");
    writeFileSync(join(repo, "AGENTS.md"), "x");
    writeFileSync(join(repo, ".cursorrules"), "x");
    writeFileSync(join(repo, ".windsurfrules"), "x");
    const result = detectIngestSources(repo);
    expect(result.map(r => r.parser)).toEqual([
      "claude-md", "agents-md", "cursor-rules", "windsurf",
    ]);
  });

  it("returns canonical order (CLAUDE.md first) regardless of fs order", () => {
    const repo = tmpRepo();
    writeFileSync(join(repo, ".windsurfrules"), "x");
    writeFileSync(join(repo, "AGENTS.md"), "x");
    writeFileSync(join(repo, "CLAUDE.md"), "x");
    const result = detectIngestSources(repo);
    expect(result.map(r => r.parser)).toEqual([
      "claude-md", "agents-md", "windsurf",
    ]);
  });

  it("ignores files in subdirectories (no recursion)", () => {
    const repo = tmpRepo();
    writeFileSync(join(repo, "CLAUDE.md"), "x");
    const result = detectIngestSources(repo);
    expect(result.map(r => r.parser)).toEqual(["claude-md"]);
  });
});

describe("detectParser", () => {
  it("recognizes CLAUDE.md by filename", () => {
    expect(detectParser("/some/path/CLAUDE.md")).toBe("claude-md");
  });

  it("recognizes .cursorrules by filename", () => {
    expect(detectParser("./relative/.cursorrules")).toBe("cursor-rules");
  });

  it("throws on unrecognized filename", () => {
    expect(() => detectParser("/some/foo.txt")).toThrow(/isn't a recognized rule-file format/);
  });
});
