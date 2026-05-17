import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const BIN = resolve(import.meta.dirname, "../dist/bin.js");

function run(args: string[], cwd: string): { stdout: string; stderr: string; code: number } {
  const result = spawnSync("node", [BIN, ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    code: result.status ?? 1,
  };
}

const CORRECT_ANATOMY = `\
anatomy_version = "0.2"
tagline = "A minimal test repo."
description = "A minimal test repo. Used for rehash testing only."

[identity]
fingerprint = "a8fybpg4nh2b5vpw498v"

[identity.stack]
id = "rust"
hash = "a8fyb"

[identity.form]
id = "cli-tool"
hash = "pg4nh"

[identity.domain]
id = "web-publishing"
hash = "2b5vp"

[identity.function]
id = "markdown-to-static-html"
hash = "w498v"

[generated]
at = 2026-05-05T14:22:00.000Z
by = "anatomy-cli@0.3.2"
model = "claude-sonnet-4-6"
schema = "https://anatomy.dev/spec/0.2/schema.json"
`;

const STALE_DOMAIN = `\
anatomy_version = "0.2"
tagline = "A minimal test repo."
description = "A minimal test repo. Used for rehash testing only."

[identity]
fingerprint = "a8fybpg4nh00000w498v"

[identity.stack]
id = "rust"
hash = "a8fyb"

[identity.form]
id = "cli-tool"
hash = "pg4nh"

[identity.domain]
id = "web-publishing"
hash = "00000"

[identity.function]
id = "markdown-to-static-html"
hash = "w498v"

[generated]
at = 2026-05-05T14:22:00.000Z
by = "anatomy-cli@0.3.2"
model = "claude-sonnet-4-6"
schema = "https://anatomy.dev/spec/0.2/schema.json"
`;

// ---------------------------------------------------------------------------
// Integration tests — anatomy rehash command (requires dist/bin.js)
// These will fail until T6 wires the rehash command into bin.ts — expected.
// ---------------------------------------------------------------------------

describe("rehash command", () => {
  it("exit 1 when file does not exist", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-rh-"));
    const r = run(["rehash"], root);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(".anatomy not found");
  });

  it("'already correct' when hashes are correct", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-rh-"));
    writeFileSync(join(root, ".anatomy"), CORRECT_ANATOMY);
    const r = run(["rehash"], root);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("already correct");
  });

  it("corrects stale domain hash and fingerprint", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-rh-"));
    const filePath = join(root, ".anatomy");
    writeFileSync(filePath, STALE_DOMAIN);
    const r = run(["rehash"], root);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("identity.domain.hash");
    expect(r.stdout).toContain("00000 → 2b5vp");
    expect(r.stdout).toContain("identity.fingerprint");
    const updated = readFileSync(filePath, "utf8");
    expect(updated).toContain("2b5vp");
    expect(updated).toContain("a8fybpg4nh2b5vpw498v");
  });

  it("exit 1 when ID is not in canonical form", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-rh-"));
    const content = CORRECT_ANATOMY.replace('id = "rust"', 'id = "My Rust Stack"');
    writeFileSync(join(root, ".anatomy"), content);
    const r = run(["rehash"], root);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("not canonical");
    expect(r.stderr).toContain("identity.stack.id");
  });

  it("exit 1 when [identity] section is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-rh-"));
    writeFileSync(join(root, ".anatomy"), 'anatomy_version = "0.2"\ntagline = "x"\n');
    const r = run(["rehash"], root);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("[identity] section missing");
  });

  it("explicit path argument", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-rh-"));
    const filePath = join(root, "sub.anatomy");
    writeFileSync(filePath, STALE_DOMAIN);
    const r = run(["rehash", filePath], root);
    expect(r.code).toBe(0);
    const updated = readFileSync(filePath, "utf8");
    expect(updated).toContain("2b5vp");
    expect(updated).toContain("a8fybpg4nh2b5vpw498v");
  });

  it("does not modify [generated] section", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-rh-"));
    writeFileSync(join(root, ".anatomy"), STALE_DOMAIN);
    const r = run(["rehash"], root);
    expect(r.code).toBe(0);
    const updated = readFileSync(join(root, ".anatomy"), "utf8");
    expect(updated).toContain("claude-sonnet-4-6");
  });

  it("reports exact field count", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-rh-"));
    writeFileSync(join(root, ".anatomy"), STALE_DOMAIN);
    const r = run(["rehash"], root);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("2 field(s) updated");
  });
});

