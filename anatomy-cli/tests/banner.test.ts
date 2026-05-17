import { describe, it, expect } from "vitest";
import { hasRegenBanner } from "../src/banner.js";

describe("hasRegenBanner", () => {
  it("detects banner on the first line (baseline)", () => {
    const content = "> **Regenerated from `.anatomy` at commit `abc1234` by `anatomy-cli`.**\n\nbody";
    expect(hasRegenBanner(content)).toBe(true);
  });

  it("detects banner after up to 4 lines of preamble (e.g., Cursor MDC frontmatter)", () => {
    const content = `---
description: "Test"
alwaysApply: true
---

> **Regenerated from \`.anatomy\` at commit \`abc1234\` by \`anatomy-cli\`.**
> DO NOT EDIT.
`;
    expect(hasRegenBanner(content)).toBe(true);
  });

  it("returns false when no banner is present", () => {
    const content = "# Just some markdown\n\nNo banner here.";
    expect(hasRegenBanner(content)).toBe(false);
  });
});
