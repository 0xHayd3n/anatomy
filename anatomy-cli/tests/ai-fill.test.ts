import { describe, it, expect } from "vitest";
import { applyAiFill, buildTodoManifest, countTodos, extractJson } from "../src/pass2/index.js";
import type { Pass1Result } from "../src/types.js";

function makeResult(overrides: Partial<Pass1Result> = {}): Pass1Result {
  return {
    manifest: null,
    identity: {
      stack: { id: "typescript", isPlaceholder: false },
      form: { id: "typescript-cli-tool", isPlaceholder: false },
      domain: { id: "todo-domain", isPlaceholder: true },
      function: { id: "todo-function", isPlaceholder: true },
      fingerprint: "10zdvr75c1f2tys77axn",
    },
    tagline: { value: "A test tool", isPlaceholder: false, source: "readme" },
    operation: { entryPoints: [], commands: {} },
    substance: { keyDependencies: [] },
    structure: { entries: [] },
    generatedAt: "2026-01-01T00:00:00.000Z",
    generatorId: "@anatomy/cli@0.7.0",
    ...overrides,
  };
}

describe("applyAiFill — identity_stack_override", () => {
  it("overrides Pass 1 stack/form when override has new_stack + new_form + evidence", () => {
    // Alamofire-shape: Pass 1 wrongly picked ruby because Gemfile beat
    // Package.swift in detect-order. Pass 2 sees the Source/ tree and
    // overrides via identity_stack_override.
    const r = applyAiFill(makeResult({
      identity: {
        stack: { id: "ruby", isPlaceholder: false },
        form: { id: "ruby-library", isPlaceholder: false },
        domain: { id: "todo-domain", isPlaceholder: true },
        function: { id: "todo-function", isPlaceholder: true },
        fingerprint: "x".repeat(20),
      },
    }), {
      identity_stack_override: {
        new_stack: "swift",
        new_form: "swift-library",
        evidence: "Source/ contains 47 .swift files; Package.swift declares .library product",
      },
      identity_domain: "ios-networking",
      identity_function: "http-client",
    });
    expect(r.identity.stack.id).toBe("swift");
    expect(r.identity.stack.isPlaceholder).toBe(false);
    expect(r.identity.form.id).toBe("swift-library");
    expect(r.identity.form.isPlaceholder).toBe(false);
    // Fingerprint must reflect the new pillars — important for downstream
    // staleness/cache logic.
    expect(r.identity.fingerprint).not.toBe("x".repeat(20));
    expect(r.identity.fingerprint).toHaveLength(20);
  });

  it("ignores override when evidence is missing", () => {
    const r = applyAiFill(makeResult({
      identity: {
        stack: { id: "ruby", isPlaceholder: false },
        form: { id: "ruby-library", isPlaceholder: false },
        domain: { id: "todo-domain", isPlaceholder: true },
        function: { id: "todo-function", isPlaceholder: true },
        fingerprint: "originalfingerprint20",
      },
    }), {
      identity_stack_override: {
        new_stack: "swift",
        new_form: "swift-library",
        evidence: "",
      },
    });
    expect(r.identity.stack.id).toBe("ruby");
    expect(r.identity.form.id).toBe("ruby-library");
  });

  it("ignores override when evidence > 200 chars", () => {
    const r = applyAiFill(makeResult({
      identity: {
        stack: { id: "ruby", isPlaceholder: false },
        form: { id: "ruby-library", isPlaceholder: false },
        domain: { id: "todo-domain", isPlaceholder: true },
        function: { id: "todo-function", isPlaceholder: true },
        fingerprint: "x".repeat(20),
      },
    }), {
      identity_stack_override: {
        new_stack: "swift",
        new_form: "swift-library",
        evidence: "a".repeat(201),
      },
    });
    expect(r.identity.stack.id).toBe("ruby");
  });

  it("ignores override when new_stack does not canonicalize", () => {
    // Garbage slug like "Not A Stack" should not override ruby.
    const r = applyAiFill(makeResult({
      identity: {
        stack: { id: "ruby", isPlaceholder: false },
        form: { id: "ruby-library", isPlaceholder: false },
        domain: { id: "todo-domain", isPlaceholder: true },
        function: { id: "todo-function", isPlaceholder: true },
        fingerprint: "x".repeat(20),
      },
    }), {
      identity_stack_override: {
        new_stack: "Not A Stack!",
        new_form: "swift-library",
        evidence: "Source/ has .swift files",
      },
    });
    expect(r.identity.stack.id).toBe("ruby");
  });

  it("override stomps any same-call identity_stack/identity_form when both are present", () => {
    // Defensive: model is told they're mutually exclusive, but if it sends
    // both, the override wins (Pass 1 stack is non-placeholder so the bare
    // identity_stack would be ignored anyway, but covering the explicit case).
    const r = applyAiFill(makeResult({
      identity: {
        stack: { id: "todo-stack", isPlaceholder: true },
        form: { id: "todo-form", isPlaceholder: true },
        domain: { id: "todo-domain", isPlaceholder: true },
        function: { id: "todo-function", isPlaceholder: true },
        fingerprint: "x".repeat(20),
      },
    }), {
      identity_stack: "ruby",
      identity_form: "ruby-library",
      identity_stack_override: {
        new_stack: "swift",
        new_form: "swift-library",
        evidence: "Source/*.swift, Package.swift declares product",
      },
    });
    expect(r.identity.stack.id).toBe("swift");
    expect(r.identity.form.id).toBe("swift-library");
  });
});

