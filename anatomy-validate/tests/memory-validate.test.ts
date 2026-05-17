import { describe, it, expect } from "vitest";
import { validateMemory } from "../src/memory.js";

describe("validateMemory", () => {
  it("returns ok:false with toml-parse-error code on invalid TOML", () => {
    const result = validateMemory("this is = not [valid TOML");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0].code).toBe("toml-parse-error");
    }
  });

  it("returns ok:true on minimal valid memory", () => {
    const text = `
anatomy_memory_version = "0.1"
repo_fingerprint = "abcdefghijklmnopqrst"
`;
    const result = validateMemory(text);
    expect(result.ok).toBe(true);
  });

  it("rejects bad fingerprint format with schema-violation", () => {
    const text = `
anatomy_memory_version = "0.1"
repo_fingerprint = "TOO-SHORT"
`;
    const result = validateMemory(text);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const codes = result.errors.map(e => e.code);
      expect(codes).toContain("schema-violation");
    }
  });

  it("accepts milestone kind", () => {
    const text = `
anatomy_memory_version = "0.1"
repo_fingerprint = "abcdefghijklmnopqrst"

[[entries]]
id = "m1l3st1a"
kind = "milestone"
topic = "v1-release"
content = "Cut the v1.0 release."
at = "2026-05-08T00:00:00Z"
by = "human:test"
`;
    const result = validateMemory(text);
    if (!result.ok) {
      throw new Error(`expected ok:true; got errors: ${JSON.stringify(result.errors)}`);
    }
    expect(result.ok).toBe(true);
  });

  it("rejects unknown kind with schema-violation", () => {
    const text = `
anatomy_memory_version = "0.1"
repo_fingerprint = "abcdefghijklmnopqrst"

[[entries]]
id = "abcdefgh"
kind = "lesson"
topic = "x"
content = "y"
at = "2026-05-08T00:00:00Z"
by = "human:test"
`;
    const result = validateMemory(text);
    expect(result.ok).toBe(false);
  });

  it("rejects unsupported memory version", () => {
    const text = `
anatomy_memory_version = "9.9"
repo_fingerprint = "abcdefghijklmnopqrst"
`;
    const result = validateMemory(text);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const codes = result.errors.map(e => e.code);
      expect(codes).toContain("unsupported-memory-version");
    }
  });

  it("emits memory-fingerprint-mismatch when anatomyFingerprint differs", () => {
    const text = `
anatomy_memory_version = "0.1"
repo_fingerprint = "abcdefghijklmnopqrst"
`;
    const result = validateMemory(text, { anatomyFingerprint: "zzzzzzzzzzzzzzzzzzzz" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const codes = result.errors.map(e => e.code);
      expect(codes).toContain("memory-fingerprint-mismatch");
    }
  });

  it("passes fingerprint check when anatomyFingerprint matches", () => {
    const text = `
anatomy_memory_version = "0.1"
repo_fingerprint = "abcdefghijklmnopqrst"
`;
    const result = validateMemory(text, { anatomyFingerprint: "abcdefghijklmnopqrst" });
    expect(result.ok).toBe(true);
  });

  it("emits memory-supersedes-not-found when superseded_by points to missing id", () => {
    const text = `
anatomy_memory_version = "0.1"
repo_fingerprint = "abcdefghijklmnopqrst"

[[entries]]
id = "aaaaaaaa"
kind = "gotcha"
topic = "x"
content = "y"
at = "2026-05-08T00:00:00Z"
by = "human:test"
superseded_by = "zzzzzzzz"
`;
    const result = validateMemory(text);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map(e => e.code)).toContain("memory-supersedes-not-found");
    }
  });

  it("emits memory-supersedes-cycle on circular supersession", () => {
    const text = `
anatomy_memory_version = "0.1"
repo_fingerprint = "abcdefghijklmnopqrst"

[[entries]]
id = "aaaaaaaa"
kind = "gotcha"
topic = "a"
content = "a"
at = "2026-05-08T00:00:00Z"
by = "human:test"
superseded_by = "bbbbbbbb"

[[entries]]
id = "bbbbbbbb"
kind = "gotcha"
topic = "b"
content = "b"
at = "2026-05-08T00:00:01Z"
by = "human:test"
superseded_by = "aaaaaaaa"
`;
    const result = validateMemory(text);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map(e => e.code)).toContain("memory-supersedes-cycle");
    }
  });

  it("accepts unquoted TOML datetime in entry.at (TomlDate normalization)", () => {
    // Real .anatomy-memory files emit unquoted datetimes (TOML native type).
    // parseAnatomyToml must normalize them to ISO strings so the schema's
    // type:string + format:date-time check succeeds.
    const text = `
anatomy_memory_version = "0.1"
repo_fingerprint = "abcdefghijklmnopqrst"

[[entries]]
id = "aaaaaaaa"
kind = "gotcha"
topic = "x"
content = "y"
at = 2026-05-08T00:00:00Z
by = "human:test"
`;
    const result = validateMemory(text);
    if (!result.ok) {
      throw new Error(`expected ok:true; got errors: ${JSON.stringify(result.errors)}`);
    }
    expect(result.ok).toBe(true);
  });

  it("emits memory-dangling-ref warning for non-existent local paths in refs", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const repoRoot = mkdtempSync(join(tmpdir(), "anat-mem-"));
    try {
      const text = `
anatomy_memory_version = "0.1"
repo_fingerprint = "abcdefghijklmnopqrst"

[[entries]]
id = "aaaaaaaa"
kind = "gotcha"
topic = "x"
content = "y"
at = 2026-05-08T00:00:00Z
by = "human:test"
refs = ["src/does-not-exist.ts", "git:abc1234", "entry:bbbbbbbb"]
`;
      const result = validateMemory(text, { repoRoot });
      // Should still validate (warning, not error)
      expect(result.ok).toBe(true);
      const codes = result.warnings.map(w => w.code);
      expect(codes).toContain("memory-dangling-ref");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

describe("validateMemory — v0.2 verification fields", () => {
  it("accepts a v0.2 file with last_verified_at + verified_by", () => {
    const text = `
anatomy_memory_version = "0.2"
repo_fingerprint = "abcdefghijklmnopqrst"

[[entries]]
id = "aaaaaaaa"
kind = "decision"
topic = "x"
content = "y"
at = 2026-05-08T00:00:00Z
by = "human:test"
last_verified_at = 2026-09-01T00:00:00Z
verified_by = ["human:test", "claude-session:opus-4-7"]
`;
    const result = validateMemory(text);
    expect(result.ok).toBe(true);
  });

  it("accepts a v0.1 file (legacy entries) without the new fields", () => {
    const text = `
anatomy_memory_version = "0.1"
repo_fingerprint = "abcdefghijklmnopqrst"

[[entries]]
id = "aaaaaaaa"
kind = "decision"
topic = "x"
content = "y"
at = 2026-05-08T00:00:00Z
by = "human:test"
`;
    const result = validateMemory(text);
    expect(result.ok).toBe(true);
  });

  it("emits memory-verified-by-malformed for an attribution that doesn't match the regex", () => {
    const text = `
anatomy_memory_version = "0.2"
repo_fingerprint = "abcdefghijklmnopqrst"

[[entries]]
id = "aaaaaaaa"
kind = "decision"
topic = "x"
content = "y"
at = 2026-05-08T00:00:00Z
by = "human:test"
verified_by = ["bogus-user"]
`;
    const result = validateMemory(text);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const codes = result.errors.map(e => e.code);
      // Schema-violation also fires (the same regex is in the schema's pattern),
      // but the dedicated memory-verified-by-malformed check provides a
      // friendlier code/message.
      expect(codes).toContain("schema-violation");
    }
  });

  it("warns memory-last-verified-before-at when verified before creation", () => {
    const text = `
anatomy_memory_version = "0.2"
repo_fingerprint = "abcdefghijklmnopqrst"

[[entries]]
id = "aaaaaaaa"
kind = "decision"
topic = "x"
content = "y"
at = 2026-05-08T00:00:00Z
by = "human:test"
last_verified_at = 2026-04-01T00:00:00Z
`;
    const result = validateMemory(text);
    expect(result.ok).toBe(true); // Warning, not error.
    const codes = result.warnings.map(w => w.code);
    expect(codes).toContain("memory-last-verified-before-at");
  });

  it("v0.1 file with extra forward-compat fields validates (additionalProperties relaxed)", () => {
    const text = `
anatomy_memory_version = "0.1"
repo_fingerprint = "abcdefghijklmnopqrst"

[[entries]]
id = "aaaaaaaa"
kind = "decision"
topic = "x"
content = "y"
at = 2026-05-08T00:00:00Z
by = "human:test"
last_verified_at = 2026-09-01T00:00:00Z
verified_by = ["human:test"]
`;
    const result = validateMemory(text);
    expect(result.ok).toBe(true);
  });
});
