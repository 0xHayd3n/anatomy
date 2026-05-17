// src/pass2/context-extras.ts
// Supplemental context builders for the Pass 2 AI prompt.
// Each function returns a formatted string segment or "" if unavailable.

import { execSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { extractLocalSpecifiers, resolveSpecifier } from "../pass1/import-utils.js";

// ── Git log ──────────────────────────────────────────────────────────────────

export function buildGitLog(repoRoot: string): string {
  try {
    const log = execSync("git log --oneline -15", {
      cwd: repoRoot,
      stdio: "pipe",
      encoding: "utf8",
      timeout: 5_000,
    }).trim();
    if (!log) return "";
    return `## Recent commits\n${log}`;
  } catch {
    return "";
  }
}

// ── Test file sampler ────────────────────────────────────────────────────────

const TEST_FILE_RE = /\.test\.[jt]sx?$|\.spec\.[jt]sx?$|_test\.go$|^test_.*\.py$|^.*_test\.py$/;
const WALK_SKIP = new Set(["node_modules", ".git", "target", "dist", "build"]);

function isTestFile(name: string): boolean {
  return TEST_FILE_RE.test(name);
}

function findTestFiles(repoRoot: string): string[] {
  const results: string[] = [];
  function walk(dir: string, depth: number): void {
    if (depth > 4) return;
    let entries: import("node:fs").Dirent<string>[];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      if (ent.name.startsWith(".") || WALK_SKIP.has(ent.name)) continue;
      const full = join(dir, ent.name);
      if (ent.isDirectory()) walk(full, depth + 1);
      else if (ent.isFile() && isTestFile(ent.name)) results.push(full);
    }
  }
  walk(repoRoot, 0);
  return results;
}

export function buildTestSample(repoRoot: string, entryPointRel?: string): string {
  const testFiles = findTestFiles(repoRoot);
  if (testFiles.length === 0) return "";

  let chosen: string | undefined;

  // Prefer test file whose name contains the entry point stem
  if (entryPointRel) {
    const stem = basename(entryPointRel).replace(/\.[^.]+$/, "").toLowerCase();
    chosen = testFiles.find(f => basename(f).toLowerCase().includes(stem));
  }

  // Prefer file inside a root-level test directory
  if (!chosen) {
    chosen = testFiles.find(f => {
      const rel = relative(repoRoot, f).replace(/\\/g, "/");
      return /^(tests?|__tests__|specs?)\//.test(rel);
    });
  }

  chosen ??= testFiles[0];

  try {
    const content = readFileSync(chosen, "utf8").split("\n").slice(0, 60).join("\n").trimEnd();
    const rel = relative(repoRoot, chosen).replace(/\\/g, "/");
    return `## Test sample: ${rel}\n${content}`;
  } catch { return ""; }
}

// ── Import sampler ────────────────────────────────────────────────────────────

export function buildImportSample(repoRoot: string, entryPointRel: string, maxFiles = 3): string {
  if (!/\.[jt]sx?$/.test(entryPointRel)) return "";

  const entryPath = join(repoRoot, entryPointRel);
  let entrySource: string;
  try {
    // Read up to 80 lines to capture all imports even in large files
    entrySource = readFileSync(entryPath, "utf8").split("\n").slice(0, 80).join("\n");
  } catch { return ""; }

  const specifiers = extractLocalSpecifiers(entrySource);
  const parts: string[] = [];
  const seenPaths = new Set<string>();

  for (const spec of specifiers) {
    if (parts.length >= maxFiles) break;
    const resolved = resolveSpecifier(repoRoot, entryPointRel, spec);
    if (!resolved || seenPaths.has(resolved)) continue;
    seenPaths.add(resolved);
    try {
      const content = readFileSync(resolved, "utf8").split("\n").slice(0, 40).join("\n");
      const rel = relative(repoRoot, resolved).replace(/\\/g, "/");
      parts.push(`### ${rel}\n${content}`);
    } catch {}
  }

  if (parts.length === 0) return "";
  return `## Key source files (imported by entry point)\n${parts.join("\n\n")}`;
}
