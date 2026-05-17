import { describe, it, expect } from "vitest";

describe("package scaffold", () => {
  it("vitest runs", () => {
    expect(1 + 1).toBe(2);
  });

  it("can import @anatomytool/validate from this package", async () => {
    const mod = await import("@anatomytool/validate");
    expect(typeof mod.validate).toBe("function");
    expect(typeof mod.ECOSYSTEM_VERSION).toBe("string");
  });
});
