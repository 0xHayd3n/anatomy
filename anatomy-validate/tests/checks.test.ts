import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { schemaCheck } from "../src/checks/schema-check.js";
import { hashCheck } from "../src/checks/hash-check.js";
import { fingerprintCheck } from "../src/checks/fingerprint-check.js";
import { descriptionWarnCheck } from "../src/checks/description-warn.js";
import { structurePathCheck } from "../src/checks/structure-path-check.js";
import { interfaceFormCheck } from "../src/checks/interface-form-check.js";
import { entryPointAliasWarn } from "../src/checks/entry-point-alias-warn.js";
import { commandsNoTestWarn } from "../src/checks/commands-no-test-warn.js";
import { sourcePathCheck } from "../src/checks/source-path-check.js";
import { nestedPathEscapeCheck } from "../src/checks/nested-path-escape.js";
import { fingerprintFromPillars } from "../src/canonical.js";

const validDoc = {
  anatomy_version: "0.1",
  description: "x",
  identity: {
    fingerprint: "a8fybpg4nh2b5vpw498v",
    stack: { id: "rust", hash: "a8fyb" },
    form: { id: "cli-tool", hash: "pg4nh" },
    domain: { id: "web-publishing", hash: "2b5vp" },
    function: { id: "markdown-to-static-html", hash: "w498v" },
  },
  generated: {
    at: "2026-05-05T14:22:00Z",
    by: "x",
    model: "x",
    schema: "https://example.com",
  },
};

describe("schemaCheck", () => {
  it("returns no errors for a valid doc", () => {
    const result = schemaCheck(validDoc);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("returns required-violation error when identity.stack is missing", () => {
    const doc = JSON.parse(JSON.stringify(validDoc));
    delete doc.identity.stack;
    const result = schemaCheck(doc);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].code).toBe("schema-violation");
    expect(result.errors[0].schemaKeyword).toBe("required");
    expect(result.errors[0].pointer).toBe("/identity");
  });

  it("returns pattern-violation for non-canonical pillar id", () => {
    const doc = JSON.parse(JSON.stringify(validDoc));
    doc.identity.form.id = "CLI-Tool";
    const result = schemaCheck(doc);
    const patternError = result.errors.find(e => e.schemaKeyword === "pattern");
    expect(patternError).toBeDefined();
    expect(patternError!.pointer).toBe("/identity/form/id");
  });
});

describe("hashCheck", () => {
  it("returns no errors when all pillar hashes match canonicalHash(id)", () => {
    const result = hashCheck(validDoc);
    expect(result.errors).toEqual([]);
  });

  it("flags a wrong stack hash", () => {
    const doc = JSON.parse(JSON.stringify(validDoc));
    doc.identity.stack.hash = "zzzzz";
    const result = hashCheck(doc);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].code).toBe("hash-content-mismatch");
    expect(result.errors[0].pointer).toBe("/identity/stack/hash");
    expect(result.errors[0].expected).toBe("a8fyb");
    expect(result.errors[0].actual).toBe("zzzzz");
  });

  it("flags multiple wrong hashes", () => {
    const doc = JSON.parse(JSON.stringify(validDoc));
    doc.identity.stack.hash = "zzzzz";
    doc.identity.form.hash = "00000";
    const result = hashCheck(doc);
    expect(result.errors.length).toBe(2);
  });

  it("returns no errors when identity is missing (schema-check handles)", () => {
    const result = hashCheck({});
    expect(result.errors).toEqual([]);
  });
});

describe("fingerprintCheck", () => {
  it("returns no errors when fingerprint = concat of pillar hashes", () => {
    const result = fingerprintCheck(validDoc);
    expect(result.errors).toEqual([]);
  });

  it("flags a wrong fingerprint", () => {
    const doc = JSON.parse(JSON.stringify(validDoc));
    doc.identity.fingerprint = "aaaaabbbbbcccccddddd";
    const result = fingerprintCheck(doc);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].code).toBe("fingerprint-mismatch");
    expect(result.errors[0].pointer).toBe("/identity/fingerprint");
    expect(result.errors[0].expected).toBe("a8fybpg4nh2b5vpw498v");
    expect(result.errors[0].actual).toBe("aaaaabbbbbcccccddddd");
  });

  it("returns no errors when identity is missing", () => {
    const result = fingerprintCheck({});
    expect(result.errors).toEqual([]);
  });

  it("returns no errors when a pillar id can't be canonicalized", () => {
    const doc = JSON.parse(JSON.stringify(validDoc));
    doc.identity.stack.id = "C++"; // canonicalize returns null
    const result = fingerprintCheck(doc);
    expect(result.errors).toEqual([]);
  });
});