const V07_STALE = `\
anatomy_version = "0.7"
tagline = "minimal v0.7 test"

[identity]
stack = "rust"
form = "cli-tool"
domain = "web-publishing"
function = "markdown-to-static-html"
fingerprint = "00000000000000000000"

[[rules]]
rule = "rule one comes before rule two"
why = "ordering matters"

[[rules]]
rule = "rule two comes after rule one"

[[flows]]
name = "build"
summary = "compile then link"

[[decisions]]
topic = "section order"
reason = "must be preserved by rehash for human readability"

[generated]
at = 2026-05-08T00:00:00.000Z
by = "anatomy-cli@0.7.0"
model = "none"
schema = "https://anatomy.dev/spec/0.7/schema.json"
`;

describe("rehash command (v0.7)", () => {
  it("corrects stale fingerprint and preserves the rest of the file byte-for-byte", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-rh-v07-"));
    const filePath = join(root, ".anatomy");
    writeFileSync(filePath, V07_STALE);
    const r = run(["rehash"], root);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("identity.fingerprint");
    const updated = readFileSync(filePath, "utf8");
    // Fingerprint replaced with a real 20-char Crockford-base32 value
    expect(updated).toMatch(/^fingerprint = "[a-z0-9]{20}"$/m);
    expect(updated).not.toContain("00000000000000000000");
    // Rest of the file is byte-identical (proves no reordering, no reformatting)
    const before = V07_STALE.replace(/fingerprint = "[a-z0-9]{20}"/, "<<FP>>");
    const after = updated.replace(/fingerprint = "[a-z0-9]{20}"/, "<<FP>>");
    expect(after).toBe(before);
  });

  it("reports already correct when fingerprint matches", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-rh-v07-"));
    const filePath = join(root, ".anatomy");
    writeFileSync(filePath, V07_STALE);
    // First run corrects it
    run(["rehash"], root);
    const correctedContent = readFileSync(filePath, "utf8");
    // Second run should be a no-op
    const r = run(["rehash"], root);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("already correct");
    expect(readFileSync(filePath, "utf8")).toBe(correctedContent);
  });

  it("preserves [[rules]]/[[flows]]/[[decisions]] section ordering", () => {
    // Smoke test for the regression that smol-toml.stringify would cause.
    const root = mkdtempSync(join(tmpdir(), "anat-rh-v07-"));
    const filePath = join(root, ".anatomy");
    writeFileSync(filePath, V07_STALE);
    run(["rehash"], root);
    const updated = readFileSync(filePath, "utf8");
    // Verify section order is unchanged: rules → flows → decisions → generated
    const idxRules = updated.indexOf("[[rules]]");
    const idxFlows = updated.indexOf("[[flows]]");
    const idxDecisions = updated.indexOf("[[decisions]]");
    const idxGenerated = updated.indexOf("[generated]");
    expect(idxRules).toBeGreaterThan(-1);
    expect(idxFlows).toBeGreaterThan(idxRules);
    expect(idxDecisions).toBeGreaterThan(idxFlows);
    expect(idxGenerated).toBeGreaterThan(idxDecisions);
  });
});

const STALE_MEMORY = `\
anatomy_memory_version = "0.1"
repo_fingerprint = "00000000000000000000"

[[entries]]
id = "abc12345"
kind = "decision"
topic = "test-decision"
content = "preserve me through rehash --update-memory"
at = "2026-05-08T00:00:00.000Z"
by = "human:test"
`;

