import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readMemoryFile, createMemoryFile, parseMemoryDoc,
  appendEntry, patchEntryField, recordThanks, recordVerification,
  MEMORY_VERSION, VERIFIED_BY_MAX, type MemoryEntry,
} from "../src/memory/io.js";

function makeTmpRepo() {
  return mkdtempSync(join(tmpdir(), "anat-mem-"));
}

describe("readMemoryFile", () => {
  it("returns null when .anatomy-memory does not exist", () => {
    const root = makeTmpRepo();
    expect(readMemoryFile(root)).toBeNull();
  });

  it("returns text when file exists", () => {
    const root = makeTmpRepo();
    writeFileSync(join(root, ".anatomy-memory"), 'anatomy_memory_version = "0.1"\nrepo_fingerprint = "abcdefghijklmnopqrst"\n');
    expect(readMemoryFile(root)).toContain("0.1");
  });

  it("strips a leading UTF-8 BOM if present", () => {
    const root = makeTmpRepo();
    const bom = "﻿";
    writeFileSync(
      join(root, ".anatomy-memory"),
      bom + 'anatomy_memory_version = "0.1"\nrepo_fingerprint = "abcdefghijklmnopqrst"\n'
    );
    const text = readMemoryFile(root);
    expect(text).not.toBeNull();
    expect(text!.charCodeAt(0)).not.toBe(0xfeff);
    expect(text!.startsWith('anatomy_memory_version')).toBe(true);
  });

  it("throws when file exceeds the 5 MB size limit", () => {
    const root = makeTmpRepo();
    // Build a 5,000,001-byte file: header + entries until just over the cap.
    let content = 'anatomy_memory_version = "0.1"\nrepo_fingerprint = "abcdefghijklmnopqrst"\n';
    const entryBlock = '\n[[entries]]\nid = "abcdefgh"\nkind = "gotcha"\ntopic = "t"\ncontent = "' + "x".repeat(900) + '"\nat = 2026-05-08T00:00:00Z\nby = "human:t"\n';
    while (content.length < 5_000_001) content += entryBlock;
    writeFileSync(join(root, ".anatomy-memory"), content);
    expect(() => readMemoryFile(root)).toThrow(/limit is 5000000 bytes/);
  });
});

describe("parseMemoryDoc", () => {
  it("parses a memory doc and returns header + entries", () => {
    const text = `anatomy_memory_version = "0.1"
repo_fingerprint = "abcdefghijklmnopqrst"

[[entries]]
id = "aaaaaaaa"
kind = "gotcha"
topic = "x"
content = "y"
at = 2026-05-08T00:00:00Z
by = "human:test"
`;
    const doc = parseMemoryDoc(text);
    expect(doc.repo_fingerprint).toBe("abcdefghijklmnopqrst");
    expect(doc.entries).toHaveLength(1);
    expect(doc.entries[0].id).toBe("aaaaaaaa");
  });

  it("returns empty entries array when none present", () => {
    const doc = parseMemoryDoc(`anatomy_memory_version = "0.1"\nrepo_fingerprint = "abcdefghijklmnopqrst"\n`);
    expect(doc.entries).toEqual([]);
  });
});

describe("appendEntry", () => {
  it("appends an [[entries]] block to existing file", () => {
    const root = makeTmpRepo();
    writeFileSync(join(root, ".anatomy-memory"),
      `anatomy_memory_version = "0.1"\nrepo_fingerprint = "abcdefghijklmnopqrst"\n`);
    const entry: MemoryEntry = {
      id: "aaaaaaaa", kind: "gotcha", topic: "x", content: "y",
      at: "2026-05-08T00:00:00Z", by: "human:test",
    };
    appendEntry(root, entry);
    const text = readFileSync(join(root, ".anatomy-memory"), "utf8");
    expect(text).toContain("[[entries]]");
    expect(text).toContain('id = "aaaaaaaa"');
    expect(text).toContain('kind = "gotcha"');
    const doc = parseMemoryDoc(text);
    expect(doc.entries).toHaveLength(1);
  });

  it("appends a second entry without disturbing the first", () => {
    const root = makeTmpRepo();
    writeFileSync(join(root, ".anatomy-memory"),
      `anatomy_memory_version = "0.1"\nrepo_fingerprint = "abcdefghijklmnopqrst"\n`);
    appendEntry(root, { id: "aaaaaaaa", kind: "gotcha", topic: "a", content: "a",
      at: "2026-05-08T00:00:00Z", by: "human:test" });
    appendEntry(root, { id: "bbbbbbbb", kind: "gotcha", topic: "b", content: "b",
      at: "2026-05-08T00:00:01Z", by: "human:test" });
    const doc = parseMemoryDoc(readFileSync(join(root, ".anatomy-memory"), "utf8"));
    expect(doc.entries.map(e => e.id)).toEqual(["aaaaaaaa", "bbbbbbbb"]);
  });

  it("preserves optional fields", () => {
    const root = makeTmpRepo();
    writeFileSync(join(root, ".anatomy-memory"),
      `anatomy_memory_version = "0.1"\nrepo_fingerprint = "abcdefghijklmnopqrst"\n`);
    appendEntry(root, {
      id: "aaaaaaaa", kind: "convention", topic: "t", content: "c",
      at: "2026-05-08T00:00:00Z", by: "human:test",
      refs: ["src/foo.ts", "git:abc1234"], tags: ["a", "b"],
    });
    const doc = parseMemoryDoc(readFileSync(join(root, ".anatomy-memory"), "utf8"));
    expect(doc.entries[0].refs).toEqual(["src/foo.ts", "git:abc1234"]);
    expect(doc.entries[0].tags).toEqual(["a", "b"]);
  });
});