describe("fingerprintCheck — flat identity (v0.7+)", () => {
  // v0.7 flattened identity to plain string pillars. v0.9–v0.15 keep the
  // identical flat shape. fingerprintCheck must verify the fingerprint for
  // ALL flat-identity versions, not just v0.7/v0.8.
  const correctFp = fingerprintFromPillars("typescript", "library", "web", "formatter");
  const flatDoc = (version: string, fingerprint: string) => ({
    anatomy_version: version,
    identity: { stack: "typescript", form: "library", domain: "web", function: "formatter", fingerprint },
  });

  it("flags a wrong fingerprint on a v0.15 flat-identity doc", () => {
    const r = fingerprintCheck(flatDoc("0.15", "aaaaabbbbbcccccddddd"));
    expect(r.errors.length).toBe(1);
    expect(r.errors[0].code).toBe("fingerprint-mismatch");
    expect(r.errors[0].pointer).toBe("/identity/fingerprint");
    expect(r.errors[0].expected).toBe(correctFp);
    expect(r.errors[0].actual).toBe("aaaaabbbbbcccccddddd");
  });

  it("accepts a correct fingerprint on a v0.15 flat-identity doc", () => {
    const r = fingerprintCheck(flatDoc("0.15", correctFp));
    expect(r.errors).toEqual([]);
  });

  it("flags a wrong fingerprint on a v0.9 doc (lower bound of the broken range)", () => {
    const r = fingerprintCheck(flatDoc("0.9", "aaaaabbbbbcccccddddd"));
    expect(r.errors[0]?.code).toBe("fingerprint-mismatch");
  });

  it("flags a wrong fingerprint on a v0.14 doc (upper bound of the broken range)", () => {
    const r = fingerprintCheck(flatDoc("0.14", "aaaaabbbbbcccccddddd"));
    expect(r.errors[0]?.code).toBe("fingerprint-mismatch");
  });

  it("still verifies v0.7 and v0.8 flat identity (no regression)", () => {
    expect(fingerprintCheck(flatDoc("0.7", "aaaaabbbbbcccccddddd")).errors[0]?.code).toBe("fingerprint-mismatch");
    expect(fingerprintCheck(flatDoc("0.8", "aaaaabbbbbcccccddddd")).errors[0]?.code).toBe("fingerprint-mismatch");
    expect(fingerprintCheck(flatDoc("0.8", correctFp)).errors).toEqual([]);
  });
});

describe("schemaCheck — version routing", () => {
  const v01Doc = JSON.parse(JSON.stringify(validDoc));
  const v02Doc = {
    anatomy_version: "0.2",
    tagline: "x",
    identity: {
      fingerprint: "a8fybpg4nh2b5vpw498v",
      stack: { id: "rust", hash: "a8fyb" },
      form: { id: "cli-tool", hash: "pg4nh" },
      domain: { id: "web-publishing", hash: "2b5vp" },
      function: { id: "markdown-to-static-html", hash: "w498v" },
    },
    generated: {
      at: "2026-05-06T14:22:00Z",
      by: "x",
      model: "x",
      schema: "https://example.com",
    },
  };

  it("validates a v0.1 doc against the v0.1 schema", () => {
    const r = schemaCheck(v01Doc);
    expect(r.errors).toEqual([]);
  });

  it("validates a v0.2 doc against the v0.2 schema", () => {
    const r = schemaCheck(v02Doc);
    expect(r.errors).toEqual([]);
  });

  it("returns unsupported-anatomy-version for an unknown version", () => {
    const r = schemaCheck({ anatomy_version: "9.9" });
    expect(r.errors[0]?.code).toBe("unsupported-anatomy-version");
    expect(r.errors[0]?.pointer).toBe("/anatomy_version");
  });

  it("returns unsupported-anatomy-version when anatomy_version is missing", () => {
    const r = schemaCheck({});
    expect(r.errors[0]?.code).toBe("unsupported-anatomy-version");
  });
});

