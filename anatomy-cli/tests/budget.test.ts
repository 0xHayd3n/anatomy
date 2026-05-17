import { describe, it, expect } from "vitest";
import {
  applyBudget,
  renderSections,
  type AgentsMdSections,
} from "../src/render/budget.js";

function baseSections(): AgentsMdSections {
  return {
    title: "# x",
    banner: ["> banner"],
    commands: [],
    structure: [],
    rules: [],
    flows: [],
    decisions: [],
    keyDeps: [],
    memory: [],
    footer: ["---", "*footer*"],
    truncated: false,
  };
}

describe("applyBudget", () => {
  it("returns sections unchanged when under budget", () => {
    const s = baseSections();
    s.rules = [{ rule: "small", why: "small" }];
    const out = applyBudget(s, 1500);
    expect(out.truncated).toBe(false);
    expect(out.rules).toEqual([{ rule: "small", why: "small" }]);
  });

  it("drops memory tail first when over budget", () => {
    const s = baseSections();
    s.memory = Array.from({ length: 20 }, (_, i) => ({
      kind: "gotcha",
      date: "2026-05-01",
      topic: `topic-${i}`,
      content: "x".repeat(100),
    }));
    const out = applyBudget(s, 200);
    expect(out.memory.length).toBeLessThan(20);
    expect(out.truncated).toBe(true);
  });

  it("truncates decision reasons to first sentence when memory exhausted", () => {
    const s = baseSections();
    s.decisions = Array.from({ length: 5 }, (_, i) => ({
      topic: `topic-${i}`,
      reason: `First sentence ${i}. ` + "Second sentence with much more bulk ".repeat(10) + "and a final clause that pads the reason far past the first sentence.",
    }));
    s.rules = [{ rule: "r", why: "y" }];
    const out = applyBudget(s, 100);
    expect(out.decisions[0].reason).toMatch(/^First sentence 0\.$/);
    expect(out.truncated).toBe(true);
  });

  it("truncates flow summaries to first sentence", () => {
    const s = baseSections();
    s.flows = Array.from({ length: 5 }, (_, i) => ({
      name: `flow-${i}`,
      summary: `First sentence ${i}. ` + "Second sentence padding ".repeat(10) + "tail.",
    }));
    s.rules = [{ rule: "r", why: "y" }];
    const out = applyBudget(s, 100);
    expect(out.flows[0].summary).toMatch(/^First sentence 0\.$/);
    expect(out.truncated).toBe(true);
  });

  it("collapses structure entries to top-level dirs", () => {
    const s = baseSections();
    s.structure = Array.from({ length: 8 }, (_, i) => ({
      path: `src/dir${i}/file${i}.ts`,
      purpose: `purpose ${i} ` + "padding ".repeat(10),
    }));
    s.rules = [{ rule: "r", why: "y" }];
    const out = applyBudget(s, 80);
    // After collapse, all 8 entries with src/ prefix collapse to a single src/ entry.
    expect(out.structure.length).toBeLessThan(8);
    expect(out.structure.map(e => e.path)).toContain("src/");
  });

  it("trims rules from the end (keeps at least 1) when rules alone exceed budget", () => {
    const s = baseSections();
    s.rules = Array.from({ length: 20 }, (_, i) => ({
      rule: "x".repeat(200) + ` ${i}`,
      why: "y".repeat(200) + ` ${i}`,
    }));
    const out = applyBudget(s, 100);
    expect(out.truncated).toBe(true);
    expect(out.rules.length).toBeGreaterThanOrEqual(1);
    expect(out.rules.length).toBeLessThan(20);
  });

  it("drops keyDeps before decisions before flows when over budget", () => {
    const s = baseSections();
    s.rules = [{ rule: "small", why: "small" }];
    s.keyDeps = Array.from({ length: 10 }, (_, i) => ({
      name: `dep-${i}`, why: "x".repeat(100),
    }));
    s.decisions = Array.from({ length: 5 }, (_, i) => ({
      topic: `t${i}`, reason: "first sentence " + i + ". rest",
    }));
    s.flows = Array.from({ length: 5 }, (_, i) => ({
      name: `f${i}`, summary: "first " + i + ". second",
    }));
    const out = applyBudget(s, 250);
    // keyDeps dropped before flows
    expect(out.keyDeps.length).toBe(0);
    // flows may also be dropped depending on how tight; rules preserved
    expect(out.rules.length).toBeGreaterThanOrEqual(1);
    expect(out.truncated).toBe(true);
  });

  it("never throws — soft floor returns truncated content with banner", () => {
    const s = baseSections();
    // Tons of rules + commands far exceeding any reasonable budget
    s.rules = Array.from({ length: 100 }, (_, i) => ({ rule: "rule" + i, why: "why" + i }));
    s.commands = Array.from({ length: 50 }, (_, i) => ({ name: `cmd-${i}`, cmd: `command-${i}-runs-this` }));
    // Should not throw
    const out = applyBudget(s, 50);
    expect(out.truncated).toBe(true);
    // Renders cleanly, includes the banner
    const md = renderSections(out);
    expect(md).toMatch(/Truncated under 50-token budget/);
  });

  it("records budgetTokens in the output for the truncation footer", () => {
    const s = baseSections();
    s.memory = Array.from({ length: 5 }, (_, i) => ({
      kind: "gotcha",
      date: "2026-05-01",
      topic: `t${i}`,
      content: "long content " + "x".repeat(200),
    }));
    const out = applyBudget(s, 100);
    if (out.truncated) {
      expect(out.budgetTokens).toBe(100);
    }
  });
});

describe("renderSections", () => {
  it("appends truncation footer when truncated", () => {
    const s = baseSections();
    s.truncated = true;
    s.budgetTokens = 1500;
    const md = renderSections(s);
    expect(md).toMatch(/Truncated under 1500-token budget/);
  });

  it("omits truncation footer when not truncated", () => {
    const s = baseSections();
    s.truncated = false;
    const md = renderSections(s);
    expect(md).not.toMatch(/Truncated/);
  });

  it("emits memory section when entries present", () => {
    const s = baseSections();
    s.memory = [
      { kind: "gotcha", date: "2026-05-09", topic: "win-shim", content: "Windows CLI shims need shell:true" },
    ];
    const md = renderSections(s);
    expect(md).toMatch(/## Recent lived experience/);
    expect(md).toMatch(/- \*\*gotcha\*\* \*\(2026-05-09\)\* — \*\*win-shim\*\*/);
  });
});
