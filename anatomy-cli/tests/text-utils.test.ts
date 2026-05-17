import { describe, it, expect } from "vitest";
import { smartTruncateLine } from "../src/text-utils.js";

describe("smartTruncateLine", () => {
  it("returns string unchanged when shorter than max", () => {
    expect(smartTruncateLine("hello world", 120)).toBe("hello world");
  });

  it("collapses internal whitespace and CR/LF", () => {
    expect(smartTruncateLine("a\n\nb\t\tc", 120)).toBe("a b c");
  });

  it("trims leading/trailing whitespace", () => {
    expect(smartTruncateLine("   x   ", 120)).toBe("x");
  });

  it("prefers a sentence boundary when one lands past the half-way point", () => {
    const s = "First sentence ends here. Second sentence runs longer than the cap permits, padding padding padding padding";
    const r = smartTruncateLine(s, 60);
    expect(r).toBe("First sentence ends here.");
  });

  it("falls back to word boundary when no sentence boundary in the latter half", () => {
    const s = "abcd abcd abcd abcd abcd abcd abcd abcd abcd abcd abcd abcd";
    const r = smartTruncateLine(s, 30);
    // 30-char head ends mid-word; cuts at last space within 30.
    expect(r.length).toBeLessThanOrEqual(30);
    expect(r.endsWith(" ")).toBe(false);
    expect(r).not.toMatch(/abc$/); // not cut mid-word
  });

  it("strips trailing comma after a word-boundary cut (Clipfarmer-shape regression)", () => {
    const s = "A C# WPF desktop application that enables users to upload video clips to multiple social media platforms (YouTube, Instagram, X/Twitter, TikTok, Facebook) with scheduling functionality.";
    const r = smartTruncateLine(s, 120);
    expect(r.length).toBeLessThanOrEqual(120);
    // The pre-fix output ended with "(YouTube," — must NOT happen now.
    expect(r).not.toMatch(/[,;:.\-—(\[]$/);
  });

  it("walks back past an unclosed open paren rather than leaving '(YouTube' dangling", () => {
    const s = "A C# WPF desktop application that enables users to upload video clips to multiple social media platforms (YouTube, Instagram, X/Twitter, TikTok, Facebook) with scheduling functionality.";
    const r = smartTruncateLine(s, 120);
    // Open paren count must equal close paren count after cut.
    const opens = (r.match(/\(/g) ?? []).length;
    const closes = (r.match(/\)/g) ?? []).length;
    expect(opens).toBe(closes);
    // Should land on "...platforms" with no orphan "(YouTube".
    expect(r).not.toContain("(YouTube");
  });

  it("strips trailing open-paren when cut leaves one dangling", () => {
    const s = "lorem ipsum dolor sit amet (consectetur adipiscing elit and many many more words to overflow";
    const r = smartTruncateLine(s, 30);
    expect(r).not.toMatch(/[([{]$/);
  });

  it("never returns an empty string when the input has any content", () => {
    // Pathological case: max smaller than the first word — fallback to head.
    const r = smartTruncateLine("supercalifragilisticexpialidocious", 5);
    expect(r.length).toBeGreaterThan(0);
  });

  it("respects a small max for short fields like dependency-why (≤80)", () => {
    const s = "JSON Schema 2020-12 validator, used because ajv is the de-facto standard, and we need streaming validation for large files";
    const r = smartTruncateLine(s, 80);
    expect(r.length).toBeLessThanOrEqual(80);
    expect(r).not.toMatch(/[,;:.\-—(\[]$/);
  });
});