describe("applyAiFill — identity", () => {
  it("fills domain and function from filled values", () => {
    const r = applyAiFill(makeResult(), {
      identity_domain: "developer-tools",
      identity_function: "code-analyzer",
    });
    expect(r.identity.domain.id).toBe("developer-tools");
    expect(r.identity.domain.isPlaceholder).toBe(false);
    expect(r.identity.function.id).toBe("code-analyzer");
    expect(r.identity.function.isPlaceholder).toBe(false);
  });

  it("fills stack/form when Pass 1 returned placeholders (no-manifest case)", () => {
    const noManifest = makeResult({
      identity: {
        stack: { id: "todo-stack", isPlaceholder: true },
        form: { id: "todo-form", isPlaceholder: true },
        domain: { id: "todo-domain", isPlaceholder: true },
        function: { id: "todo-function", isPlaceholder: true },
        fingerprint: "x".repeat(20),
      },
    });
    const r = applyAiFill(noManifest, {
      identity_stack: "csharp",
      identity_form: "csharp-desktop-app",
      identity_domain: "content-creation",
      identity_function: "video-publisher",
    });
    expect(r.identity.stack.id).toBe("csharp");
    expect(r.identity.stack.isPlaceholder).toBe(false);
    expect(r.identity.form.id).toBe("csharp-desktop-app");
    expect(r.identity.form.isPlaceholder).toBe(false);
    // Fingerprint reflects the new pillars.
    expect(r.identity.fingerprint).toHaveLength(20);
    expect(r.identity.fingerprint).not.toBe("x".repeat(20));
  });

  it("does NOT override Pass 1 stack/form when they are already non-placeholder", () => {
    const r = applyAiFill(makeResult(), {
      identity_stack: "javascript",  // would override typescript
      identity_form: "javascript-library",  // would override typescript-cli-tool
    });
    // Pass 1 wins on a real manifest detection.
    expect(r.identity.stack.id).toBe("typescript");
    expect(r.identity.form.id).toBe("typescript-cli-tool");
  });

  it("recomputes fingerprint after domain+function update", () => {
    const before = makeResult();
    const after = applyAiFill(before, {
      identity_domain: "developer-tools",
      identity_function: "code-analyzer",
    });
    expect(after.identity.fingerprint).toHaveLength(20);
    expect(after.identity.fingerprint).not.toBe(before.identity.fingerprint);
  });

  it("ignores non-canonical identity values", () => {
    const r = applyAiFill(makeResult(), { identity_domain: "INVALID CAPS!!!" });
    expect(r.identity.domain.isPlaceholder).toBe(true);
  });
});

describe("applyAiFill — interface subcommands", () => {
  it("fills subcommand summaries keyed by name", () => {
    const result = makeResult({
      interface: {
        variant: "subcommands",
        entries: [
          { name: "validate", summary: "TODO describe subcommand", isPlaceholder: true },
          { name: "generate", summary: "TODO describe subcommand", isPlaceholder: true },
        ],
      },
    });
    const r = applyAiFill(result, {
      interface_summaries: {
        validate: "Validates a .anatomy file against the schema.",
        generate: "Generates a starter .anatomy from repo metadata.",
      },
    });
    expect(r.interface?.variant).toBe("subcommands");
    if (r.interface?.variant === "subcommands") {
      expect(r.interface.entries[0].summary).toBe("Validates a .anatomy file against the schema.");
      expect(r.interface.entries[0].isPlaceholder).toBe(false);
      expect(r.interface.entries[1].summary).toBe("Generates a starter .anatomy from repo metadata.");
    }
  });

  it("does not modify non-placeholder entries", () => {
    const result = makeResult({
      interface: {
        variant: "subcommands",
        entries: [
          { name: "run", summary: "Already filled.", isPlaceholder: false },
        ],
      },
    });
    const r = applyAiFill(result, {
      interface_summaries: { run: "New value that should be ignored." },
    });
    if (r.interface?.variant === "subcommands") {
      expect(r.interface.entries[0].summary).toBe("Already filled.");
    }
  });

  it("truncates summaries longer than 120 chars", () => {
    const longSummary = "x".repeat(200);
    const result = makeResult({
      interface: {
        variant: "subcommands",
        entries: [{ name: "cmd", summary: "TODO describe subcommand", isPlaceholder: true }],
      },
    });
    const r = applyAiFill(result, { interface_summaries: { cmd: longSummary } });
    if (r.interface?.variant === "subcommands") {
      expect(r.interface.entries[0].summary).toHaveLength(120);
    }
  });
});

