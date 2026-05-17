import { describe, it, expect } from "vitest";

import { parseClaudeMd } from "../src/ingest/claude-md.js";
import { parseAgentsMd } from "../src/ingest/agents-md.js";
import { parseCursorRules } from "../src/ingest/cursor-rules.js";
import { parseWindsurf } from "../src/ingest/windsurf.js";

const SAMPLE_MD = `# Project

## Project conventions

- Tests live in __tests__/ next to source
- Use TypeScript strict mode
  - Why: caught three null-pointer bugs

## Installation

- npm install
`;

describe("parseClaudeMd", () => {
  it("extracts rules from a typical CLAUDE.md", () => {
    const rules = parseClaudeMd(SAMPLE_MD, "CLAUDE.md");
    expect(rules.map(r => r.rule)).toEqual([
      "Tests live in __tests__/ next to source",
      "Use TypeScript strict mode",
    ]);
    expect(rules[1]?.why).toBe("caught three null-pointer bugs");
  });

  it("source.file is set to the passed file name", () => {
    const rules = parseClaudeMd(SAMPLE_MD, "CLAUDE.md");
    expect(rules[0]?.source.file).toBe("CLAUDE.md");
  });

  it("empty input → []", () => {
    expect(parseClaudeMd("", "CLAUDE.md")).toEqual([]);
  });

  it("no allowlisted sections → []", () => {
    const md = `# Title\n\n## Setup\n\n- run npm install\n`;
    expect(parseClaudeMd(md, "CLAUDE.md")).toEqual([]);
  });

  it("multiple allowlisted sections accumulate", () => {
    const md = `## Rules\n\n- A\n\n## Code style\n\n- B\n`;
    expect(parseClaudeMd(md, "CLAUDE.md").map(r => r.rule)).toEqual(["A", "B"]);
  });
});

describe("parseAgentsMd", () => {
  it("extracts rules identically to CLAUDE.md (same format)", () => {
    const rules = parseAgentsMd(SAMPLE_MD, "AGENTS.md");
    expect(rules.map(r => r.rule)).toEqual([
      "Tests live in __tests__/ next to source",
      "Use TypeScript strict mode",
    ]);
  });

  it("source.file is AGENTS.md", () => {
    const rules = parseAgentsMd(SAMPLE_MD, "AGENTS.md");
    expect(rules[0]?.source.file).toBe("AGENTS.md");
  });

  it("handles a realistic AGENTS.md preamble structure", () => {
    const md = "# AGENTS\n\nBrief instructions for AI agents.\n\n## Guidelines\n\n- Run `pnpm test` before commits\n- Never edit generated/ files\n";
    const rules = parseAgentsMd(md, "AGENTS.md");
    expect(rules).toHaveLength(2);
    expect(rules[0]?.rule).toBe("Run `pnpm test` before commits");
  });
});

describe("parseCursorRules", () => {
  it("extracts rules from a typical .cursorrules markdown body", () => {
    const md = `## Coding rules\n\n- Prefer pure functions\n- No mutating array methods\n`;
    const rules = parseCursorRules(md, ".cursorrules");
    expect(rules).toHaveLength(2);
    expect(rules[0]?.rule).toBe("Prefer pure functions");
  });

  it("source.file is .cursorrules", () => {
    const md = `## Rules\n\n- example\n`;
    expect(parseCursorRules(md, ".cursorrules")[0]?.source.file).toBe(".cursorrules");
  });

  it("handles prose-then-rules pattern common in .cursorrules", () => {
    const md = `You are an expert TypeScript developer.\n\n## Guidelines\n\n- Use strict mode\n- Avoid any\n`;
    expect(parseCursorRules(md, ".cursorrules")).toHaveLength(2);
  });
});

describe("parseWindsurf", () => {
  it("extracts rules from a typical .windsurfrules markdown body", () => {
    const md = `## Code style\n\n- Two-space indent\n- Trailing comma in multi-line objects\n`;
    const rules = parseWindsurf(md, ".windsurfrules");
    expect(rules).toHaveLength(2);
  });

  it("source.file is .windsurfrules", () => {
    const md = `## Rules\n\n- example\n`;
    expect(parseWindsurf(md, ".windsurfrules")[0]?.source.file).toBe(".windsurfrules");
  });
});