describe("patchEntryField", () => {
  function setup(entries: MemoryEntry[]): string {
    const root = makeTmpRepo();
    writeFileSync(join(root, ".anatomy-memory"),
      `anatomy_memory_version = "0.1"\nrepo_fingerprint = "abcdefghijklmnopqrst"\n`);
    for (const e of entries) appendEntry(root, e);
    return root;
  }

  it("sets superseded_by on an existing entry", () => {
    const root = setup([
      { id: "aaaaaaaa", kind: "gotcha", topic: "a", content: "a",
        at: "2026-05-08T00:00:00Z", by: "human:test" }
    ]);
    patchEntryField(root, "aaaaaaaa", "superseded_by", "bbbbbbbb");
    const doc = parseMemoryDoc(readFileSync(join(root, ".anatomy-memory"), "utf8"));
    expect(doc.entries[0].superseded_by).toBe("bbbbbbbb");
  });

  it("sets deprecated_at and deprecated_reason on an existing entry", () => {
    const root = setup([
      { id: "aaaaaaaa", kind: "gotcha", topic: "a", content: "a",
        at: "2026-05-08T00:00:00Z", by: "human:test" }
    ]);
    patchEntryField(root, "aaaaaaaa", "deprecated_at", "2026-05-09T00:00:00Z");
    patchEntryField(root, "aaaaaaaa", "deprecated_reason", "no longer relevant");
    const doc = parseMemoryDoc(readFileSync(join(root, ".anatomy-memory"), "utf8"));
    expect(doc.entries[0].deprecated_at).toBe("2026-05-09T00:00:00Z");
    expect(doc.entries[0].deprecated_reason).toBe("no longer relevant");
  });

  it("throws when id does not exist", () => {
    const root = setup([]);
    expect(() => patchEntryField(root, "zzzzzzzz", "superseded_by", "aaaaaaaa")).toThrow();
  });

  it("preserves other entries unchanged when patching one", () => {
    const root = setup([
      { id: "aaaaaaaa", kind: "gotcha", topic: "a", content: "a",
        at: "2026-05-08T00:00:00Z", by: "human:test" },
      { id: "bbbbbbbb", kind: "gotcha", topic: "b", content: "b",
        at: "2026-05-08T00:00:01Z", by: "human:test" }
    ]);
    patchEntryField(root, "aaaaaaaa", "superseded_by", "bbbbbbbb");
    const doc = parseMemoryDoc(readFileSync(join(root, ".anatomy-memory"), "utf8"));
    expect(doc.entries[0].superseded_by).toBe("bbbbbbbb");
    expect(doc.entries[1].superseded_by).toBeUndefined();
    expect(doc.entries[1].id).toBe("bbbbbbbb");
  });

  it("does not match a different entry when id contains regex metachars", () => {
    // Schema constrains valid ids to [a-z0-9]{8}, but patchEntryField is called
    // by code paths that don't all re-validate. An id like "aaaaaaa." (with a
    // regex wildcard) must not silently patch entry "aaaaaaa1" via metachar
    // expansion.
    const root = setup([
      { id: "aaaaaaa1", kind: "gotcha", topic: "a", content: "a",
        at: "2026-05-08T00:00:00Z", by: "human:test" },
    ]);
    expect(() =>
      patchEntryField(root, "aaaaaaa.", "superseded_by", "bbbbbbbb")
    ).toThrow(/no entry/);
    const doc = parseMemoryDoc(readFileSync(join(root, ".anatomy-memory"), "utf8"));
    expect(doc.entries[0].superseded_by).toBeUndefined();
  });

  it("round-trips entries whose `at` was a bare TOML datetime literal", () => {
    // Hand-edited or older-tool files may use bare TOML datetime syntax
    // (no quotes). After patching, the file must still parse and the patch
    // must be applied.
    const root = makeTmpRepo();
    writeFileSync(join(root, ".anatomy-memory"),
      `anatomy_memory_version = "0.1"\n` +
      `repo_fingerprint = "abcdefghijklmnopqrst"\n\n` +
      `[[entries]]\n` +
      `id = "aaaaaaaa"\n` +
      `kind = "gotcha"\n` +
      `topic = "a"\n` +
      `content = "a"\n` +
      `at = 2026-05-08T00:00:00Z\n` +
      `by = "human:test"\n`);
    patchEntryField(root, "aaaaaaaa", "superseded_by", "bbbbbbbb");
    const doc = parseMemoryDoc(readFileSync(join(root, ".anatomy-memory"), "utf8"));
    expect(doc.entries[0].superseded_by).toBe("bbbbbbbb");
    expect(doc.entries[0].id).toBe("aaaaaaaa");
  });
});