describe("applyAiFill — interface exports", () => {
  it("fills export summaries keyed by symbol", () => {
    const result = makeResult({
      interface: {
        variant: "exports",
        entries: [
          { symbol: ".", kind: "namespace", summary: "TODO describe export", isPlaceholder: true },
          { symbol: "validate", kind: "function", summary: "TODO describe export", isPlaceholder: true },
        ],
      },
    });
    const r = applyAiFill(result, {
      interface_summaries: {
        ".": "Root namespace export.",
        "validate": "Validates a TOML string against the anatomy schema.",
      },
    });
    expect(r.interface?.variant).toBe("exports");
    if (r.interface?.variant === "exports") {
      expect(r.interface.entries[0].summary).toBe("Root namespace export.");
      expect(r.interface.entries[0].isPlaceholder).toBe(false);
      expect(r.interface.entries[1].summary).toBe("Validates a TOML string against the anatomy schema.");
    }
  });
});

describe("extractJson", () => {
  it("parses a plain JSON object", () => {
    const r = extractJson('{"identity_domain":"developer-tools"}');
    expect(r.identity_domain).toBe("developer-tools");
  });

  it("strips markdown fences before parsing", () => {
    const r = extractJson('```json\n{"identity_domain":"cli-tooling"}\n```');
    expect(r.identity_domain).toBe("cli-tooling");
  });

  it("extracts the first {...} block from surrounding prose", () => {
    const r = extractJson('Here is the result:\n{"identity_domain":"runtime-tools"}\nDone.');
    expect(r.identity_domain).toBe("runtime-tools");
  });

  it("throws on unparseable input", () => {
    expect(() => extractJson("not json at all")).toThrow(/could not parse JSON/);
  });

  it("strips __proto__ keys via safeReviver", () => {
    const r = extractJson('{"identity_domain":"x","__proto__":{"polluted":true}}');
    expect(r.identity_domain).toBe("x");
    // __proto__ must not be present as an own property
    expect(Object.prototype.hasOwnProperty.call(r, "__proto__")).toBe(false);
  });
});

describe("countTodos", () => {
  // makeResult() defaults identity.domain + identity.function to isPlaceholder: true,
  // so use this fully-resolved identity when we need a 0-placeholder baseline.
  const filledIdentity: Pass1Result["identity"] = {
    stack: { id: "typescript", isPlaceholder: false },
    form: { id: "typescript-cli-tool", isPlaceholder: false },
    domain: { id: "developer-tools", isPlaceholder: false },
    function: { id: "code-analyzer", isPlaceholder: false },
    fingerprint: "10zdvr75c1f2tys77axn",
  };

  it("returns 0 when nothing is a placeholder", () => {
    const r = makeResult({ identity: filledIdentity });
    expect(countTodos(r)).toBe(0);
  });

  it("increments by 1 for placeholder identity.domain", () => {
    const r = makeResult({
      identity: { ...filledIdentity, domain: { id: "todo-domain", isPlaceholder: true } },
    });
    expect(countTodos(r)).toBe(1);
  });

  it("increments by 1 for placeholder identity.function", () => {
    const r = makeResult({
      identity: { ...filledIdentity, function: { id: "todo-function", isPlaceholder: true } },
    });
    expect(countTodos(r)).toBe(1);
  });

  it("counts only placeholder structure entries", () => {
    const r = makeResult({
      identity: filledIdentity,
      structure: {
        entries: [
          { path: "src/a", purpose: "TODO", isPlaceholder: true },
          { path: "src/b", purpose: "TODO", isPlaceholder: true },
          { path: "src/c", purpose: "Already known.", isPlaceholder: false },
        ],
      },
    });
    expect(countTodos(r)).toBe(2);
  });

  it("counts only placeholder substance.keyDependencies entries", () => {
    const r = makeResult({
      identity: filledIdentity,
      substance: {
        keyDependencies: [
          { name: "vitest", why: "TODO", isPlaceholder: true },
          { name: "zod", why: "Schema validation.", isPlaceholder: false },
          { name: "commander", why: "TODO", isPlaceholder: true },
        ],
      },
    });
    expect(countTodos(r)).toBe(2);
  });

  it("counts only placeholder interface.entries (subcommands variant)", () => {
    const r = makeResult({
      identity: filledIdentity,
      interface: {
        variant: "subcommands",
        entries: [
          { name: "validate", summary: "TODO", isPlaceholder: true },
          { name: "generate", summary: "Already filled.", isPlaceholder: false },
          { name: "run", summary: "TODO", isPlaceholder: true },
        ],
      },
    });
    expect(countTodos(r)).toBe(2);
  });

  it("sums placeholders across all sections", () => {
    const r = makeResult({
      // identity.domain + identity.function default-placeholder = 2
      structure: {
        entries: [{ path: "src/a", purpose: "TODO", isPlaceholder: true }],
      },
      substance: {
        keyDependencies: [{ name: "vitest", why: "TODO", isPlaceholder: true }],
      },
      interface: {
        variant: "subcommands",
        entries: [{ name: "run", summary: "TODO", isPlaceholder: true }],
      },
    });
    expect(countTodos(r)).toBe(5);
  });
});

