import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { deriveTaglineFromDescription, migrateCommand } from "../src/commands/migrate.js";
import * as validateMod from "@anatomytool/validate";

// vi.mock is hoisted above imports by vitest — safe to reference module-level.
// Default auto-mock: validate becomes vi.fn() returning undefined.
// The validation gate test overrides this for one call.
// Integration tests run in a separate child process and are unaffected.
vi.mock("@anatomytool/validate");

const BIN = resolve(import.meta.dirname, "../dist/bin.js");

function run(args: string[], cwd: string): { stdout: string; stderr: string; code: number } {
  const result = spawnSync("node", [BIN, ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    code: result.status ?? 1,
  };
}

const V1_ANATOMY = `\
anatomy_version = "0.1"
description = "A minimal test repo. Used for migration testing only."

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
by = "anatomy-cli@0.0.1"
model = "claude-sonnet-4-6"
schema = "https://anatomy.dev/spec/0.1/schema.json"
`;

const V1_WITH_ENTRY_POINTS = `\
anatomy_version = "0.1"
description = "A minimal test repo. Used for migration testing only."

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

[[operation.entry_points]]
path = "src/main.rs"
role = "cli"
description = "argument parsing and dispatch"

[generated]
at = 2026-05-05T14:22:00.000Z
by = "anatomy-cli@0.0.1"
model = "claude-sonnet-4-6"
schema = "https://anatomy.dev/spec/0.1/schema.json"
`;

const V2_ANATOMY = `\
anatomy_version = "0.2"
tagline = "A static site generator."

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
by = "anatomy-cli@0.2.0"
model = "none"
schema = "https://anatomy.dev/spec/0.2/schema.json"
`;

const V4_ANATOMY = `\
anatomy_version = "0.4"
tagline = "A static site generator."

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
by = "anatomy-cli@0.4.0"
model = "none"
schema = "https://anatomy.dev/spec/0.4/schema.json"
`;

const V5_ANATOMY = `\
anatomy_version = "0.5"
tagline = "A test service."

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
at = 2026-05-06T12:00:00.000Z
by = "anatomy-cli@0.5.0"
model = "none"
schema = "https://anatomy.dev/spec/0.5/schema.json"
`;

const V6_ANATOMY = `\
anatomy_version = "0.6"
tagline = "A static site generator with a composable plugin pipeline."

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
at = 2026-05-06T12:00:00.000Z
by = "anatomy-cli@0.6.0"
model = "none"
schema = "https://anatomy.dev/spec/0.6/schema.json"
`;

// v0.7 fixture used for v7→v8 migration tests. Identity uses flat string pillars
// with the v0.7 fingerprintFromPillars formula.
const V7_MINIMAL = `\
anatomy_version = "0.7"
tagline = "Minimal v0.7 fixture for migration testing"

[identity]
stack = "typescript"
form = "cli-tool"
domain = "developer-tools"
function = "config-validator"
fingerprint = "mx6z2zvcrwmye5tfa3cq"

[generated]
at = 2026-05-07T00:00:00.000Z
by = "anatomy-cli@0.7.0"
model = "none"
schema = "https://anatomy.dev/spec/0.7/schema.json"
`;

const V8_WITH_DROPPED_SECTIONS = `\
anatomy_version = "0.8"
tagline = "v0.8 fixture with sections that v0.9 drops"

[identity]
stack = "typescript"
form = "service"
domain = "developer-tools"
function = "config-validator"
fingerprint = "72je94dxax83n2dmn5g8"

[[substance.key_dependencies]]
name = "ajv"
why = "schema validation"

[[interface.endpoints]]
method = "POST"
path = "/validate"
summary = "validate a .anatomy"

[[domain_model.entities]]
name = "AnatomyDoc"
summary = "the parsed .anatomy structure"

[[domain_model.entities]]
name = "Memory"
summary = "the lived-experience companion log"

[generated]
at = 2026-05-08T00:00:00.000Z
by = "anatomy-cli@0.10.0"
model = "none"
schema = "https://anatomy.dev/spec/0.8/schema.json"
`;

const V7_WITH_DROPPED_SECTIONS = `\
anatomy_version = "0.7"
tagline = "v0.7 fixture with sections that v0.8 drops"

[identity]
stack = "typescript"
form = "cli-tool"
domain = "developer-tools"
function = "config-validator"
fingerprint = "mx6z2zvcrwmye5tfa3cq"

[code_profile.commands]
count = 3
sample = ["validate", "generate", "migrate"]

[[substance.key_dependencies]]
name = "ajv"
why = "schema validation"

[[substance.capabilities]]
phrase = "validates .anatomy files"

[[substance.capabilities]]
phrase = "discovers cascading .anatomy files in a tree"

[[substance.limitations]]
phrase = "does not support YAML format"

[generated]
at = 2026-05-07T00:00:00.000Z
by = "anatomy-cli@0.7.0"
model = "none"
schema = "https://anatomy.dev/spec/0.7/schema.json"
`;

// ---------------------------------------------------------------------------
// Unit tests — deriveTaglineFromDescription (no build needed)
// ---------------------------------------------------------------------------

describe("deriveTaglineFromDescription", () => {
  it("first sentence delimited by '. ' (period-space)", () => {
    expect(deriveTaglineFromDescription("First sentence. Second sentence.")).toBe("First sentence.");
  });

  it("whole first line when no period", () => {
    expect(deriveTaglineFromDescription("No period here at all")).toBe("No period here at all");
  });

  it("first line only, ignores subsequent lines", () => {
    expect(deriveTaglineFromDescription("Line one.\nLine two.")).toBe("Line one.");
  });

  it("terminal period with no trailing space", () => {
    expect(deriveTaglineFromDescription("Just this.")).toBe("Just this.");
  });

  it("does not treat ? or ! as sentence boundaries", () => {
    expect(deriveTaglineFromDescription("Is this good? Yes it is.")).toBe("Is this good? Yes it is.");
  });

  it("truncates to 120 chars on word boundary", () => {
    const input = "word ".repeat(30).trimEnd(); // 149 chars
    const result = deriveTaglineFromDescription(input);
    expect(result.length).toBeLessThanOrEqual(120);
    expect(result).not.toMatch(/ $/);
    expect(input.startsWith(result)).toBe(true);
  });

  it("single long word with no spaces (150 chars of 'a')", () => {
    const input = "a".repeat(150);
    const result = deriveTaglineFromDescription(input);
    expect(result.length).toBe(120);
  });

  it("trims trailing whitespace", () => {
    expect(deriveTaglineFromDescription("  Hello world.  ")).toBe("Hello world.");
  });
});

// ---------------------------------------------------------------------------
// Unit test — validation gate (exit 3)
// Calls migrateCommand directly with validate mocked to return ok: false.
// ---------------------------------------------------------------------------

describe("migrate — validation gate", () => {
  it("exits 3 when validate returns ok: false", async () => {
    const root = mkdtempSync(join(tmpdir(), "anat-m-"));
    const filePath = join(root, ".anatomy");
    writeFileSync(filePath, V1_ANATOMY);

    vi.mocked(validateMod.validate).mockResolvedValueOnce({
      ok: false,
      errors: [{ code: "injected-error", pointer: "/anatomy_version", message: "injected for test" }],
      warnings: [],
    });

    const code = await migrateCommand(filePath, { to: "0.2" });
    expect(code).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Integration tests — anatomy migrate command (requires dist/bin.js)
// These will fail until T3 wires the migrate command into bin.ts — expected.
// ---------------------------------------------------------------------------

describe("migrate command", () => {
  it("exit 1 when --to is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-m-"));
    const r = run(["migrate"], root);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("--to requires a version argument");
  });

  it("exit 1 when file does not exist", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-m-"));
    const r = run(["migrate", "--to", "0.2"], root);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(".anatomy not found");
  });

  it("happy path: migrates .anatomy from 0.1 to 0.2", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-m-"));
    const filePath = join(root, ".anatomy");
    writeFileSync(filePath, V1_ANATOMY);
    const r = run(["migrate", "--to", "0.2"], root);
    expect(r.code).toBe(0);
    const migrated = readFileSync(filePath, "utf8");
    expect(migrated).toContain('anatomy_version = "0.2"');
    expect(migrated).toContain("tagline");
    expect(migrated).toContain("A minimal test repo.");
    expect(migrated).toContain("description");
    expect(migrated).toContain("spec/0.2/schema.json");
    // model field should survive migration
    expect(migrated).toContain("claude-sonnet-4-6");
  });

  it("renames entry_points description → purpose", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-m-"));
    const filePath = join(root, ".anatomy");
    writeFileSync(filePath, V1_WITH_ENTRY_POINTS);
    const r = run(["migrate", "--to", "0.2"], root);
    expect(r.code).toBe(0);
    const migrated = readFileSync(filePath, "utf8");
    expect(migrated).toContain("purpose");
    expect(migrated).toContain("argument parsing and dispatch");
    // entry_points must not still use the `description` key for the value
    const lines = migrated.split("\n");
    const epDescLine = lines.findIndex(l => l.trim() === 'description = "argument parsing and dispatch"');
    expect(epDescLine).toBe(-1);
  });

  it("--stdout mode: prints to stdout, file unchanged", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-m-"));
    const filePath = join(root, ".anatomy");
    writeFileSync(filePath, V1_ANATOMY);
    const r = run(["migrate", "--to", "0.2", "--stdout"], root);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('anatomy_version = "0.2"');
    expect(r.stdout).toContain("tagline");
    const onDisk = readFileSync(filePath, "utf8");
    expect(onDisk).toContain('anatomy_version = "0.1"');
  });

  it("no-op when already at target version", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-m-"));
    const filePath = join(root, ".anatomy");
    const v2Content = [
      'anatomy_version = "0.2"',
      'description = "Already migrated."',
      'tagline = "Already migrated."',
      "",
      "[identity]",
      'fingerprint = "a8fybpg4nh2b5vpw498v"',
      "",
      "[identity.stack]",
      'id = "rust"',
      'hash = "a8fyb"',
      "",
      "[identity.form]",
      'id = "cli-tool"',
      'hash = "pg4nh"',
      "",
      "[identity.domain]",
      'id = "web-publishing"',
      'hash = "2b5vp"',
      "",
      "[identity.function]",
      'id = "markdown-to-static-html"',
      'hash = "w498v"',
      "",
      "[generated]",
      "at = 2026-05-05T14:22:00.000Z",
      'by = "anatomy-cli@0.3.2"',
      'schema = "https://anatomy.dev/spec/0.2/schema.json"',
      "",
    ].join("\n");
    writeFileSync(filePath, v2Content);
    const r = run(["migrate", "--to", "0.2"], root);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain("already at 0.2");
  });

  it("happy path: migrates .anatomy from 0.2 to 0.4", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-m-"));
    const filePath = join(root, ".anatomy");
    writeFileSync(filePath, V2_ANATOMY);
    const r = run(["migrate", "--to", "0.4"], root);
    expect(r.code).toBe(0);
    const migrated = readFileSync(filePath, "utf8");
    expect(migrated).toContain('anatomy_version = "0.4"');
    expect(migrated).toContain("spec/0.4/schema.json");
    // v0.4 is additive over v0.2; identity and tagline preserved
    expect(migrated).toContain('id = "rust"');
    expect(migrated).toContain('tagline = "A static site generator."');
  });

  it("happy path: migrates .anatomy from 0.4 to 0.5", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-m-"));
    const filePath = join(root, ".anatomy");
    writeFileSync(filePath, V4_ANATOMY);
    const r = run(["migrate", "--to", "0.5"], root);
    expect(r.code).toBe(0);
    const migrated = readFileSync(filePath, "utf8");
    expect(migrated).toContain('anatomy_version = "0.5"');
    expect(migrated).toContain("spec/0.5/schema.json");
    expect(migrated).toContain("markdown-to-static-html");
  });

  it("happy path: migrates .anatomy from 0.5 to 0.6", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-m-"));
    const filePath = join(root, ".anatomy");
    writeFileSync(filePath, V5_ANATOMY);
    const r = run(["migrate", "--to", "0.6"], root);
    expect(r.code).toBe(0);
    const migrated = readFileSync(filePath, "utf8");
    expect(migrated).toContain('anatomy_version = "0.6"');
    expect(migrated).toContain("spec/0.6/schema.json");
    expect(migrated).toContain("markdown-to-static-html");
  });

  it("happy path: migrates .anatomy from 0.6 to 0.7", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-m-"));
    const filePath = join(root, ".anatomy");
    writeFileSync(filePath, V6_ANATOMY);
    const r = run(["migrate", "--to", "0.7"], root);
    expect(r.code).toBe(0);
    const migrated = readFileSync(filePath, "utf8");
    // Version and schema updated
    expect(migrated).toContain('anatomy_version = "0.7"');
    expect(migrated).toContain("spec/0.7/schema.json");
    // Flat [identity] with string pillar values
    expect(migrated).toContain('stack = "rust"');
    expect(migrated).toContain('form = "cli-tool"');
    expect(migrated).toContain('domain = "web-publishing"');
    expect(migrated).toContain('function = "markdown-to-static-html"');
    // No nested [identity.stack] sub-sections
    expect(migrated).not.toContain("[identity.stack]");
    expect(migrated).not.toContain("[identity.form]");
    expect(migrated).not.toContain("[identity.domain]");
    expect(migrated).not.toContain("[identity.function]");
  });

  it("exit 1 on unsupported migration path", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-m-"));
    const filePath = join(root, ".anatomy");
    writeFileSync(filePath, V1_ANATOMY);
    const r = run(["migrate", "--to", "0.3"], root);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/no migration path|unsupported migration path/);
    expect(r.stderr).toContain("0.1 → 0.3");
  });

  it("explicit path argument: migrates named file", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-m-"));
    const filePath = join(root, "sub.anatomy");
    writeFileSync(filePath, V1_ANATOMY);
    const r = run(["migrate", "--to", "0.2", filePath], root);
    expect(r.code).toBe(0);
    const migrated = readFileSync(filePath, "utf8");
    expect(migrated).toContain('anatomy_version = "0.2"');
  });

  it("happy path: migrates a no-op-shape .anatomy from 0.7 to 0.8 with fingerprint preserved", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-m-"));
    const filePath = join(root, ".anatomy");
    writeFileSync(filePath, V7_MINIMAL);
    const r = run(["migrate", "--to", "0.8"], root);
    expect(r.code).toBe(0);
    const migrated = readFileSync(filePath, "utf8");
    expect(migrated).toContain('anatomy_version = "0.8"');
    expect(migrated).toContain("spec/0.8/schema.json");
    // Identity pillars unchanged → fingerprint unchanged.
    expect(migrated).toContain('fingerprint = "mx6z2zvcrwmye5tfa3cq"');
    // No spurious warnings on a v0.7 file with none of the dropped sections.
    expect(r.stderr).not.toContain("warning");
  });

  it("v0.7 → v0.8: drops code_profile silently and warns on capabilities/limitations", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-m-"));
    const filePath = join(root, ".anatomy");
    writeFileSync(filePath, V7_WITH_DROPPED_SECTIONS);
    const r = run(["migrate", "--to", "0.8"], root);
    expect(r.code).toBe(0);
    const migrated = readFileSync(filePath, "utf8");

    // Version + schema bumped.
    expect(migrated).toContain('anatomy_version = "0.8"');
    expect(migrated).toContain("spec/0.8/schema.json");
    // code_profile removed entirely.
    expect(migrated).not.toContain("[code_profile");
    // capabilities + limitations removed.
    expect(migrated).not.toContain("[[substance.capabilities]]");
    expect(migrated).not.toContain("[[substance.limitations]]");
    // key_dependencies preserved.
    expect(migrated).toContain('name = "ajv"');

    // Stderr warnings list dropped phrases for capabilities + limitations.
    expect(r.stderr).toContain("Dropped substance.capabilities");
    expect(r.stderr).toContain("validates .anatomy files");
    expect(r.stderr).toContain("Dropped substance.limitations");
    expect(r.stderr).toContain("does not support YAML format");
    // No warning for code_profile (silent drop).
    expect(r.stderr).not.toContain("Dropped code_profile");
  });

  it("v0.5 → v0.9: auto-chains through 0.6 → 0.7 → 0.8 → 0.9 and aggregates warnings", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-m-"));
    const filePath = join(root, ".anatomy");
    const v5 = `anatomy_version = "0.5"
tagline = "v0.5 fixture for auto-chain test"

[identity]
fingerprint = "jtambp6hxrw6sdkdsnfk"

[identity.stack]
id = "typescript"
hash = "jtamb"

[identity.form]
id = "typescript-library"
hash = "p6hxr"

[identity.domain]
id = "developer-tooling"
hash = "w6sdk"

[identity.function]
id = "anatomy-file-validator"
hash = "dsnfk"

[[interface.exports]]
symbol = "validate"
kind = "function"
summary = "Validate a .anatomy file"

[[substance.key_dependencies]]
name = "ajv"
why = "schema validation"

[[substance.capabilities]]
phrase = "validates .anatomy files"

[[substance.limitations]]
phrase = "no YAML format"

[[architecture.invariants]]
rule = "Pass 1 must remain deterministic"

[generated]
at = 2026-05-06T12:00:00.000Z
by = "anatomy-cli@0.5.0"
model = "none"
schema = "https://anatomy.dev/spec/0.5/schema.json"
`;
    writeFileSync(filePath, v5);
    const r = run(["migrate", "--to", "0.9"], root);
    expect(r.code).toBe(0);
    const migrated = readFileSync(filePath, "utf8");

    // Final version + schema reflect the destination, not an intermediate.
    expect(migrated).toContain('anatomy_version = "0.9"');
    expect(migrated).toContain("spec/0.9/schema.json");

    // Every section dropped along the chain is gone.
    expect(migrated).not.toMatch(/\[\[architecture\./);
    expect(migrated).not.toMatch(/\[\[substance\./);
    expect(migrated).not.toMatch(/\[substance\]/);
    expect(migrated).not.toMatch(/\[\[interface\./);
    expect(migrated).not.toMatch(/\[interface\]/);

    // Identity flattened (v0.7 step), pillars preserved as plain strings.
    expect(migrated).toMatch(/^stack = "typescript"$/m);
    expect(migrated).toMatch(/^form = "typescript-library"$/m);
    expect(migrated).toMatch(/^domain = "developer-tooling"$/m);
    expect(migrated).toMatch(/^function = "anatomy-file-validator"$/m);
    // Per-pillar hash sub-tables gone.
    expect(migrated).not.toMatch(/\[identity\.stack\]/);

    // Aggregated warnings from intermediate steps reach stderr.
    expect(r.stderr).toContain("Dropped substance.capabilities");
    expect(r.stderr).toContain("Dropped substance.limitations");
    expect(r.stderr).toContain("Dropped [interface]");
    expect(r.stderr).toContain("Dropped [substance.key_dependencies]");
  });

  it("v0.5 → v0.9 --stdout: same chain, no in-place write", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-m-"));
    const filePath = join(root, ".anatomy");
    const v5 = `anatomy_version = "0.5"
tagline = "stdout chain test"

[identity]
fingerprint = "jtambp6hxrw6sdkdsnfk"

[identity.stack]
id = "typescript"
hash = "jtamb"

[identity.form]
id = "typescript-library"
hash = "p6hxr"

[identity.domain]
id = "developer-tooling"
hash = "w6sdk"

[identity.function]
id = "anatomy-file-validator"
hash = "dsnfk"

[generated]
at = 2026-05-06T12:00:00.000Z
by = "anatomy-cli@0.5.0"
model = "none"
schema = "https://anatomy.dev/spec/0.5/schema.json"
`;
    writeFileSync(filePath, v5);
    const r = run(["migrate", "--to", "0.9", filePath, "--stdout"], root);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('anatomy_version = "0.9"');
    // File on disk stayed at 0.5 because --stdout was passed.
    const onDisk = readFileSync(filePath, "utf8");
    expect(onDisk).toContain('anatomy_version = "0.5"');
  });

  it("rejects unreachable migration paths", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-m-"));
    const filePath = join(root, ".anatomy");
    // Source is v0.9; target v0.5 — backward chain doesn't exist.
    writeFileSync(filePath, `anatomy_version = "0.9"
tagline = "test"
[identity]
stack = "javascript"
form = "library"
domain = "demo"
function = "test"
fingerprint = "kh3ybxthmht0yvvskye2"
[generated]
at = 2026-05-09T00:00:00.000Z
by = "x"
model = "x"
schema = "https://anatomy.dev/spec/0.9/schema.json"
`);
    const r = run(["migrate", "--to", "0.5"], root);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/no migration path|unsupported migration path/);
  });

  it("v0.8 → v0.9: drops [interface], [domain_model], and [substance] with warnings", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-m-"));
    const filePath = join(root, ".anatomy");
    writeFileSync(filePath, V8_WITH_DROPPED_SECTIONS);
    const r = run(["migrate", "--to", "0.9"], root);
    expect(r.code).toBe(0);
    const migrated = readFileSync(filePath, "utf8");

    // Version + schema bumped.
    expect(migrated).toContain('anatomy_version = "0.9"');
    expect(migrated).toContain("spec/0.9/schema.json");

    // All three sections removed entirely.
    expect(migrated).not.toContain("[[substance.key_dependencies]]");
    expect(migrated).not.toContain("[substance");
    expect(migrated).not.toContain("[[interface.");
    expect(migrated).not.toContain("[interface]");
    expect(migrated).not.toContain("[[domain_model.");
    expect(migrated).not.toContain("[domain_model]");

    // Identity preserved (fingerprint unchanged — v0.9 keeps v0.8's pillar formula).
    expect(migrated).toContain('fingerprint = "72je94dxax83n2dmn5g8"');
    expect(migrated).toContain('domain = "developer-tools"');

    // Stderr warnings list dropped items for each non-empty section.
    expect(r.stderr).toContain("Dropped [interface]");
    expect(r.stderr).toContain("Dropped [domain_model]");
    expect(r.stderr).toContain("AnatomyDoc");
    expect(r.stderr).toContain("Dropped [substance.key_dependencies]");
    expect(r.stderr).toContain("ajv");
  });

  it("v0.9 → v0.10: version + schema URL bump only (no data changes)", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-m-"));
    const filePath = join(root, ".anatomy");
    const v9 = `anatomy_version = "0.9"
tagline = "v0.9 → v0.10 migration test"

[identity]
stack = "javascript"
form = "library"
domain = "test"
function = "test"
fingerprint = "gam8dfnmzpa4na7wq1fs"

[[rules]]
rule = "a real rule"
why = "a real reason"

[generated]
at = 2026-05-09T00:00:00.000Z
commit = "abcdef0"
by = "anatomy-cli@0.12.7"
model = "none"
schema = "https://anatomy.dev/spec/0.9/schema.json"
`;
    writeFileSync(filePath, v9);
    const r = run(["migrate", "--to", "0.10"], root);
    expect(r.code).toBe(0);
    const migrated = readFileSync(filePath, "utf8");

    // Version + schema bumped.
    expect(migrated).toContain('anatomy_version = "0.10"');
    expect(migrated).toContain("spec/0.10/schema.json");

    // Identity and pillars preserved (fingerprint unchanged since formula is unchanged).
    expect(migrated).toContain('fingerprint = "gam8dfnmzpa4na7wq1fs"');
    expect(migrated).toContain('stack = "javascript"');

    // Existing rules survive.
    expect(migrated).toContain('rule = "a real rule"');

    // [generate] section is NOT added by migration (defaults apply if absent).
    expect(migrated).not.toContain("[generate]");

    // No warnings — additive migration.
    expect(r.stderr).not.toContain("Dropped");
  });

  it("v0.10 → v0.11: version + schema URL bump only (additive, no data changes)", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-m-"));
    const filePath = join(root, ".anatomy");
    const v10 = `anatomy_version = "0.10"
tagline = "v0.10 → v0.11 migration test"

[identity]
stack = "javascript"
form = "library"
domain = "test"
function = "test"
fingerprint = "gam8dfnmzpa4na7wq1fs"

[[rules]]
rule = "a real rule"
why = "a real reason"

[generate]
agents_md = true
agents_md_budget = 1500
agents_md_memory_count = 10

[generated]
at = 2026-05-10T00:00:00.000Z
commit = "abcdef1"
by = "anatomy-cli@0.13.0"
model = "none"
schema = "https://anatomy.dev/spec/0.10/schema.json"
`;
    writeFileSync(filePath, v10);
    const r = run(["migrate", "--to", "0.11"], root);
    expect(r.code).toBe(0);
    const migrated = readFileSync(filePath, "utf8");

    // Version + schema bumped.
    expect(migrated).toContain('anatomy_version = "0.11"');
    expect(migrated).toContain("spec/0.11/schema.json");
    expect(migrated).not.toContain('anatomy_version = "0.10"');

    // Identity and pillars preserved (fingerprint unchanged since formula is unchanged).
    expect(migrated).toContain('fingerprint = "gam8dfnmzpa4na7wq1fs"');
    expect(migrated).toContain('stack = "javascript"');

    // Existing rules survive.
    expect(migrated).toContain('rule = "a real rule"');

    // Existing [generate] fields survive (per-tool flags NOT added by migration).
    expect(migrated).toContain('agents_md = true');
    expect(migrated).not.toContain("cursor");
    expect(migrated).not.toContain("aider");

    // No warnings — additive migration.
    expect(r.stderr).not.toContain("Dropped");
  });

  it("v0.11 → v0.12: version + schema URL bump only (additive, no data changes)", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-m-"));
    const v11 = `anatomy_version = "0.11"
tagline = "v0.11 → v0.12 migration test"

[identity]
stack = "javascript"
form = "library"
domain = "test"
function = "test"
fingerprint = "gam8dfnmzpa4na7wq1fs"

[[rules]]
rule = "a real rule"
why = "a real reason"

[generated]
at = 2026-05-11T00:00:00.000Z
commit = "abcdef2"
by = "anatomy-cli@0.13.0"
model = "none"
schema = "https://anatomy.dev/spec/0.11/schema.json"
`;
    const filePath = join(root, ".anatomy");
    writeFileSync(filePath, v11);
    const r = run(["migrate", "--to", "0.12"], root);
    expect(r.code).toBe(0);
    const migrated = readFileSync(filePath, "utf8");

    // Version + schema bumped.
    expect(migrated).toContain('anatomy_version = "0.12"');
    expect(migrated).toContain("spec/0.12/schema.json");
    expect(migrated).not.toContain('anatomy_version = "0.11"');

    // Identity and pillars preserved (fingerprint unchanged since formula is unchanged).
    expect(migrated).toContain('fingerprint = "gam8dfnmzpa4na7wq1fs"');
    expect(migrated).toContain('stack = "javascript"');

    // Existing rules survive.
    expect(migrated).toContain('rule = "a real rule"');

    // No warnings — additive migration.
    expect(migrated).not.toContain("Dropped");
  });

  it("v0.14 → v0.15: version + schema URL bump only (additive, no data changes)", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-m-"));
    const filePath = join(root, ".anatomy");
    writeFileSync(filePath, `anatomy_version = "0.14"
tagline = "v0.14 → v0.15 migration test"

[identity]
stack = "javascript"
form = "library"
domain = "test"
function = "test-fn"
fingerprint = "w87sfqxp999cxnam77z0"

[generated]
at = 2026-05-17T00:00:00.000Z
by = "anatomy-cli@1.0.0"
model = "none"
schema = "https://anatomy.dev/spec/0.14/schema.json"
`);
    const r = run(["migrate", "--to", "0.15"], root);
    expect(r.code).toBe(0);
    const migrated = readFileSync(filePath, "utf8");
    expect(migrated).toContain('anatomy_version = "0.15"');
    expect(migrated).toContain("spec/0.15/schema.json");
    expect(migrated).toContain('fingerprint = "w87sfqxp999cxnam77z0"');
    expect(r.stderr).not.toContain("Dropped");
  });

  it("v0.15 → v1.0: relabel — version + schema URL bump only", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-m-"));
    const filePath = join(root, ".anatomy");
    writeFileSync(filePath, `anatomy_version = "0.15"
tagline = "v0.15 → v1.0 relabel test"

[identity]
stack = "javascript"
form = "library"
domain = "test"
function = "test-fn"
fingerprint = "w87sfqxp999cxnam77z0"

[generated]
at = 2026-05-17T00:00:00.000Z
by = "anatomy-cli@1.0.0"
model = "none"
schema = "https://anatomy.dev/spec/0.15/schema.json"
`);
    const r = run(["migrate", "--to", "1.0"], root);
    expect(r.code).toBe(0);
    const migrated = readFileSync(filePath, "utf8");
    expect(migrated).toContain('anatomy_version = "1.0"');
    expect(migrated).toContain("spec/1.0/schema.json");
    expect(migrated).not.toContain('anatomy_version = "0.15"');
    expect(migrated).toContain('fingerprint = "w87sfqxp999cxnam77z0"');
    expect(r.stderr).not.toContain("Dropped");
  });

  it("v0.13 → v1.0: auto-chains 0.13 → 0.14 → 0.15 → 1.0", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-m-"));
    const filePath = join(root, ".anatomy");
    writeFileSync(filePath, `anatomy_version = "0.13"
tagline = "v0.13 → v1.0 chain test"

[identity]
stack = "javascript"
form = "library"
domain = "test"
function = "test-fn"
fingerprint = "w87sfqxp999cxnam77z0"

[generated]
at = 2026-05-17T00:00:00.000Z
by = "anatomy-cli@1.0.0"
model = "none"
schema = "https://anatomy.dev/spec/0.13/schema.json"
`);
    const r = run(["migrate", "--to", "1.0"], root);
    expect(r.code).toBe(0);
    const migrated = readFileSync(filePath, "utf8");
    expect(migrated).toContain('anatomy_version = "1.0"');
    expect(migrated).toContain("spec/1.0/schema.json");
    expect(migrated).not.toContain('anatomy_version = "0.13"');
  });
});