describe("structurePathCheck", () => {
  it("returns no errors when repoRoot is undefined", () => {
    const doc = { structure: { entries: [{ path: "src/", purpose: "x", kind: "source" }] } };
    expect(structurePathCheck(doc, undefined).errors).toEqual([]);
  });

  it("returns no errors when all paths exist", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-"));
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "README.md"), "");
    const doc = { structure: { entries: [
      { path: "src/", purpose: "x", kind: "source" },
      { path: "README.md", purpose: "y", kind: "docs" },
    ]}};
    expect(structurePathCheck(doc, root).errors).toEqual([]);
  });

  it("returns structure-path-not-found errors for missing paths", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-"));
    const doc = { structure: { entries: [{ path: "missing/", purpose: "x", kind: "source" }] } };
    const r = structurePathCheck(doc, root);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].code).toBe("structure-path-not-found");
    expect(r.errors[0].pointer).toBe("/structure/entries/0/path");
    expect(r.errors[0].actual).toBe("missing/");
  });

  it("returns no errors when [structure] is absent", () => {
    expect(structurePathCheck({}, "/tmp").errors).toEqual([]);
  });
});

describe("structurePathCheck — anatomyDir", () => {
  it("resolves paths relative to repoRoot/anatomyDir when both are set", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-"));
    mkdirSync(join(root, "sub", "src"), { recursive: true });
    const doc = { structure: { entries: [{ path: "src/", purpose: "x", kind: "source" }] } };
    expect(structurePathCheck(doc, root, "sub").errors).toEqual([]);
  });

  it("falls back to repoRoot resolution when anatomyDir is undefined (v0.2 behavior)", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-"));
    mkdirSync(join(root, "src"));
    const doc = { structure: { entries: [{ path: "src/", purpose: "x", kind: "source" }] } };
    expect(structurePathCheck(doc, root, undefined).errors).toEqual([]);
  });

  it("uses '' anatomyDir as equivalent to repoRoot (root .anatomy)", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-"));
    mkdirSync(join(root, "src"));
    const doc = { structure: { entries: [{ path: "src/", purpose: "x", kind: "source" }] } };
    expect(structurePathCheck(doc, root, "").errors).toEqual([]);
  });
});

describe("interfaceFormCheck", () => {
  const f = (formId: string, variant: "exports" | "endpoints" | "subcommands") => ({
    identity: { form: { id: formId, hash: "xxxxx" } },
    interface: variant === "exports"
      ? { exports: [{ symbol: "x", kind: "function", summary: "y" }] }
      : variant === "endpoints"
      ? { endpoints: [{ method: "GET", path: "/", summary: "y" }] }
      : { subcommands: [{ name: "x", summary: "y" }] },
  });

  it("no error when [interface] is absent", () => {
    expect(interfaceFormCheck({ identity: { form: { id: "cli-tool", hash: "xxxxx" } } }).errors).toEqual([]);
  });

  it("cli-tool + subcommands → ok", () => {
    expect(interfaceFormCheck(f("cli-tool", "subcommands")).errors).toEqual([]);
  });

  it("library + exports → ok", () => {
    expect(interfaceFormCheck(f("react-library", "exports")).errors).toEqual([]);
  });

  it("microservice + endpoints → ok", () => {
    expect(interfaceFormCheck(f("microservice", "endpoints")).errors).toEqual([]);
  });

  it("graphql-api + endpoints → ok (api substring)", () => {
    expect(interfaceFormCheck(f("graphql-api", "endpoints")).errors).toEqual([]);
  });

  it("cli-library + subcommands → ok (cli wins via tiebreak)", () => {
    expect(interfaceFormCheck(f("cli-library", "subcommands")).errors).toEqual([]);
  });

  it("cli-library + exports → mismatch (cli wins; exports not allowed)", () => {
    const r = interfaceFormCheck(f("cli-library", "exports"));
    expect(r.errors[0]?.code).toBe("interface-form-mismatch");
  });

  it("desktop-app + any variant → mismatch ([interface] must be absent)", () => {
    const r = interfaceFormCheck(f("desktop-app", "exports"));
    expect(r.errors[0]?.code).toBe("interface-form-mismatch");
  });

  // v0.7 fixture: identity.form is a plain string (flat identity).
  const f7 = (formId: string, variant: "exports" | "endpoints" | "subcommands") => ({
    anatomy_version: "0.7",
    identity: { form: formId },
    interface: variant === "exports"
      ? { exports: [{ symbol: "x", kind: "function", summary: "y" }] }
      : variant === "endpoints"
      ? { endpoints: [{ method: "GET", path: "/", summary: "y" }] }
      : { subcommands: [{ name: "x", summary: "y" }] },
  });

  it("v0.7 flat identity: cli-tool + subcommands → ok", () => {
    expect(interfaceFormCheck(f7("cli-tool", "subcommands")).errors).toEqual([]);
  });

  it("v0.7 flat identity: library + subcommands → mismatch (catches the bug, not silently passes)", () => {
    const r = interfaceFormCheck(f7("react-library", "subcommands"));
    expect(r.errors[0]?.code).toBe("interface-form-mismatch");
  });

  it("v0.7 flat identity: monorepo + exports → mismatch ([interface] must be absent)", () => {
    const r = interfaceFormCheck(f7("monorepo", "exports"));
    expect(r.errors[0]?.code).toBe("interface-form-mismatch");
  });
});