describe("recordThanks", () => {
  function setup(entries: MemoryEntry[]): string {
    const root = makeTmpRepo();
    writeFileSync(join(root, ".anatomy-memory"),
      `anatomy_memory_version = "0.1"\nrepo_fingerprint = "abcdefghijklmnopqrst"\n`);
    for (const e of entries) appendEntry(root, e);
    return root;
  }

  it("records helped_by and helped_count on a fresh entry", () => {
    const root = setup([
      { id: "aaaaaaaa", kind: "gotcha", topic: "a", content: "a",
        at: "2026-05-08T00:00:00Z", by: "human:test" },
    ]);
    const r = recordThanks(root, "aaaaaaaa", "human:alice");
    expect(r).toEqual({ ok: true, alreadyThanked: false, helpedCount: 1 });
    const doc = parseMemoryDoc(readFileSync(join(root, ".anatomy-memory"), "utf8"));
    expect(doc.entries[0].helped_by).toEqual(["human:alice"]);
    expect(doc.entries[0].helped_count).toBe(1);
  });

  it("is idempotent for the same thanker", () => {
    const root = setup([
      { id: "aaaaaaaa", kind: "gotcha", topic: "a", content: "a",
        at: "2026-05-08T00:00:00Z", by: "human:test" },
    ]);
    recordThanks(root, "aaaaaaaa", "human:alice");
    const r = recordThanks(root, "aaaaaaaa", "human:alice");
    expect(r).toEqual({ ok: true, alreadyThanked: true, helpedCount: 1 });
  });

  it("does not match a different entry when id contains regex metachars", () => {
    const root = setup([
      { id: "aaaaaaa1", kind: "gotcha", topic: "a", content: "a",
        at: "2026-05-08T00:00:00Z", by: "human:test" },
    ]);
    const r = recordThanks(root, "aaaaaaa.", "human:alice");
    expect(r).toEqual({ ok: false, reason: "no-entry" });
    const doc = parseMemoryDoc(readFileSync(join(root, ".anatomy-memory"), "utf8"));
    expect(doc.entries[0].helped_by).toBeUndefined();
  });

  it("survives multi-line helped_by syntax", () => {
    // A file may have been hand-edited or written by a tool that prefers
    // multi-line array syntax. recordThanks should still find and update it.
    const root = makeTmpRepo();
    writeFileSync(join(root, ".anatomy-memory"),
      `anatomy_memory_version = "0.1"\n` +
      `repo_fingerprint = "abcdefghijklmnopqrst"\n\n` +
      `[[entries]]\n` +
      `id = "aaaaaaaa"\n` +
      `kind = "gotcha"\n` +
      `topic = "a"\n` +
      `content = "a"\n` +
      `at = "2026-05-08T00:00:00Z"\n` +
      `by = "human:test"\n` +
      `helped_count = 1\n` +
      `helped_by = [\n  "human:alice",\n]\n`);
    const r = recordThanks(root, "aaaaaaaa", "human:bob");
    expect(r.ok).toBe(true);
    const doc = parseMemoryDoc(readFileSync(join(root, ".anatomy-memory"), "utf8"));
    expect(doc.entries[0].helped_by).toEqual(["human:alice", "human:bob"]);
    expect(doc.entries[0].helped_count).toBe(2);
  });
});

