import { describe, it, expect } from "vitest";

describe("package scaffold", () => {
  it("vitest runs", () => {
    expect(1 + 1).toBe(2);
  });

  it("can import @anatomy/validate from this package", async () => {
    const mod = await import("@anatomy/validate");
    expect(typeof mod.validate).toBe("function");
    expect(typeof mod.ECOSYSTEM_VERSION).toBe("string");
  });
});
