import { describe, it, expect } from "vitest";
import type { RenderArtifact, RenderOptions } from "../src/render/types.js";

describe("render types", () => {
  it("RenderArtifact has path + content", () => {
    const a: RenderArtifact = { path: ".anatomy", content: "hello" };
    expect(a.path).toBe(".anatomy");
    expect(a.content).toBe("hello");
  });

  it("RenderOptions has emit toggles + budget", () => {
    const o: RenderOptions = {
      emitAnatomy: true,
      emitAgentsMd: true,
      agentsMdBudgetTokens: 1500,
      agentsMdMemoryCount: 10,
      modelId: "claude-3-5",
    };
    expect(o.emitAgentsMd).toBe(true);
    expect(o.agentsMdBudgetTokens).toBe(1500);
  });
});