describe("recordVerification (v0.2)", () => {
  function setup(entries: MemoryEntry[]): string {
    const root = makeTmpRepo();
    let content = `anatomy_memory_version = "0.1"\nrepo_fingerprint = "abcdefghijklmnopqrst"\n`;
    for (const e of entries) {
      content += `\n[[entries]]\nid = "${e.id}"\nkind = "${e.kind}"\ntopic = "${e.topic}"\ncontent = "${e.content}"\nat = "${e.at}"\nby = "${e.by}"\n`;
    }
    writeFileSync(join(root, ".anatomy-memory"), content);
    return root;
  }

  it("returns no-memory when file absent", () => {
    const root = makeTmpRepo();
    expect(recordVerification(root, "aaaaaaaa", "human:test")).toEqual({ ok: false, reason: "no-memory" });
  });

  it("returns no-entry when id missing", () => {
    const root = setup([
      { id: "aaaaaaaa", kind: "gotcha", topic: "a", content: "a", at: "2026-05-08T00:00:00Z", by: "human:test" },
    ]);
    expect(recordVerification(root, "abc12345", "human:test")).toEqual({ ok: false, reason: "no-entry" });
  });

  it("happy path: bumps file version to 0.2 and adds last_verified_at + verified_by", () => {
    const root = setup([
      { id: "aaaaaaaa", kind: "gotcha", topic: "a", content: "a", at: "2026-05-08T00:00:00Z", by: "human:test" },
    ]);
    const r = recordVerification(root, "aaaaaaaa", "human:alice");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.bumpedVersion).toBe(true);
      expect(r.verifiedBy).toEqual(["human:alice"]);
      expect(r.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
    const doc = parseMemoryDoc(readFileSync(join(root, ".anatomy-memory"), "utf8"));
    expect(doc.anatomy_memory_version).toBe(MEMORY_VERSION);
    expect(doc.entries[0].last_verified_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(doc.entries[0].verified_by).toEqual(["human:alice"]);
  });

  it("idempotent on same identity: re-verify dedupes + moves to head", () => {
    const root = setup([
      { id: "aaaaaaaa", kind: "gotcha", topic: "a", content: "a", at: "2026-05-08T00:00:00Z", by: "human:test" },
    ]);
    recordVerification(root, "aaaaaaaa", "human:alice");
    recordVerification(root, "aaaaaaaa", "human:bob");
    const r = recordVerification(root, "aaaaaaaa", "human:alice");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.verifiedBy).toEqual(["human:alice", "human:bob"]);
    const doc = parseMemoryDoc(readFileSync(join(root, ".anatomy-memory"), "utf8"));
    // Order: most-recently-verified first (LRU at head).
    expect(doc.entries[0].verified_by).toEqual(["human:alice", "human:bob"]);
  });

  it("LRU truncates verified_by at VERIFIED_BY_MAX (oldest dropped)", () => {
    const root = setup([
      { id: "aaaaaaaa", kind: "gotcha", topic: "a", content: "a", at: "2026-05-08T00:00:00Z", by: "human:test" },
    ]);
    // Verify with 6 distinct identities (max is 5).
    for (let i = 0; i < VERIFIED_BY_MAX + 1; i++) {
      recordVerification(root, "aaaaaaaa", `human:user${i}`);
    }
    const doc = parseMemoryDoc(readFileSync(join(root, ".anatomy-memory"), "utf8"));
    const verified = doc.entries[0].verified_by ?? [];
    expect(verified).toHaveLength(VERIFIED_BY_MAX);
    // Most recent at head, oldest dropped.
    expect(verified[0]).toBe(`human:user${VERIFIED_BY_MAX}`);
    expect(verified).not.toContain("human:user0");
  });

  it("does not re-bump version on already-v0.2 files", () => {
    const root = setup([
      { id: "aaaaaaaa", kind: "gotcha", topic: "a", content: "a", at: "2026-05-08T00:00:00Z", by: "human:test" },
    ]);
    const first = recordVerification(root, "aaaaaaaa", "human:alice");
    if (first.ok) expect(first.bumpedVersion).toBe(true);
    const second = recordVerification(root, "aaaaaaaa", "human:bob");
    if (second.ok) expect(second.bumpedVersion).toBe(false);
  });
});
