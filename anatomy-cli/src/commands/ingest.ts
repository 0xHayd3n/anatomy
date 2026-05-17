// src/commands/ingest.ts
// `anatomy ingest [<path>]` — reads CLAUDE.md / AGENTS.md / .cursorrules /
// .windsurfrules, extracts rule-shaped bullets, runs Pass 1 for everything
// else, writes a complete v0.13 .anatomy. Refuses on existing .anatomy
// unless --force. --no-pass1 emits placeholder identity. --stdout previews
// without writing.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import { runPass1 } from "../pass1/index.js";
import { renderToml } from "../render/toml.js";
import { validate } from "@anatomytool/validate";
import { detectIngestSources, detectParser } from "../ingest/detect.js";
import { ingestRepo } from "../ingest/index.js";
import { mergeIngestIntoPass1, placeholderPass1Result } from "../ingest/merge.js";
import type { DetectedSource, IngestResult } from "../ingest/types.js";
import type { Pass1Result } from "../types.js";

export interface IngestOptions {
  inputPath?: string;
  repo?: string;
  force?: boolean;
  noPass1?: boolean;
  stdout?: boolean;
}

function fatal(message: string, exitCode = 1): never {
  process.stderr.write(`anatomy ingest: ${message}\n`);
  process.exit(exitCode);
  throw new Error("unreachable"); // for TS — process.exit returns never but spy mocks make this needed in tests
}

function printSummary(ingestResult: IngestResult, pass1: Pass1Result, anatomyPath: string): void {
  const detected = Object.keys(ingestResult.perFile);
  process.stdout.write(`Detected: ${detected.join(", ")}\n`);
  process.stdout.write(`Extracted ${ingestResult.rules.length} rules total:\n`);

  for (const file of detected) {
    const fileRules = ingestResult.rules.filter(r => r.source.file === file);
    const fileDropped = ingestResult.dropped.filter(r => r.source.file === file);
    process.stdout.write(`  ${file} (${fileRules.length} rules):\n`);
    for (const r of fileRules) {
      const truncated = r.rule.length === 300 ? " (truncated)" : "";
      process.stdout.write(`    ✓ ${r.rule.slice(0, 80)}${truncated}\n`);
    }
    for (const r of fileDropped) {
      process.stdout.write(`    ⊘ "${r.rule.slice(0, 50)}..." (deduped)\n`);
    }
  }

  const id = pass1.identity;
  process.stdout.write(
    `\nPass 1: identity = ${id.stack.id}/${id.form.id}/${id.domain.id}/${id.function.id}\n`,
  );
  process.stdout.write(`\nWrote ${anatomyPath} (validates against v0.13 schema).\n`);
  process.stdout.write(`Next step: \`anatomy generate --ai --force\` to enrich with AI-derived fields.\n`);
}

export async function ingestCommand(opts: IngestOptions): Promise<void> {
  const repoRoot = resolve(opts.repo ?? process.cwd());
  const anatomyPath = join(repoRoot, ".anatomy");

  if (existsSync(anatomyPath) && !opts.force && !opts.stdout) {
    fatal(
      `An .anatomy already exists at ${anatomyPath}. Use --force to overwrite, ` +
      `or delete it first. Use --stdout to preview without writing.`,
    );
  }

  let sources: DetectedSource[];
  if (opts.inputPath) {
    const path = resolve(opts.inputPath);
    if (!existsSync(path)) fatal(`Input file not found: ${path}`);
    const parser = detectParser(path);
    sources = [{ parser, path }];
  } else {
    sources = detectIngestSources(repoRoot);
  }

  if (sources.length === 0) {
    fatal(
      `No recognized rule files found at ${repoRoot}. ` +
      `Looked for: CLAUDE.md, AGENTS.md, .cursorrules, .windsurfrules.`,
    );
  }

  for (const s of sources) {
    const text = readFileSync(s.path, "utf8");
    if (text.trim().length === 0) {
      fatal(`Input file ${s.path} is empty. Nothing to extract.`);
    }
  }

  const ingestResult = ingestRepo(sources);

  if (ingestResult.rules.length === 0) {
    fatal(
      `No rules extracted from ${sources.map(s => basename(s.path)).join(", ")}. ` +
      `Add a section with one of these headings: Rules, Conventions, Guidelines, ` +
      `Code style, Code conventions, Project conventions, Coding rules, ` +
      `Coding conventions, Code guidelines.`,
    );
  }

  let pass1: Pass1Result;
  try {
    pass1 = opts.noPass1 ? placeholderPass1Result() : runPass1(repoRoot);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fatal(
      `Pass 1 failed: ${msg}\n` +
      `Try --no-pass1 to skip identity/environment/structure detection and emit ` +
      `placeholder values, then hand-fill them.`,
    );
  }

  const merged = mergeIngestIntoPass1(pass1, ingestResult.rules);
  const tomlText = renderToml(merged, { anatomyVersion: "1.0" });

  if (!opts.stdout) {
    const result = await validate(tomlText);
    if (!result.ok) {
      fatal(
        `Ingested .anatomy failed validation:\n` +
        result.errors.map(e => `  ${e.code}: ${e.message}`).join("\n") +
        `\nThis usually means Pass 1 couldn't infer required fields. ` +
        `Try --no-pass1 + manual fill, or run \`anatomy generate\` first to bootstrap, ` +
        `then re-run ingest on top.`,
      );
    }
  }

  if (opts.stdout) {
    process.stdout.write(tomlText);
  } else {
    writeFileSync(anatomyPath, tomlText, "utf8");
    printSummary(ingestResult, pass1, anatomyPath);
  }
}