describe("entryPointAliasWarn", () => {
  it("no warning for a v0.1 doc using description", () => {
    const doc = { anatomy_version: "0.1", operation: { entry_points: [{ path: "x", role: "cli", description: "y" }] } };
    expect(entryPointAliasWarn(doc).warnings).toEqual([]);
  });

  it("no warning for a v0.2 doc using purpose", () => {
    const doc = { anatomy_version: "0.2", operation: { entry_points: [{ path: "x", role: "cli", purpose: "y" }] } };
    expect(entryPointAliasWarn(doc).warnings).toEqual([]);
  });

  it("emits warning for a v0.2 doc using description", () => {
    const doc = { anatomy_version: "0.2", operation: { entry_points: [{ path: "x", role: "cli", description: "y" }] } };
    const r = entryPointAliasWarn(doc);
    expect(r.warnings[0]?.code).toBe("entry-point-description-deprecated");
    expect(r.warnings[0]?.pointer).toBe("/operation/entry_points/0/description");
  });

  it("emits one warning per offending entry", () => {
    const doc = { anatomy_version: "0.2", operation: { entry_points: [
      { path: "a", role: "cli", description: "x" },
      { path: "b", role: "cli", purpose: "y" },
      { path: "c", role: "cli", description: "z" },
    ]}};
    expect(entryPointAliasWarn(doc).warnings.map(w => w.pointer)).toEqual([
      "/operation/entry_points/0/description",
      "/operation/entry_points/2/description",
    ]);
  });
});

describe("sourcePathCheck", () => {
  it("no errors/warnings when repoRoot is undefined", () => {
    const doc = { substance: { capabilities: [{ phrase: "x", source: { path: "missing/", symbol: "y" } }] } };
    expect(sourcePathCheck(doc, undefined)).toEqual({ errors: [], warnings: [] });
  });

  it("structured form + missing path → hard error", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-"));
    const doc = { substance: { capabilities: [{ phrase: "x", source: { path: "missing.rs", symbol: "y" } }] } };
    const r = sourcePathCheck(doc, root);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].code).toBe("source-path-not-found");
    expect(r.errors[0].pointer).toBe("/substance/capabilities/0/source/path");
  });

  it("structured form + extant path → no error", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-"));
    writeFileSync(join(root, "lib.rs"), "");
    const doc = { substance: { capabilities: [{ phrase: "x", source: { path: "lib.rs", symbol: "y" } }] } };
    expect(sourcePathCheck(doc, root).errors).toEqual([]);
  });

  it("string form + missing path → soft warning", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-"));
    const doc = { substance: { capabilities: [{ phrase: "x", source: "missing.rs#sym" }] } };
    const r = sourcePathCheck(doc, root);
    expect(r.errors).toEqual([]);
    expect(r.warnings[0]?.code).toBe("source-path-soft-not-found");
  });

  it("string form + extant path → no warning", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-"));
    writeFileSync(join(root, "lib.rs"), "");
    const doc = { substance: { capabilities: [{ phrase: "x", source: "lib.rs#sym" }] } };
    expect(sourcePathCheck(doc, root)).toEqual({ errors: [], warnings: [] });
  });

  it("limitations array also covered", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-"));
    const doc = { substance: { limitations: [{ phrase: "x", source: { path: "missing", symbol: "y" } }] } };
    const r = sourcePathCheck(doc, root);
    expect(r.errors[0]?.code).toBe("source-path-not-found");
    expect(r.errors[0].pointer).toBe("/substance/limitations/0/source/path");
  });

  it("resolves source.path relative to repoRoot/anatomyDir when both set", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-"));
    mkdirSync(join(root, "sub"));
    writeFileSync(join(root, "sub", "lib.rs"), "");
    const doc = { substance: { capabilities: [{ phrase: "x", source: { path: "lib.rs", symbol: "y" } }] } };
    expect(sourcePathCheck(doc, root, "sub")).toEqual({ errors: [], warnings: [] });
  });
});

