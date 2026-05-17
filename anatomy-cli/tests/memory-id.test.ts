import { describe, it, expect } from "vitest";
import { makeEntryId } from "../src/memory/id.js";

describe("makeEntryId", () => {
  it("returns 8 chars matching ^[a-z0-9]{8}$", () => {
    const id = makeEntryId("2026-05-08T00:00:00Z", "some content");
    expect(id).toMatch(/^[a-z0-9]{8}$/);
  });

  it("is deterministic for the same input", () => {
    const id1 = makeEntryId("2026-05-08T00:00:00Z", "x");
    const id2 = makeEntryId("2026-05-08T00:00:00Z", "x");
    expect(id1).toBe(id2);
  });

  it("differs for different content", () => {
    const id1 = makeEntryId("2026-05-08T00:00:00Z", "x");
    const id2 = makeEntryId("2026-05-08T00:00:00Z", "y");
    expect(id1).not.toBe(id2);
  });

  it("uses Crockford base32 alphabet (no i, l, o, u)", () => {
    for (let i = 0; i < 50; i++) {
      const id = makeEntryId(`2026-05-08T00:00:0${i % 10}.${i}Z`, `content-${i}`);
      expect(id).not.toMatch(/[ilou]/);
    }
  });
});
