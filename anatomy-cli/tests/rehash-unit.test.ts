import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("@anatomytool/validate", () => ({
  validate: vi.fn().mockResolvedValue({
    ok: false,
    errors: [{ code: "TEST", pointer: "/", message: "mock validation error" }],
    warnings: [],
  }),
}));

import { rehashCommand } from "../src/commands/rehash.js";

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

const V015_WRONG_FP = `\
anatomy_version = "0.15"
tagline = "A minimal test repo."

[identity]
stack = "rust"
form = "cli-tool"
domain = "web-publishing"
function = "markdown-to-static-html"
fingerprint = "00000000000000000000"

[generated]
at = 2026-05-05T14:22:00.000Z
by = "anatomy-cli@0.3.2"
model = "claude-sonnet-4-6"
schema = "https://anatomy.dev/spec/0.15/schema.json"
`;

describe("rehash — validation gate", () => {
  it("returns exit code 3 when validate rejects the recomputed output", async () => {
    const root = mkdtempSync(join(tmpdir(), "anat-rh-unit-"));
    writeFileSync(join(root, ".anatomy"), STALE_DOMAIN);
    expect(await rehashCommand(join(root, ".anatomy"))).toBe(3);
  });
});

describe("rehash — flat identity version routing (v0.7+)", () => {
  it("routes a v0.15 flat-identity file to the flat recompute branch", async () => {
    // The flat branch recomputes the fingerprint and reaches the (mocked-
    // failing) validation gate → exit 3. The pre-fix bug keyed routing on a
    // hardcoded version set ending at 0.13, so v0.15 fell into the nested
    // branch and bailed with exit 1 ("identity.stack missing").
    const root = mkdtempSync(join(tmpdir(), "anat-rh-v015-"));
    writeFileSync(join(root, ".anatomy"), V015_WRONG_FP);
    expect(await rehashCommand(join(root, ".anatomy"))).toBe(3);
  });
});