describe("nestedPathEscapeCheck", () => {
  it("returns no errors when anatomyDir is undefined (v0.2 callers)", () => {
    const doc = { structure: { entries: [{ path: "../escape", purpose: "x", kind: "source" }] } };
    expect(nestedPathEscapeCheck(doc, undefined).errors).toEqual([]);
  });

  it("returns no errors when paths stay within anatomyDir", () => {
    const doc = {
      structure: { entries: [{ path: "src/", purpose: "x", kind: "source" }] },
      operation: { entry_points: [{ path: "src/main.rs", role: "cli" }] },
    };
    expect(nestedPathEscapeCheck(doc, "packages/sdk").errors).toEqual([]);
  });

  it("flags structure.entries paths that escape via ../", () => {
    const doc = { structure: { entries: [{ path: "../sibling/", purpose: "x", kind: "source" }] } };
    const r = nestedPathEscapeCheck(doc, "packages/sdk");
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].code).toBe("nested-path-escape");
    expect(r.errors[0].pointer).toBe("/structure/entries/0/path");
  });

  it("flags entry_points.path that escape", () => {
    const doc = { operation: { entry_points: [{ path: "../../etc/passwd", role: "cli" }] } };
    const r = nestedPathEscapeCheck(doc, "packages/sdk");
    expect(r.errors[0]?.code).toBe("nested-path-escape");
    expect(r.errors[0]?.pointer).toBe("/operation/entry_points/0/path");
  });

  it("flags structured source.path that escape", () => {
    const doc = { substance: { capabilities: [{ phrase: "x", source: { path: "../escape", symbol: "y" } }] } };
    const r = nestedPathEscapeCheck(doc, "packages/sdk");
    expect(r.errors[0]?.code).toBe("nested-path-escape");
    expect(r.errors[0]?.pointer).toBe("/substance/capabilities/0/source/path");
  });

  it("flags string-form source path that escapes (lexically)", () => {
    const doc = { substance: { capabilities: [{ phrase: "x", source: "../escape#sym" }] } };
    const r = nestedPathEscapeCheck(doc, "packages/sdk");
    expect(r.errors[0]?.code).toBe("nested-path-escape");
    expect(r.errors[0]?.pointer).toBe("/substance/capabilities/0/source");
  });

  it("permits paths that lexically descend then ascend within scope", () => {
    const doc = { structure: { entries: [{ path: "src/../README.md", purpose: "x", kind: "docs" }] } };
    expect(nestedPathEscapeCheck(doc, "packages/sdk").errors).toEqual([]);
  });

  it("returns no errors when anatomyDir is empty (root anatomy) — anything relative stays in root", () => {
    const doc = { structure: { entries: [{ path: "src/", purpose: "x", kind: "source" }] } };
    expect(nestedPathEscapeCheck(doc, "").errors).toEqual([]);
  });

  it("flags root anatomy with an escaping path (../something is outside repoRoot)", () => {
    const doc = { structure: { entries: [{ path: "../escape", purpose: "x", kind: "source" }] } };
    const r = nestedPathEscapeCheck(doc, "");
    expect(r.errors[0]?.code).toBe("nested-path-escape");
  });
});

