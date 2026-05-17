import { describe, it, expect } from "vitest";
import { parseAnatomyToml } from "../src/parse.js";

const minimalDoc = `anatomy_version = "0.1"
description = "x"

[identity]
fingerprint = "00000000000000000000"

[identity.stack]
id = "rust"
hash = "00000"

[identity.form]
id = "cli-tool"
hash = "00000"

[identity.domain]
id = "web-publishing"
hash = "00000"

[identity.function]
id = "markdown-to-static-html"
hash = "00000"

[generated]
at = 2026-05-05T14:22:00Z
by = "x"
model = "x"
schema = "https://example.com"
`;

describe("parseAnatomyToml", () => {
  it("parses minimal valid TOML to ok:true", () => {
    const result = parseAnatomyToml(minimalDoc);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.anatomy_version).toBe("0.1");
    }
  });

  it("normalizes TomlDate to RFC 3339 ISO string", () => {
    const result = parseAnatomyToml(minimalDoc);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const at = (result.doc as { generated: { at: unknown } }).generated.at;
      expect(typeof at).toBe("string");
      // toISOString format: 2026-05-05T14:22:00.000Z
      expect(at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
  });

  it("returns toml-parse-error on invalid syntax", () => {
    const result = parseAnatomyToml("this is = = invalid");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("toml-parse-error");
      expect(result.error.pointer).toBe("");
    }
  });

  it("populates source.line and source.column on parse error", () => {
    const result = parseAnatomyToml('foo = bar\nbaz = "x"\n');
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.source) {
      expect(typeof result.error.source.line).toBe("number");
      expect(typeof result.error.source.column).toBe("number");
    }
  });
});
