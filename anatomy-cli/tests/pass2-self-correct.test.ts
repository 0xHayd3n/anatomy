// Tests for the Pass 2 self-correct retry path. The retry itself lives in
// generate.ts; this file covers the EnrichOptions.priorErrors plumbing inside
// enrichWithAI and the prompt-content guarantees needed to make recovery work.

import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ValidationError } from "@anatomytool/validate";
import { runPass1 } from "../src/pass1/index.js";
import { enrichWithAI } from "../src/pass2/index.js";

function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "anat-p2sc-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({
    name: "demo", version: "1.0.0", description: "Demo lib for self-correct test.",
    main: "./index.js", scripts: { test: "vitest" },
  }));
  mkdirSync(join(root, "src"));
  return root;
}

describe("Pass 2 system prompt — length-limit guidance (B1)", () => {
  it("system prompt declares HARD LIMITS for identity fields capped at 40 chars", async () => {
    const root = makeRepo();
    const pass1 = runPass1(root);
    const r = await enrichWithAI(pass1, root, { printPromptOnly: true });
    const sys = r.prompt!.systemPrompt;
    expect(sys).toMatch(/HARD LIMITS/);
    expect(sys).toMatch(/identity_stack\s+≤\s*40\s*chars/);
    expect(sys).toMatch(/identity_form\s+≤\s*40\s*chars/);
    expect(sys).toMatch(/identity_domain\s+≤\s*40\s*chars/);
    expect(sys).toMatch(/identity_function\s+≤\s*40\s*chars/);
    expect(sys).toMatch(/PREFER short slugs/);
  });
});

describe("enrichWithAI — priorErrors threading (B2)", () => {
  it("user prompt does NOT contain a VALIDATION FAILED block by default", async () => {
    const root = makeRepo();
    const pass1 = runPass1(root);
    const r = await enrichWithAI(pass1, root, { printPromptOnly: true });
    expect(r.prompt!.userPrompt).not.toMatch(/VALIDATION FAILED/);
  });

  it("user prompt appends a VALIDATION FAILED block listing each prior error", async () => {
    const root = makeRepo();
    const pass1 = runPass1(root);
    const priorErrors: ValidationError[] = [
      {
        code: "schema-violation",
        pointer: "/identity/function",
        message: "must NOT have more than 40 characters",
      },
      {
        code: "schema-violation",
        pointer: "/identity/domain",
        message: "must NOT have more than 40 characters",
      },
    ];
    const r = await enrichWithAI(pass1, root, { printPromptOnly: true, priorErrors });
    const userPrompt = r.prompt!.userPrompt;

    expect(userPrompt).toMatch(/VALIDATION FAILED/);
    expect(userPrompt).toContain("/identity/function");
    expect(userPrompt).toContain("/identity/domain");
    expect(userPrompt).toContain("must NOT have more than 40 characters");
    // Closing instruction must call out the 40-char cap so the model knows
    // *which* constraint to fix (not just "fix something").
    expect(userPrompt).toMatch(/40 characters/i);
  });

  it("priorErrors with empty array behaves the same as omitting the option", async () => {
    const root = makeRepo();
    const pass1 = runPass1(root);
    const a = await enrichWithAI(pass1, root, { printPromptOnly: true });
    const b = await enrichWithAI(pass1, root, { printPromptOnly: true, priorErrors: [] });
    expect(b.prompt!.userPrompt).toBe(a.prompt!.userPrompt);
  });

  it("VALIDATION FAILED block appears AFTER the original context (not interleaved)", async () => {
    // The retry prompt is structured as: fields-to-fill + repo context FIRST,
    // then the correction block at the END. Otherwise the model can't see the
    // structural context it needs to fix without scrolling past the errors.
    const root = makeRepo();
    const pass1 = runPass1(root);
    const priorErrors: ValidationError[] = [{
      code: "schema-violation",
      pointer: "/identity/function",
      message: "must NOT have more than 40 characters",
    }];
    const r = await enrichWithAI(pass1, root, { printPromptOnly: true, priorErrors });
    const up = r.prompt!.userPrompt;
    const ctxIdx = up.indexOf("Fill in the TODO fields");
    const errBlockIdx = up.indexOf("VALIDATION FAILED");
    expect(ctxIdx).toBeGreaterThanOrEqual(0);
    expect(errBlockIdx).toBeGreaterThan(ctxIdx);
  });
});