describe("commandsNoTestWarn", () => {
  it("no warning for v0.1 even when commands has no test key", () => {
    const doc = {
      anatomy_version: "0.1",
      operation: { commands: { install: "cargo build", run: "cargo run" } },
    };
    expect(commandsNoTestWarn(doc).warnings).toEqual([]);
  });

  it("no warning for v0.2 even when commands has no test key", () => {
    const doc = {
      anatomy_version: "0.2",
      operation: { commands: { install: "cargo build" } },
    };
    expect(commandsNoTestWarn(doc).warnings).toEqual([]);
  });

  it("no warning for v0.3 (not a wire version, but explicit boundary)", () => {
    // v0.3 is not in APPLICABLE_VERSIONS — the check applies only from v0.4+
    // when operation.commands became a recommended convention. v0.3 is an
    // ecosystem release, not a wire version, but the check should still skip
    // it cleanly if a doc somehow declares it.
    const doc = {
      anatomy_version: "0.3",
      operation: { commands: { install: "cargo build" } },
    };
    expect(commandsNoTestWarn(doc).warnings).toEqual([]);
  });

  it("no warning for v0.4 when commands has a test key", () => {
    const doc = {
      anatomy_version: "0.4",
      operation: { commands: { install: "cargo build", test: "cargo test" } },
    };
    expect(commandsNoTestWarn(doc).warnings).toEqual([]);
  });

  it("emits warning for v0.4 when commands has no test key", () => {
    const doc = {
      anatomy_version: "0.4",
      operation: { commands: { install: "cargo build", lint: "cargo clippy" } },
    };
    const r = commandsNoTestWarn(doc);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0].code).toBe("commands-no-test");
    expect(r.warnings[0].pointer).toBe("/operation/commands");
    expect(r.errors).toEqual([]);
  });

  it("emits warning for v0.5/0.6/0.7 too", () => {
    for (const v of ["0.5", "0.6", "0.7"]) {
      const doc = { anatomy_version: v, operation: { commands: { install: "x" } } };
      const r = commandsNoTestWarn(doc);
      expect(r.warnings[0]?.code).toBe("commands-no-test");
    }
  });

  it("no warning when [operation.commands] is absent", () => {
    const doc = { anatomy_version: "0.4", operation: {} };
    expect(commandsNoTestWarn(doc).warnings).toEqual([]);
  });

  it("no warning when [operation] is absent", () => {
    const doc = { anatomy_version: "0.4" };
    expect(commandsNoTestWarn(doc).warnings).toEqual([]);
  });

  it("no warning when commands is empty (schema handles)", () => {
    const doc = { anatomy_version: "0.4", operation: { commands: {} } };
    expect(commandsNoTestWarn(doc).warnings).toEqual([]);
  });

  it("does not match a key that merely starts with 'test' (e.g. 'test.unit')", () => {
    const doc = {
      anatomy_version: "0.4",
      operation: { commands: { "test.unit": "cargo test --lib", install: "cargo build" } },
    };
    const r = commandsNoTestWarn(doc);
    expect(r.warnings[0]?.code).toBe("commands-no-test");
  });

  it("matches plain 'test' even alongside namespaced test.* keys", () => {
    const doc = {
      anatomy_version: "0.4",
      operation: { commands: { test: "cargo test", "test.unit": "cargo test --lib" } },
    };
    expect(commandsNoTestWarn(doc).warnings).toEqual([]);
  });

  it("no warning for unknown anatomy_version", () => {
    const doc = { anatomy_version: "9.9", operation: { commands: { install: "x" } } };
    expect(commandsNoTestWarn(doc).warnings).toEqual([]);
  });

  it("no warning when anatomy_version is missing", () => {
    const doc = { operation: { commands: { install: "x" } } };
    expect(commandsNoTestWarn(doc).warnings).toEqual([]);
  });
});

describe("descriptionWarnCheck", () => {
  it("returns no warnings for a short description", () => {
    const result = descriptionWarnCheck({ description: "short" });
    expect(result.warnings).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it("emits description-too-long when description.length > 500", () => {
    const result = descriptionWarnCheck({ description: "x".repeat(501) });
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0].code).toBe("description-too-long");
    expect(result.warnings[0].pointer).toBe("/description");
  });

  it("returns no warning at exactly 500", () => {
    const result = descriptionWarnCheck({ description: "x".repeat(500) });
    expect(result.warnings).toEqual([]);
  });

  it("returns no warnings when description is missing or non-string", () => {
    expect(descriptionWarnCheck({}).warnings).toEqual([]);
    expect(descriptionWarnCheck({ description: 42 }).warnings).toEqual([]);
  });
});
