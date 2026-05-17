import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { detectBy } from "../src/memory/attribution.js";

describe("detectBy", () => {
  const origEnv = { ...process.env };
  beforeEach(() => { process.env = { ...origEnv }; });
  afterEach(() => { process.env = origEnv; });

  it("uses ANATOMY_BY when set", () => {
    process.env.ANATOMY_BY = "human:override";
    expect(detectBy()).toBe("human:override");
  });

  it("uses claude-session when CLAUDECODE is set", () => {
    delete process.env.ANATOMY_BY;
    process.env.CLAUDECODE = "1";
    expect(detectBy()).toBe("claude-session");
  });

  it("falls back to unknown when nothing is detected and git is unavailable", () => {
    delete process.env.ANATOMY_BY;
    delete process.env.CLAUDECODE;
    // Simulate no git: pass a non-existent cwd
    expect(detectBy("/this/path/does/not/exist")).toBe("unknown");
  });
});