describe("rehash --update-memory", () => {
  it("updates .anatomy-memory repo_fingerprint to match the new .anatomy fingerprint", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-rh-mem-"));
    const anatomyPath = join(root, ".anatomy");
    const memoryPath = join(root, ".anatomy-memory");
    writeFileSync(anatomyPath, V07_STALE);
    writeFileSync(memoryPath, STALE_MEMORY);
    const r = run(["rehash", "--update-memory"], root);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("updated repo_fingerprint");
    const updatedAnatomy = readFileSync(anatomyPath, "utf8");
    const updatedMemory = readFileSync(memoryPath, "utf8");
    const fpMatch = updatedAnatomy.match(/^fingerprint = "([a-z0-9]{20})"$/m);
    expect(fpMatch).not.toBeNull();
    const newFp = fpMatch![1];
    expect(updatedMemory).toContain(`repo_fingerprint = "${newFp}"`);
    expect(updatedMemory).not.toContain("00000000000000000000");
    // Entries are preserved
    expect(updatedMemory).toContain('id = "abc12345"');
    expect(updatedMemory).toContain("preserve me through rehash --update-memory");
  });

  it("logs a no-op when .anatomy-memory does not exist", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-rh-mem-"));
    const anatomyPath = join(root, ".anatomy");
    writeFileSync(anatomyPath, V07_STALE);
    const r = run(["rehash", "--update-memory"], root);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("no .anatomy-memory found");
  });

  it("logs already-matches when memory fingerprint is already correct", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-rh-mem-"));
    const anatomyPath = join(root, ".anatomy");
    const memoryPath = join(root, ".anatomy-memory");
    writeFileSync(anatomyPath, V07_STALE);
    writeFileSync(memoryPath, STALE_MEMORY);
    // First run: corrects both files
    run(["rehash", "--update-memory"], root);
    // Second run: both already correct
    const r = run(["rehash", "--update-memory"], root);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("already correct");
    expect(r.stdout).toContain("already matches");
  });

  it("does not touch .anatomy-memory without --update-memory", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-rh-mem-"));
    const anatomyPath = join(root, ".anatomy");
    const memoryPath = join(root, ".anatomy-memory");
    writeFileSync(anatomyPath, V07_STALE);
    writeFileSync(memoryPath, STALE_MEMORY);
    run(["rehash"], root);
    const updatedMemory = readFileSync(memoryPath, "utf8");
    expect(updatedMemory).toContain('repo_fingerprint = "00000000000000000000"');
  });

  it("refuses to replace memory if a multi-line entry content contains a fingerprint-shaped line", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-rh-mem-"));
    const anatomyPath = join(root, ".anatomy");
    const memoryPath = join(root, ".anatomy-memory");
    const ambiguousMemory = `\
anatomy_memory_version = "0.1"
repo_fingerprint = "00000000000000000000"

[[entries]]
id = "abc12345"
kind = "decision"
topic = "embedded-fingerprint"
content = """
this entry quotes a fingerprint-shaped line on its own:
repo_fingerprint = "abcdefghjkmnpqrstvwx"
which the regex would otherwise false-positive on.
"""
at = "2026-05-08T00:00:00.000Z"
by = "human:test"
`;
    writeFileSync(anatomyPath, V07_STALE);
    writeFileSync(memoryPath, ambiguousMemory);
    const r = run(["rehash", "--update-memory"], root);
    // .anatomy still gets rehashed correctly
    expect(r.code).toBe(0);
    expect(r.stderr).toContain("refusing to replace");
    expect(r.stderr).toContain("2 repo_fingerprint-shaped lines");
    // Memory file untouched
    expect(readFileSync(memoryPath, "utf8")).toBe(ambiguousMemory);
  });

  it("refuses to replace .anatomy fingerprint if a string field contains a fingerprint-shaped line", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-rh-mem-"));
    const anatomyPath = join(root, ".anatomy");
    // Construct a v0.7 doc where a rule's multi-line basic string contains
    // a literal `fingerprint = "..."` line. The rehash regex would match
    // both lines; the count-guard should refuse.
    const ambiguousAnatomy = `\
anatomy_version = "0.7"
tagline = "ambiguous fixture"

[identity]
stack = "rust"
form = "cli-tool"
domain = "web-publishing"
function = "markdown-to-static-html"
fingerprint = "00000000000000000000"

[[rules]]
rule = """
do not store this:
fingerprint = "abcdefghjkmnpqrstvwx"
in any rule field.
"""

[generated]
at = 2026-05-08T00:00:00.000Z
by = "anatomy-cli@0.7.0"
model = "none"
schema = "https://anatomy.dev/spec/0.7/schema.json"
`;
    writeFileSync(anatomyPath, ambiguousAnatomy);
    const r = run(["rehash"], root);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("refusing to replace");
    expect(r.stderr).toContain("2 fingerprint-shaped lines");
    // File untouched
    expect(readFileSync(anatomyPath, "utf8")).toBe(ambiguousAnatomy);
  });
});