describe("buildTodoManifest", () => {
  const filledIdentity: Pass1Result["identity"] = {
    stack: { id: "typescript", isPlaceholder: false },
    form: { id: "typescript-cli-tool", isPlaceholder: false },
    domain: { id: "developer-tools", isPlaceholder: false },
    function: { id: "code-analyzer", isPlaceholder: false },
    fingerprint: "10zdvr75c1f2tys77axn",
  };

  it("always emits the '## Fields to fill' header", () => {
    const m = buildTodoManifest(makeResult({ identity: filledIdentity }));
    expect(m).toContain("## Fields to fill");
  });

  it("includes the identity.domain line when domain is placeholder", () => {
    const m = buildTodoManifest(makeResult({
      identity: { ...filledIdentity, domain: { id: "todo-domain", isPlaceholder: true } },
    }));
    expect(m).toContain("- identity.domain");
    expect(m).not.toContain("- identity.function");
  });

  it("includes the identity.function line when function is placeholder", () => {
    const m = buildTodoManifest(makeResult({
      identity: { ...filledIdentity, function: { id: "todo-function", isPlaceholder: true } },
    }));
    expect(m).toContain("- identity.function");
    expect(m).not.toContain("- identity.domain");
  });

  it("lists only placeholder dirs in the structure-purposes line", () => {
    const m = buildTodoManifest(makeResult({
      identity: filledIdentity,
      structure: {
        entries: [
          { path: "src/a", purpose: "TODO", isPlaceholder: true },
          { path: "src/b", purpose: "Already known.", isPlaceholder: false },
          { path: "src/c", purpose: "TODO", isPlaceholder: true },
        ],
      },
    }));
    expect(m).toContain("- structure purposes for: src/a, src/c");
    expect(m).not.toContain("src/b");
  });

  it("lists only placeholder deps in the dependency-whys line", () => {
    const m = buildTodoManifest(makeResult({
      identity: filledIdentity,
      substance: {
        keyDependencies: [
          { name: "vitest", why: "TODO", isPlaceholder: true },
          { name: "zod", why: "Schema validation.", isPlaceholder: false },
          { name: "commander", why: "TODO", isPlaceholder: true },
        ],
      },
    }));
    expect(m).toContain("- dependency whys for: vitest, commander");
    expect(m).not.toContain("zod");
  });

  it("always emits the rules/flows/decisions line", () => {
    const m = buildTodoManifest(makeResult({ identity: filledIdentity }));
    expect(m).toContain("- rules, flows, decisions (uncapturable architectural knowledge)");
  });

  it("emits the '## Already known' section with stack, form, and tagline", () => {
    const m = buildTodoManifest(makeResult({
      identity: filledIdentity,
      tagline: { value: "A test tool", isPlaceholder: false, source: "readme" },
    }));
    expect(m).toContain("## Already known");
    expect(m).toContain("stack: typescript, form: typescript-cli-tool");
    expect(m).toContain("tagline: A test tool");
  });

  it("omits the tagline line when tagline is a placeholder", () => {
    const m = buildTodoManifest(makeResult({
      identity: filledIdentity,
      tagline: { value: "TODO", isPlaceholder: true, source: "missing" },
    }));
    expect(m).toContain("## Already known");
    expect(m).not.toContain("tagline:");
  });

  it("includes interface subcommand summaries line for placeholder entries", () => {
    const m = buildTodoManifest(makeResult({
      identity: filledIdentity,
      interface: {
        variant: "subcommands",
        entries: [
          { name: "validate", summary: "TODO", isPlaceholder: true },
          { name: "run", summary: "Already filled.", isPlaceholder: false },
        ],
      },
    }));
    expect(m).toContain("- interface subcommand summaries for: validate");
    expect(m).not.toContain("run");
  });
});
