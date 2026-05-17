import { describe, it, expect } from "vitest";
import { dedupe, normalizeRuleText } from "../src/ingest/dedupe.js";
import type { IngestedRule } from "../src/ingest/types.js";

function rule(text: string, file = "CLAUDE.md"): IngestedRule {
  return { rule: text, source: { file, line: 1, section: "Rules" } };
}

describe("normalizeRuleText", () => {
  it("lowercases", () => {
    expect(normalizeRuleText("FOO Bar")).toBe("foo bar");
  });

  it("collapses whitespace runs", () => {
    expect(normalizeRuleText("a    b\tc")).toBe("a b c");
  });

  it("strips trailing punctuation .,;:", () => {
    expect(normalizeRuleText("rule end.")).toBe("rule end");
    expect(normalizeRuleText("rule end:")).toBe("rule end");
    expect(normalizeRuleText("rule end,")).toBe("rule end");
    expect(normalizeRuleText("rule end;")).toBe("rule end");
  });

  it("strips backticks", () => {
    expect(normalizeRuleText("`spawnSync` must pass shell:true"))
      .toBe("spawnsync must pass shell:true");
  });

  it("treats `spawnSync...` and `spawnsync...` (backtick-stripped) as equal", () => {
    expect(normalizeRuleText("`spawnSync` must pass shell:true."))
      .toBe(normalizeRuleText("spawnsync must pass shell:true"));
  });
});

describe("dedupe", () => {
  it("returns identical input when no duplicates", () => {
    const rules = [rule("A"), rule("B"), rule("C")];
    const { kept, dropped } = dedupe(rules);
    expect(kept.map(r => r.rule)).toEqual(["A", "B", "C"]);
    expect(dropped).toEqual([]);
  });

  it("first occurrence wins on exact duplicate", () => {
    const rules = [rule("A", "CLAUDE.md"), rule("A", "AGENTS.md")];
    const { kept, dropped } = dedupe(rules);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.source.file).toBe("CLAUDE.md");
    expect(dropped[0]?.source.file).toBe("AGENTS.md");
  });

  it("dedupes despite trailing punctuation difference", () => {
    const rules = [rule("Use strict mode"), rule("Use strict mode.")];
    expect(dedupe(rules).kept).toHaveLength(1);
  });

  it("dedupes despite backtick presence", () => {
    const rules = [
      rule("`spawnSync` must pass shell:true"),
      rule("spawnSync must pass shell:true"),
    ];
    expect(dedupe(rules).kept).toHaveLength(1);
  });

  it("preserves original casing/punctuation in the kept rule", () => {
    const rules = [rule("USE STRICT MODE."), rule("use strict mode")];
    const { kept } = dedupe(rules);
    expect(kept[0]?.rule).toBe("USE STRICT MODE.");
  });

  it("handles whitespace differences", () => {
    const rules = [rule("a  b   c"), rule("a b c")];
    expect(dedupe(rules).kept).toHaveLength(1);
  });

  it("preserves order of first-occurrence wins across multiple files", () => {
    const rules = [
      rule("A", "CLAUDE.md"),
      rule("B", "AGENTS.md"),
      rule("A", "AGENTS.md"),
      rule("C", ".cursorrules"),
    ];
    const { kept, dropped } = dedupe(rules);
    expect(kept.map(r => r.rule)).toEqual(["A", "B", "C"]);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]?.source.file).toBe("AGENTS.md");
  });
});
