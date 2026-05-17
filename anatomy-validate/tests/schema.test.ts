import { describe, it, expect } from "vitest";
import { compiledSchemas, supportedVersions } from "../src/schema.js";

const compiledSchema = compiledSchemas.get("0.1")!;

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

describe("schema", () => {
  it("compiles strict-log clean (compiledSchema is a function)", () => {
    expect(typeof compiledSchema).toBe("function");
  });

  it("validates a minimal correct doc", () => {
    expect(compiledSchema(validDoc)).toBe(true);
  });

  it("rejects a doc missing identity.stack with a 'required' error", () => {
    const doc = JSON.parse(JSON.stringify(validDoc));
    delete doc.identity.stack;
    expect(compiledSchema(doc)).toBe(false);
    expect(compiledSchema.errors).toBeDefined();
    expect(compiledSchema.errors!.some(e => e.keyword === "required")).toBe(true);
  });
});

describe("multi-version schema loading", () => {
  it("supports v0.1, v0.2, v0.4, v0.5, v0.6, v0.7, v0.8, v0.9, v0.10, v0.11, v0.12, v0.13, v0.14, v0.15, and v1.0", () => {
    expect(supportedVersions).toEqual(["0.1", "0.2", "0.4", "0.5", "0.6", "0.7", "0.8", "0.9", "0.10", "0.11", "0.12", "0.13", "0.14", "0.15", "1.0"]);
  });

  it("compiledSchemas has a function for each supported version", () => {
    for (const v of supportedVersions) {
      expect(typeof compiledSchemas.get(v)).toBe("function");
    }
  });

  it("v0.2 schema validates a minimal v0.2 doc", () => {
    const v02 = compiledSchemas.get("0.2")!;
    const doc = {
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
    expect(v02(doc)).toBe(true);
  });

  it("v0.2 schema rejects a v0.2 doc missing tagline", () => {
    const v02 = compiledSchemas.get("0.2")!;
    const doc = {
      anatomy_version: "0.2",
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
    expect(v02(doc)).toBe(false);
    expect(v02.errors!.some(e => e.keyword === "required" && e.params?.missingProperty === "tagline")).toBe(true);
  });
});
