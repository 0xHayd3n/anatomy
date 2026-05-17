// src/verify-suggest/write.ts
// Text-surgical insertion of `verify = { ... }` into a specific [[rules]]
// block within .anatomy. Preserves section order, comments, and whitespace.
// Also handles the side-effect of copying a registry's yaml into the user's
// repo at .semgrep/<id>.yml when a semgrep candidate is accepted.

import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { VerifyCandidate } from "./types.js";

function hashPathShort(path: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < path.length; i++) {
    h ^= path.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0").slice(0, 8);
}

function serializeVerify(candidate: VerifyCandidate, anatomyDir: string): { line: string; sideEffect?: () => void } {
  if (candidate.kind === "glob_exists") {
    const should = candidate.should_not ? `, should_not = true` : ``;
    return { line: `verify = { kind = "glob_exists", path = "${candidate.path}"${should} }` };
  }
  if (candidate.kind === "ast_pattern") {
    const target = candidate.expect_in ? `expect_in = "${candidate.expect_in}"` : `forbid_in = "${candidate.forbid_in}"`;
    return {
      line: `verify = { kind = "ast_pattern", lang = "${candidate.lang}", pattern = "${candidate.pattern.replace(/"/g, '\\"')}", ${target} }`,
    };
  }
  // semgrep
  if (candidate.rule_file) {
    const srcPath = candidate.rule_file;
    const fname = basename(srcPath);
    const hash = hashPathShort(srcPath);
    const destRel = `.semgrep/${hash}-${fname}`;
    const destAbs = join(anatomyDir, destRel);
    return {
      line: `verify = { kind = "semgrep", rule_file = "${destRel}" }`,
      sideEffect: () => {
        if (!existsSync(destAbs)) {
          mkdirSync(dirname(destAbs), { recursive: true });
          copyFileSync(srcPath, destAbs);
        }
      },
    };
  }
  // inline semgrep pattern
  if (!candidate.lang || !candidate.pattern) {
    throw new Error("semgrep candidate without rule_file requires both lang and pattern");
  }
  const target = candidate.expect_in ? `expect_in = "${candidate.expect_in}"` : `forbid_in = "${candidate.forbid_in}"`;
  return {
    line: `verify = { kind = "semgrep", lang = "${candidate.lang}", pattern = "${candidate.pattern.replace(/"/g, '\\"')}", ${target} }`,
  };
}

export async function applyToAnatomy(
  anatomyDir: string,
  ruleIndex: number,
  candidate: VerifyCandidate,
): Promise<void> {
  const anatomyPath = join(anatomyDir, ".anatomy");
  const text = readFileSync(anatomyPath, "utf8");
  const lines = text.split(/\r?\n/);
  const lineEnding = text.includes("\r\n") ? "\r\n" : "\n";

  // Find the start line of the Nth [[rules]] block.
  let blockCount = -1;
  let blockStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\[\[rules\]\]\s*(#.*)?$/.test(lines[i])) {
      blockCount++;
      if (blockCount === ruleIndex) {
        blockStart = i;
        break;
      }
    }
  }
  if (blockStart === -1) {
    throw new Error(`could not locate rule ${ruleIndex} — file may have been edited externally`);
  }

  // Find the end of the block: next [[ or [section or end of file.
  let blockEnd = lines.length;
  for (let j = blockStart + 1; j < lines.length; j++) {
    if (/^\[[\[a-z]/.test(lines[j])) { blockEnd = j; break; }
  }

  // Skip if verify already exists in this block (defensive).
  for (let j = blockStart + 1; j < blockEnd; j++) {
    if (/^verify\s*=/.test(lines[j])) return;
  }

  // Find the last non-blank line in this block — we insert right after it.
  let insertAfter = blockStart;
  for (let j = blockEnd - 1; j > blockStart; j--) {
    if (lines[j].trim().length > 0) { insertAfter = j; break; }
  }

  const { line, sideEffect } = serializeVerify(candidate, anatomyDir);
  if (sideEffect) sideEffect();

  lines.splice(insertAfter + 1, 0, line);
  writeFileSync(anatomyPath, lines.join(lineEnding), "utf8");
}
