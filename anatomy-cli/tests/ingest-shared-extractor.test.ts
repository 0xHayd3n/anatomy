import { describe, it, expect } from "vitest";
import { extractRules } from "../src/ingest/shared-extractor.js";

describe("extractRules — heading allowlist", () => {
  it("extracts bullets under '## Rules'", () => {
    const md = `# Title\n\n## Rules\n\n- A\n- B\n`;
    const rules = extractRules(md, "x.md");
    expect(rules.map(r => r.rule)).toEqual(["A", "B"]);
  });

  it("extracts bullets under all 9 allowlisted heading variants (case-insensitive)", () => {
    const variants = [
      "Rules", "Conventions", "Guidelines", "Code style", "Code conventions",
      "Project conventions", "Coding rules", "Coding conventions", "Code guidelines",
    ];
    for (const heading of variants) {
      const md = `## ${heading.toUpperCase()}\n\n- bullet for ${heading}\n`;
      const rules = extractRules(md, "x.md");
      expect(rules.length, `for heading "${heading}"`).toBe(1);
      expect(rules[0].rule).toBe(`bullet for ${heading}`);
    }
  });

  it("skips bullets under non-allowlisted headings (Installation, Usage, etc.)", () => {
    const md = `## Installation\n\n- npm install\n- npm test\n`;
    expect(extractRules(md, "x.md")).toEqual([]);
  });

  it("exits rule-source mode when a same-level heading appears", () => {
    const md = `## Rules\n\n- rule A\n\n## Installation\n\n- not a rule\n`;
    const rules = extractRules(md, "x.md");
    expect(rules.map(r => r.rule)).toEqual(["rule A"]);
  });

  it("treats H3 inside an allowlisted H2 as still in scope", () => {
    const md = `## Rules\n\n### Security\n\n- secure rule\n\n### Style\n\n- style rule\n`;
    const rules = extractRules(md, "x.md");
    expect(rules.map(r => r.rule)).toEqual(["secure rule", "style rule"]);
  });
});

describe("extractRules — bullet parsing", () => {
  it("supports both - and * bullet markers", () => {
    const md = `## Rules\n\n- dash bullet\n* star bullet\n`;
    const rules = extractRules(md, "x.md");
    expect(rules.map(r => r.rule)).toEqual(["dash bullet", "star bullet"]);
  });

  it("captures Why: sub-bullet as why field", () => {
    const md = `## Rules\n\n- Use strict mode\n  - Why: caught three bugs\n`;
    const rules = extractRules(md, "x.md");
    expect(rules[0]).toMatchObject({ rule: "Use strict mode", why: "caught three bugs" });
  });

  it("captures Because: sub-bullet as why field", () => {
    const md = `## Rules\n\n- Use strict mode\n  - Because: type safety\n`;
    expect(extractRules(md, "x.md")[0]?.why).toBe("type safety");
  });

  it("captures Reason: sub-bullet as why field", () => {
    const md = `## Rules\n\n- Use strict mode\n  - Reason: catches null bugs\n`;
    expect(extractRules(md, "x.md")[0]?.why).toBe("catches null bugs");
  });

  it("Why prefix is case-insensitive", () => {
    const md = `## Rules\n\n- A\n  - WHY: x\n- B\n  - because: y\n`;
    const out = extractRules(md, "x.md");
    expect(out[0]?.why).toBe("x");
    expect(out[1]?.why).toBe("y");
  });

  it("multi-line bullets concatenate continuation lines with single space", () => {
    const md = `## Rules\n\n- First line\n  continuation here\n  and more\n`;
    expect(extractRules(md, "x.md")[0]?.rule).toBe("First line continuation here and more");
  });

  it("skips numbered lists", () => {
    const md = `## Rules\n\n1. first numbered\n2. second numbered\n- bullet\n`;
    expect(extractRules(md, "x.md").map(r => r.rule)).toEqual(["bullet"]);
  });

  it("preserves inline code (backticks) in rule text", () => {
    const md = "## Rules\n\n- Use `strict: true` always\n";
    expect(extractRules(md, "x.md")[0]?.rule).toBe("Use `strict: true` always");
  });
});

describe("extractRules — truncation and capping", () => {
  it("truncates rule > 300 chars and emits warning via console.warn", () => {
    const longRule = "A".repeat(350);
    const md = `## Rules\n\n- ${longRule}\n`;
    const rules = extractRules(md, "x.md");
    expect(rules[0]?.rule.length).toBe(300);
  });

  it("truncates why > 200 chars", () => {
    const longWhy = "B".repeat(250);
    const md = `## Rules\n\n- rule\n  - Why: ${longWhy}\n`;
    expect(extractRules(md, "x.md")[0]?.why?.length).toBe(200);
  });

  it("caps total rules at 20", () => {
    const bullets = Array.from({ length: 25 }, (_, i) => `- rule ${i}`).join("\n");
    const md = `## Rules\n\n${bullets}\n`;
    const rules = extractRules(md, "x.md");
    expect(rules.length).toBe(20);
    expect(rules[19]?.rule).toBe("rule 19");
  });
});

describe("extractRules — source metadata", () => {
  it("records source file, line, and section for each rule", () => {
    const md = `# Title\n\n## Rules\n\n- first rule\n- second rule\n`;
    const rules = extractRules(md, "CLAUDE.md");
    expect(rules[0]?.source).toMatchObject({
      file: "CLAUDE.md",
      section: "Rules",
    });
    expect(rules[0]?.source.line).toBeGreaterThanOrEqual(5);
    expect(rules[1]?.source.line).toBeGreaterThan(rules[0]?.source.line ?? 0);
  });
});

describe("extractRules — empty and degenerate inputs", () => {
  it("empty text → []", () => {
    expect(extractRules("", "x.md")).toEqual([]);
  });

  it("no allowlisted headings → []", () => {
    const md = `# Title\n\nSome prose.\n\n## Installation\n\n- npm install\n`;
    expect(extractRules(md, "x.md")).toEqual([]);
  });

  it("allowlisted heading with no bullets → []", () => {
    const md = `## Rules\n\nSome prose without bullets.\n\n## End\n`;
    expect(extractRules(md, "x.md")).toEqual([]);
  });
});
