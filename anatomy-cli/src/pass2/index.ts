// src/pass2/index.ts
// Pass 2: AI-assisted enrichment, dispatched through a Pass2Provider.
// Default provider is the local claude CLI (no API key required); future
// providers add HTTP backends. The contract published in
// spec/0.8/pass2-prompt-contract.md fixes the prompt + JSON output schema
// so any provider implementation is interchangeable.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ValidationError } from "@anatomytool/validate";
import { canonicalize, fingerprintFromPillars } from "../canonical.js";
import { debug } from "../log.js";
import type { Pass1Result } from "../types.js";
import { smartTruncateLine } from "../text-utils.js";
import { buildGitLog, buildTestSample, buildImportSample } from "./context-extras.js";
import { selectProvider, ProviderError, type Pass2Provider } from "./providers/index.js";
import { readExistingAgentsMd } from "./agents-md-input.js";

export interface AiFillResponse {
  /** Filled only when Pass 1 returned a placeholder for stack (no manifest
   *  detected). Otherwise the deterministic Pass 1 value wins. */
  identity_stack?: string;
  /** Filled only when Pass 1 returned a placeholder for form (no manifest
   *  detected). Otherwise the deterministic Pass 1 value wins. */
  identity_form?: string;
  identity_domain?: string;
  identity_function?: string;
  /** Rare path: Pass 2 saw source clearly contradicting Pass 1's
   *  deterministic stack/form (e.g. Pass 1 set stack="ruby" because a
   *  fastlane Gemfile won detect-order, but every file under Source/ is
   *  .swift). Emit { new_stack, new_form, evidence } to revise. The evidence
   *  string (≤200 chars, names specific files/dirs observed) is required —
   *  the override is silently ignored without it. Mutually exclusive with
   *  identity_stack/identity_form: when override fires, those are skipped. */
  identity_stack_override?: {
    new_stack: string;
    new_form: string;
    evidence: string;
  };
  structure_purposes?: Record<string, string>;
  dependency_whys?: Record<string, string>;
  /** subcommand name → summary (cli tools) or export symbol → summary (libraries) */
  interface_summaries?: Record<string, string>;
  rules?: Array<{ rule: string; why?: string }>;
  flows?: Array<{ name: string; summary: string }>;
  decisions?: Array<{ topic: string; reason: string }>;
  /** v0.15 — project-coined or load-bearing terms an external reader could
   *  misinterpret. Each entry contrasts an internal usage with the
   *  conventional meaning. */
  vocabulary?: Array<{ term: string; meaning: string; aliases?: string[]; contrast?: string[] }>;
  /** v0.15 — cross-file invariants ("change X, also update Y") that no single
   *  file states. triggered_by globs must derive from Pass 1 structure hints. */
  invariants?: Array<{ invariant: string; triggered_by?: string[]; affected_paths?: string[]; why?: string }>;
  /** v0.15 — rejected approaches with reasoning. The keywords field aids
   *  agent-side detection when a query describes the rejected approach. */
  anti_patterns?: Array<{ pattern: string; reason: string; instead?: string; keywords?: string[] }>;
  /** v0.15 — assumed domain/library prerequisites a reader needs to know
   *  before contributing. Distinct from decisions (design choices) and
   *  substance.key_dependencies (dependency facts). */
  prerequisites?: Array<{ topic: string; why: string; link?: string }>;
  /** Rich mode (--rich) only — v0.14+ schema. Free-form description
   *  (200-500 words) lifted from README intro. Truncated to 2000 chars per schema. */
  description?: string;
  /** Rich mode only. Maintainer name or org. */
  author?: string;
  /** Rich mode only. SPDX identifier or descriptive license string. */
  license?: string;
  /** Rich mode only. Documentation site URL. */
  docs_url?: string;
  /** Rich mode only. Source repository URL. */
  repository_url?: string;
  /** Rich mode only. Top runtime deps with versions and whys. Goes into
   *  substance.key_dependencies. */
  key_dependencies?: Array<{ name: string; version?: string; why: string }>;
  /** Rich mode only. Install command from README. Goes into operation.commands["install"]. */
  commands_install?: string;
  /** Rich mode only. Dev/quickstart command. Goes into operation.commands["dev"]. */
  commands_dev?: string;
}

/** Count the number of placeholder fields that need AI enrichment. */
export function countTodos(result: Pass1Result): number {
  let n = 0;
  if (result.identity.stack.isPlaceholder) n++;
  if (result.identity.form.isPlaceholder) n++;
  if (result.identity.domain.isPlaceholder) n++;
  if (result.identity.function.isPlaceholder) n++;
  for (const e of result.structure.entries) if (e.isPlaceholder) n++;
  for (const d of result.substance.keyDependencies) if (d.isPlaceholder) n++;
  if (result.interface) {
    for (const e of result.interface.entries) if (e.isPlaceholder) n++;
  }
  return n;
}

/** Build a manifest of which fields still need to be filled. */
export function buildTodoManifest(result: Pass1Result): string {
  const lines: string[] = ["## Fields to fill"];

  if (result.identity.stack.isPlaceholder) lines.push("- identity.stack (Pass 1 found no manifest — derive from README + source)");
  if (result.identity.form.isPlaceholder) lines.push("- identity.form (Pass 1 found no manifest — derive from README + source)");
  if (result.identity.domain.isPlaceholder) lines.push("- identity.domain");
  if (result.identity.function.isPlaceholder) lines.push("- identity.function");

  const todoDirs = result.structure.entries.filter(e => e.isPlaceholder).map(e => e.path);
  if (todoDirs.length > 0) lines.push(`- structure purposes for: ${todoDirs.join(", ")}`);

  const todoDeps = result.substance.keyDependencies.filter(d => d.isPlaceholder).map(d => d.name);
  if (todoDeps.length > 0) lines.push(`- dependency whys for: ${todoDeps.join(", ")}`);

  if (result.interface?.variant === "subcommands") {
    const names = result.interface.entries.filter(e => e.isPlaceholder).map(e => e.name);
    if (names.length > 0) lines.push(`- interface subcommand summaries for: ${names.join(", ")}`);
  } else if (result.interface?.variant === "exports") {
    const syms = result.interface.entries.filter(e => e.isPlaceholder).map(e => e.symbol);
    if (syms.length > 0) lines.push(`- interface export summaries for: ${syms.join(", ")}`);
  }

  lines.push("- rules, flows, decisions (uncapturable architectural knowledge)");

  // "Already known" only echoes pillars whose Pass 1 values are real, not
  // placeholders. Echoing "stack: todo-stack" would mislead the model into
  // emitting that as final.
  const known: string[] = [];
  if (!result.identity.stack.isPlaceholder) known.push(`stack: ${result.identity.stack.id}`);
  if (!result.identity.form.isPlaceholder) known.push(`form: ${result.identity.form.id}`);
  if (known.length > 0) {
    lines.push("\n## Already known");
    lines.push(known.join(", "));
  }
  if (result.tagline && !result.tagline.isPlaceholder) {
    if (known.length === 0) lines.push("\n## Already known");
    lines.push(`tagline: ${result.tagline.value}`);
  }

  return lines.join("\n");
}

/** Pure merge: apply Claude-filled values into a Pass1Result clone. */
export function applyAiFill(result: Pass1Result, filled: AiFillResponse): Pass1Result {
  const identity = {
    ...result.identity,
    domain: { ...result.identity.domain },
    function: { ...result.identity.function },
  };
  const structure = { entries: result.structure.entries.map(e => ({ ...e })) };
  const substance = { keyDependencies: result.substance.keyDependencies.map(d => ({ ...d })) };

  // stack/form: only fill when Pass 1 returned a placeholder. Pass 1's
  // deterministic detection beats the model's guess when a manifest existed.
  identity.stack = { ...identity.stack };
  identity.form = { ...identity.form };
  if (filled.identity_stack && identity.stack.isPlaceholder) {
    const c = canonicalize(filled.identity_stack);
    if (c) identity.stack = { id: c, isPlaceholder: false };
  }
  if (filled.identity_form && identity.form.isPlaceholder) {
    const c = canonicalize(filled.identity_form);
    if (c) identity.form = { id: c, isPlaceholder: false };
  }

  // Stack-override: rare revision path for the case where Pass 1 was
  // deterministically wrong (e.g. v0.12 50-repo Alamofire — fastlane Gemfile
  // beat Package.swift in detect-order, Pass 2 then wrote ruby content for a
  // Swift project). Requires non-empty evidence (≤200 chars) and that BOTH
  // new_stack and new_form canonicalize cleanly; either failing → silently
  // drop the override. Mutually exclusive with identity_stack/form fills
  // above — when override fires it stomps on whatever they wrote.
  if (filled.identity_stack_override) {
    const ov = filled.identity_stack_override;
    const newStack = canonicalize(ov.new_stack);
    const newForm = canonicalize(ov.new_form);
    const evidenceOk =
      typeof ov.evidence === "string" &&
      ov.evidence.length > 0 &&
      ov.evidence.length <= 200;
    if (newStack && newForm && evidenceOk) {
      debug(`pass2: identity_stack_override applied: ${identity.stack.id} -> ${newStack}, ${identity.form.id} -> ${newForm} (evidence: ${ov.evidence})`);
      identity.stack = { id: newStack, isPlaceholder: false };
      identity.form  = { id: newForm,  isPlaceholder: false };
    } else {
      debug(`pass2: identity_stack_override rejected (stack=${newStack ?? "?"}, form=${newForm ?? "?"}, evidenceOk=${evidenceOk})`);
    }
  }

  if (filled.identity_domain && identity.domain.isPlaceholder) {
    const c = canonicalize(filled.identity_domain);
    if (c) identity.domain = { id: c, isPlaceholder: false };
  }

  if (filled.identity_function && identity.function.isPlaceholder) {
    const c = canonicalize(filled.identity_function);
    if (c) identity.function = { id: c, isPlaceholder: false };
  }

  identity.fingerprint = fingerprintFromPillars(
    identity.stack.id, identity.form.id, identity.domain.id, identity.function.id
  );

  if (filled.structure_purposes) {
    for (const entry of structure.entries) {
      const purpose = filled.structure_purposes[entry.path];
      if (purpose && entry.isPlaceholder) {
        entry.purpose = smartTruncateLine(purpose, 120);
        entry.isPlaceholder = false;
      }
    }
  }

  if (filled.dependency_whys) {
    for (const dep of substance.keyDependencies) {
      const why = filled.dependency_whys[dep.name];
      if (why && dep.isPlaceholder) { dep.why = smartTruncateLine(why, 80); dep.isPlaceholder = false; }
    }
  }

  let interfaceResult = result.interface;
  if (filled.interface_summaries && result.interface) {
    const summaries = filled.interface_summaries;
    if (result.interface.variant === "subcommands") {
      interfaceResult = {
        variant: "subcommands",
        entries: result.interface.entries.map(e => {
          const s = summaries[e.name];
          return s && e.isPlaceholder ? { ...e, summary: smartTruncateLine(s, 120), isPlaceholder: false } : e;
        }),
      };
    } else if (result.interface.variant === "exports") {
      interfaceResult = {
        variant: "exports",
        entries: result.interface.entries.map(e => {
          const s = summaries[e.symbol];
          return s && e.isPlaceholder ? { ...e, summary: smartTruncateLine(s, 120), isPlaceholder: false } : e;
        }),
      };
    }
  }

  const merged: Pass1Result = { ...result, identity, structure, substance, interface: interfaceResult };
  if (Array.isArray(filled.rules) && filled.rules.length > 0) {
    // rules.rule and decisions.reason are multi-line per schema — slice is fine.
    // rules.why is short and single-line — use smartTruncateLine.
    merged.rules = filled.rules.map(r => ({
      rule: r.rule.slice(0, 300),
      why: r.why ? smartTruncateLine(r.why, 200) : undefined,
    }));
  }
  if (Array.isArray(filled.flows) && filled.flows.length > 0) {
    merged.flows = filled.flows
      .filter(f => typeof f.name === "string" && typeof f.summary === "string")
      .map(f => ({ name: f.name.slice(0, 40), summary: smartTruncateLine(f.summary, 300) }));
  }
  if (Array.isArray(filled.decisions) && filled.decisions.length > 0) {
    merged.decisions = filled.decisions
      .filter(d => typeof d.topic === "string" && typeof d.reason === "string")
      .map(d => ({ topic: smartTruncateLine(d.topic, 120), reason: d.reason.slice(0, 400) }));
  }

  // v0.15 uncapturable-knowledge sections. Per spec/0.15/prompt.md line 140,
  // multi-line is allowed for vocabulary.meaning, invariants.invariant,
  // invariants.why, anti_patterns.{pattern,instead,reason}, prerequisites.why
  // — those use slice(); everything else is single-line and uses
  // smartTruncateLine. Each guard mirrors the rules/flows/decisions shape:
  // empty arrays are dropped so the renderer's "omit empty section" gate
  // (see render-v0.15-sections.test.ts) still fires.
  // Note: triggered_by[] and affected_paths[] items are NOT constrained to
  // single-line by the schema, but smartTruncateLine is used here for
  // length-clamping consistency — path strings are structurally single-line
  // in practice.
  if (Array.isArray(filled.vocabulary) && filled.vocabulary.length > 0) {
    merged.vocabulary = filled.vocabulary
      .filter(v => typeof v.term === "string" && typeof v.meaning === "string")
      .slice(0, 30)
      .map(v => ({
        term: smartTruncateLine(v.term, 80),
        meaning: v.meaning.slice(0, 300),
        ...(Array.isArray(v.aliases) && v.aliases.length > 0
          ? { aliases: v.aliases.filter(a => typeof a === "string").slice(0, 5).map(a => smartTruncateLine(a, 80)) }
          : {}),
        ...(Array.isArray(v.contrast) && v.contrast.length > 0
          ? { contrast: v.contrast.filter(c => typeof c === "string").slice(0, 3).map(c => smartTruncateLine(c, 120)) }
          : {}),
      }));
  }
  if (Array.isArray(filled.invariants) && filled.invariants.length > 0) {
    merged.invariants = filled.invariants
      .filter(i => typeof i.invariant === "string")
      .slice(0, 15)
      .map(i => ({
        invariant: i.invariant.slice(0, 300),
        ...(Array.isArray(i.triggered_by) && i.triggered_by.length > 0
          ? { triggered_by: i.triggered_by.filter(g => typeof g === "string").slice(0, 5).map(g => smartTruncateLine(g, 200)) }
          : {}),
        ...(Array.isArray(i.affected_paths) && i.affected_paths.length > 0
          ? { affected_paths: i.affected_paths.filter(p => typeof p === "string").slice(0, 5).map(p => smartTruncateLine(p, 200)) }
          : {}),
        ...(typeof i.why === "string" && i.why.trim().length > 0
          ? { why: i.why.slice(0, 200) }
          : {}),
      }));
  }
  if (Array.isArray(filled.anti_patterns) && filled.anti_patterns.length > 0) {
    merged.anti_patterns = filled.anti_patterns
      .filter(a => typeof a.pattern === "string" && typeof a.reason === "string")
      .slice(0, 12)
      .map(a => ({
        pattern: a.pattern.slice(0, 300),
        reason: a.reason.slice(0, 400),
        ...(typeof a.instead === "string" && a.instead.trim().length > 0
          ? { instead: a.instead.slice(0, 300) }
          : {}),
        ...(Array.isArray(a.keywords) && a.keywords.length > 0
          ? { keywords: a.keywords.filter(k => typeof k === "string").slice(0, 5).map(k => smartTruncateLine(k.toLowerCase(), 60)) }
          : {}),
      }));
  }
  if (Array.isArray(filled.prerequisites) && filled.prerequisites.length > 0) {
    merged.prerequisites = filled.prerequisites
      .filter(p => typeof p.topic === "string" && typeof p.why === "string")
      .slice(0, 10)
      .map(p => ({
        topic: smartTruncateLine(p.topic, 120),
        why: p.why.slice(0, 200),
        ...(typeof p.link === "string" && p.link.trim().length > 0
          ? { link: smartTruncateLine(p.link, 300) }
          : {}),
      }));
  }

  // v0.14 rich-mode fields. Always optional; fill from response when present.
  if (typeof filled.description === "string" && filled.description.trim().length > 0) {
    merged.description = filled.description.slice(0, 2000);
  }
  if (typeof filled.author === "string" && filled.author.trim().length > 0) {
    merged.author = smartTruncateLine(filled.author, 200);
  }
  if (typeof filled.license === "string" && filled.license.trim().length > 0) {
    merged.license = smartTruncateLine(filled.license, 100);
  }
  if (typeof filled.docs_url === "string" && filled.docs_url.trim().length > 0) {
    merged.docs_url = smartTruncateLine(filled.docs_url, 300);
  }
  if (typeof filled.repository_url === "string" && filled.repository_url.trim().length > 0) {
    merged.repository_url = smartTruncateLine(filled.repository_url, 300);
  }
  // Install/dev commands fold into operation.commands.
  if (typeof filled.commands_install === "string" && filled.commands_install.trim().length > 0) {
    merged.operation = {
      ...merged.operation,
      commands: { ...merged.operation.commands, install: filled.commands_install.slice(0, 200) },
    };
  }
  if (typeof filled.commands_dev === "string" && filled.commands_dev.trim().length > 0) {
    merged.operation = {
      ...merged.operation,
      commands: { ...merged.operation.commands, dev: filled.commands_dev.slice(0, 200) },
    };
  }
  // Rich key_dependencies replace placeholders entirely (Pass 2 with --rich
  // is authoritative on which deps matter and what versions are pinned).
  if (Array.isArray(filled.key_dependencies) && filled.key_dependencies.length > 0) {
    merged.substance = {
      ...merged.substance,
      keyDependencies: filled.key_dependencies
        .filter(d => typeof d.name === "string" && typeof d.why === "string")
        .map(d => ({
          name: smartTruncateLine(d.name, 80),
          why: smartTruncateLine(d.why, 80),
          isPlaceholder: false,
          // Note: 'version' carried as a side-channel through any-cast in render.
          // The Pass1Result type doesn't model it but the .anatomy emit will.
          ...(typeof d.version === "string" && d.version.trim().length > 0
            ? { version: smartTruncateLine(d.version, 50) }
            : {}),
        })) as unknown as typeof merged.substance.keyDependencies,
    };
  }

  return merged;
}

// ── Static context builders ───────────────────────────────────────────────────

const SIGNIFICANT_TOP_LEVEL = new Set([
  "tsconfig.json", "tsconfig.base.json", "jsconfig.json",
  "docker-compose.yml", "docker-compose.yaml", "Dockerfile",
  "Makefile", "makefile", "GNUmakefile",
  ".env.example", ".env.sample",
  "turbo.json", "nx.json", "lerna.json", "pnpm-workspace.yaml",
  "biome.json", ".eslintrc.js", ".eslintrc.json", ".eslintrc.cjs",
  "vite.config.ts", "vite.config.js",
  "webpack.config.js", "webpack.config.ts",
  "rollup.config.js", "rollup.config.ts",
  "jest.config.js", "jest.config.ts", "vitest.config.ts", "vitest.config.js",
]);

function buildTopLevelFiles(repoRoot: string): string {
  try {
    const files = readdirSync(repoRoot, { withFileTypes: true })
      .filter(e => e.isFile() && SIGNIFICANT_TOP_LEVEL.has(e.name))
      .map(e => e.name)
      .sort();
    return files.length > 0 ? `Top-level config files: ${files.join(", ")}` : "";
  } catch { return ""; }
}

const ENTRY_PRIORITY = [
  "src/index.ts", "src/index.js", "src/main.ts", "src/main.js",
  "src/bin.ts", "src/bin.js",
  "index.ts", "index.js", "main.ts", "main.js",
  "main.go", "cmd/main.go",
  "main.py", "src/main.py", "app.py", "src/app.py",
  "src/lib.rs", "src/main.rs",
] as const;

function buildEntryPoint(repoRoot: string): string {
  for (const rel of ENTRY_PRIORITY) {
    const p = join(repoRoot, rel);
    if (!existsSync(p)) continue;
    try {
      const content = readFileSync(p, "utf8").split("\n").slice(0, 15).join("\n").trim();
      if (!content) continue;
      return `## Entry point: ${rel}\n${content}`;
    } catch {}
  }
  return "";
}

function buildCIContext(repoRoot: string): string {
  const workflowsDir = join(repoRoot, ".github", "workflows");
  if (!existsSync(workflowsDir)) return "";
  try {
    const files = readdirSync(workflowsDir, { withFileTypes: true })
      .filter(e => e.isFile() && (e.name.endsWith(".yml") || e.name.endsWith(".yaml")))
      .map(e => e.name)
      .sort();
    if (files.length === 0) return "";
    const parts: string[] = [`CI workflows: ${files.join(", ")}`];
    for (const file of files.slice(0, 3)) {
      try {
        const content = readFileSync(join(workflowsDir, file), "utf8")
          .split("\n").slice(0, 25).join("\n");
        parts.push(`\n### ${file}\n${content}`);
      } catch {}
    }
    return parts.join("\n");
  } catch { return ""; }
}

const SUBDIR_SKIP = new Set([
  "node_modules", ".git", "target", "dist", "build",
  "__pycache__", ".next", ".turbo",
]);

function buildSubdirSummary(repoRoot: string, entries: Pass1Result["structure"]["entries"]): string {
  const lines: string[] = [];
  for (const entry of entries) {
    const dirPath = join(repoRoot, entry.path.replace(/\/$/, ""));
    if (!existsSync(dirPath)) continue;
    try {
      const children = readdirSync(dirPath, { withFileTypes: true })
        .filter(e => !e.name.startsWith(".") && !SUBDIR_SKIP.has(e.name));
      const childDirs = children.filter(e => e.isDirectory()).map(e => e.name);
      const childFiles = children.filter(e => e.isFile()).map(e => e.name).slice(0, 8);

      const parts: string[] = [];
      if (childDirs.length > 0) {
        const shown = childDirs.slice(0, 12);
        const more = childDirs.length > 12 ? ` …+${childDirs.length - 12}` : "";
        parts.push(`dirs: ${shown.join(", ")}${more}`);
      }
      if (childFiles.length > 0) parts.push(`files: ${childFiles.join(", ")}`);
      if (parts.length > 0) lines.push(`${entry.path} → ${parts.join(" | ")}`);
    } catch {}
  }
  return lines.join("\n");
}

// Strip HTML tags, badge image lines, and shield.io URLs from README text.
function stripReadmeNoise(text: string): string {
  return text
    .split("\n")
    .filter(line => {
      const t = line.trim();
      // Drop pure badge/image lines: [![...]] or ![...] or <img ...>
      if (/^\[!\[/.test(t) || /^!\[/.test(t) || /^<img\s/i.test(t)) return false;
      // Drop HTML block tags used for centering/alignment
      if (/^<\/?(div|p|center|align)[^>]*>$/i.test(t)) return false;
      return true;
    })
    .join("\n")
    // Collapse 3+ consecutive blank lines to 2
    .replace(/\n{3,}/g, "\n\n");
}

function buildContext(result: Pass1Result, repoRoot: string): string {
  const parts: string[] = [];

  parts.push(buildTodoManifest(result));

  for (const name of ["README.md", "README.rst", "README.txt", "README"]) {
    try {
      const raw = readFileSync(join(repoRoot, name), "utf8");
      const cleaned = stripReadmeNoise(raw);
      parts.push(`\n## ${name}\n`);
      parts.push(cleaned.slice(0, 8_000));
      break;
    } catch {}
  }

  const topFiles = buildTopLevelFiles(repoRoot);
  if (topFiles) parts.push(`\n## Repository config files\n${topFiles}`);

  const entryPoint = buildEntryPoint(repoRoot);
  if (entryPoint) parts.push(`\n${entryPoint}`);

  const ciContext = buildCIContext(repoRoot);
  if (ciContext) parts.push(`\n## CI/CD\n${ciContext}`);

  const subdirSummary = buildSubdirSummary(repoRoot, result.structure.entries);
  if (subdirSummary) {
    parts.push("\n## Repository structure\n");
    parts.push(subdirSummary);
  }

  const gitLog = buildGitLog(repoRoot);
  if (gitLog) parts.push(`\n${gitLog}`);

  const firstEntry = result.operation.entryPoints[0]?.path;
  const testSample = buildTestSample(repoRoot, firstEntry);
  if (testSample) parts.push(`\n${testSample}`);

  const importSample = firstEntry ? buildImportSample(repoRoot, firstEntry) : "";
  if (importSample) parts.push(`\n${importSample}`);

  const existingAgentsMd = readExistingAgentsMd(repoRoot);
  if (existingAgentsMd) {
    parts.push(`\n## EXISTING_AGENTS_MD (truncated to 3000 chars)\n`);
    parts.push(existingAgentsMd);
    parts.push(
      "\n" +
        "Treat EXISTING_AGENTS_MD as authoritative for commands, structure summaries, " +
        "and rules that align with the anatomy schema. Reconcile against the manifest + " +
        "README when they disagree — manifest wins on commands; README wins on description; " +
        "EXISTING_AGENTS_MD wins on rules, conventions, and glob-scoped guidance. " +
        "Do not invent values for the optional [generate] block.",
    );
  }

  return parts.join("\n");
}

const SYSTEM_PROMPT = `You are filling in missing fields in a .anatomy file — a machine-readable description of a software repository.

Rules:
- Only fill fields marked # TODO
- Be concise: structure purposes ≤120 chars, dependency whys ≤80 chars, interface summaries ≤120 chars
- identity_stack, identity_form, identity_domain, identity_function must be lowercase hyphenated slugs.
  HARD LIMITS — schema rejects values that exceed them:
    identity_stack    ≤ 40 chars  (e.g. "csharp", "typescript")
    identity_form     ≤ 40 chars  (e.g. "csharp-desktop-app", "python-cli-tool")
    identity_domain   ≤ 40 chars  (e.g. "developer-tools", "web-infrastructure")
    identity_function ≤ 40 chars  (e.g. "fast-recursive-text-search")
  PREFER short slugs over precise ones — "static-site-generator" beats "blog-aware-static-site-generator".
  These are metadata identifiers, not documentation. Save the detail for [[rules]] and [[decisions]].
- identity_stack: emit ONLY when "identity.stack" appears in "Fields to fill". Common values: typescript, javascript, python, rust, go, csharp, java, kotlin, swift, ruby, elixir, c, cpp, php. Use the slug for the primary language detected from the README + entry-point + repo layout.
- identity_form: emit ONLY when "identity.form" appears in "Fields to fill". Format as "<stack>-<shape>" where shape is one of: library, cli-tool, service, desktop-app, monorepo. Examples: "csharp-desktop-app", "python-cli-tool", "rust-library".
- identity_stack_override (RARE — emit only when Pass 1's stack is clearly wrong):
    When "Already known" lists a stack value but the source you see contradicts it
    (e.g. "stack: ruby" but every file under Source/ is .swift, and Package.swift
    exists), you may emit:
      "identity_stack_override": { "new_stack": "...", "new_form": "...", "evidence": "..." }
    "evidence" (≤200 chars) MUST cite specific filenames or directory shapes you
    observed. Without evidence the override is silently dropped.
    Use this for OBVIOUS manifest-detection mistakes only, never close calls.
    When you emit this override, do NOT also emit identity_stack/identity_form.
- Do not invent details not supported by the provided context

Also emit rules, flows, and decisions — these are the highest-value sections:

rules: 2–5 non-obvious constraints or invariants that govern this codebase. These must be things that
  would surprise a contributor and CANNOT be derived from reading the code structure alone — implicit
  conventions, things that must never change, subtle constraints. Each { rule: string (≤300 chars), why?: string (≤200 chars) }.
  "why" is optional but powerful: include it when the reason is non-obvious.
  Omit the rules array entirely if fewer than 2 genuinely non-obvious rules exist.

flows: 1–4 cross-module data or control flows that a developer needs to understand to work in this codebase.
  Each { name: lowercase-hyphenated slug ≤40 chars, summary: one-line description of the flow path ≤300 chars }.
  Good flows describe HOW things move through the system, not WHAT exists.
  Omit if the codebase is too simple to have meaningful flows.

decisions: 1–4 architectural decisions with rationale — the WHY behind non-obvious choices.
  Each { topic: string ≤120 chars, reason: string ≤400 chars }.
  Only include decisions where the reason is non-obvious from the code; skip obvious ones.
  Omit if no meaningful decisions are evident.

vocabulary: 1–30 project-coined or load-bearing terms that an external reader could MISINTERPRET if
  applied with their conventional meaning. Each { term: string ≤80 chars, meaning: string ≤300 chars,
  aliases?: string[], contrast?: string[] }. Use aliases for alternative casings or recognized
  synonyms; use contrast for "not to be confused with X" — most term confusions are "X vs Y in this
  codebase" and stating the contrast directly is uncapturable from source.
  Bar: only *contested*, *invented*, or *load-bearing-for-conversation* terms. Do NOT list every
  public class. Example: term="Layer", meaning="A node in the router stack pairing a path pattern
  with a middleware fn.", contrast=["not Middleware (which is the fn the Layer carries)"].
  Omit if no qualifying terms exist.

invariants: 1–15 cross-file conditions — "when you change X, also update Y and Z" — that no single
  file states. Each { invariant: string ≤300 chars, triggered_by?: string[] (≤5 globs, each ≤200),
  affected_paths?: string[] (≤5 paths, each ≤200), why?: string ≤200 chars }. The triggered_by
  globs MUST come from paths visible in the repository structure — no hallucinated paths.
  Example: invariant="Adding a new HTTP method requires updates in router/methods.js,
  lib/application.js, AND test/app.router.js.", triggered_by=["lib/application.js"].
  Omit if no cross-file invariants are evident.

anti_patterns: 1–12 approaches tried and rejected, OR class-of-approaches the maintainers explicitly
  avoid. Each { pattern: string ≤300 chars, reason: string ≤400 chars, instead?: string ≤300 chars,
  keywords?: string[] (≤5 lowercase strings, each ≤60) }. The keywords field aids agent-side
  detection when a query describes the rejected approach. Lowest expected hit rate — many repos
  won't have any; that's fine; omit.
  Example: pattern="Wrapping req/res in subclass objects", instead="Mutate prototype on app.request",
  reason="Prototype chains preserve instanceof; wrappers force per-request allocation.",
  keywords=["wrapper", "subclass", "extend request"].
  Omit if no rejected approaches are documented.

prerequisites: 1–10 domain or library concepts the codebase ASSUMES the reader is familiar with —
  Node streams, HTTP semantics, gRPC, monad transformers, etc. Each { topic: string ≤120 chars,
  why: string ≤200 chars, link?: string URL ≤300 chars }. Distinct from decisions (the repo's design
  choices) and substance.key_dependencies (dependency facts). Sourced from README "Background" /
  "Prerequisites" / "Before contributing" sections, or dependency README links.
  Example: topic="Node.js streams", why="res.sendFile and pipeline middleware assume reader
  familiarity with Readable/Writable backpressure.", link="https://nodejs.org/api/stream.html".
  Omit if no assumed prerequisites are documented.

Omit any of rules/flows/decisions/vocabulary/invariants/anti_patterns/prerequisites entirely if you cannot find at least one item that meets the
"uncapturable from source" bar. Do not pad with derivable observations to hit a count.

Respond with ONLY a JSON object — no prose, no markdown fences. Schema:
{
  "identity_stack": "string (optional — only when stack is in Fields to fill)",
  "identity_form": "string (optional — only when form is in Fields to fill)",
  "identity_stack_override": { "new_stack": "...", "new_form": "...", "evidence": "..." } (optional, RARE),
  "identity_domain": "string (optional)",
  "identity_function": "string (optional)",
  "structure_purposes": { "<path>": "<purpose>" },
  "dependency_whys": { "<name>": "<why>" },
  "interface_summaries": { "<name or symbol>": "<summary>" },
  "rules": [{ "rule": "...", "why": "..." }],
  "flows": [{ "name": "...", "summary": "..." }],
  "decisions": [{ "topic": "...", "reason": "..." }],
  "vocabulary": [{ "term": "...", "meaning": "...", "aliases": ["..."], "contrast": ["..."] }],
  "invariants": [{ "invariant": "...", "triggered_by": ["..."], "affected_paths": ["..."], "why": "..." }],
  "anti_patterns": [{ "pattern": "...", "reason": "...", "instead": "...", "keywords": ["..."] }],
  "prerequisites": [{ "topic": "...", "why": "...", "link": "..." }],

  // RICH MODE optional fields. Emit ONLY when a "## RICH MODE" block
  // appears in the user prompt. Default mode MUST omit all of these.
  "description": "string (200-500 word README intro voice)",
  "author": "string (≤200 chars — maintainer name or org)",
  "license": "string (≤100 chars — SPDX identifier or descriptive)",
  "docs_url": "string (≤300 chars — documentation URL)",
  "repository_url": "string (≤300 chars — source repo URL)",
  "key_dependencies": [{ "name": "string ≤80", "version": "string ≤50 (manifest verbatim)", "why": "string ≤80" }],
  "commands_install": "string (install command from README)",
  "commands_dev": "string (dev/quickstart command)"
}`;

// Appended to the user prompt when --rich is set. Mirrors the RICH MODE block
// in spec/0.14/prompt.md. Kept in source so the binary works without the spec/
// tree alongside; spec/0.14/prompt.md is the normative reference.
//
// IMPORTANT: this block is written with the same "REQUIRED — emit these"
// directive style as the rules/flows/decisions section of SYSTEM_PROMPT. The
// model tends to skip fields that aren't framed as required, so ALL rich
// fields are presented as MUST-emit (with omission allowed only when the
// repository genuinely lacks the signal).
const RICH_MODE_BLOCK = `

================================================================
RICH MODE IS ACTIVE — ADDITIONAL REQUIRED OUTPUT FIELDS BELOW
================================================================

In addition to the baseline fields (identity_domain, identity_function, rules, flows, decisions, etc.), you MUST emit the following 8 rich-mode fields in the same JSON response. Omit any individual field ONLY if the repository genuinely lacks the signal — the README, manifest, and LICENSE files are typically sufficient evidence.

1. description (REQUIRED): a 200-500 character free-form summary lifted from the README intro paragraph. Capture what the project IS and DOES in the project's own voice. Multi-line allowed. Cap at 500 characters; the schema rejects longer.

2. author (REQUIRED): maintainer name or organization, ≤200 chars. Sources in priority order:
   - README "by @user" line or attribution
   - package.json "author" field (string or {name})
   - LICENSE file copyright line
   Examples: "Colin McDonnell (colinhacks)", "GitHub, Inc.", "Yusuke Wada (yusukebe)"

3. license (REQUIRED): SPDX identifier (preferred) or short descriptive string, ≤100 chars. Sources:
   - package.json "license"
   - LICENSE file header (first line usually identifies)
   - README badge
   Examples: "MIT", "Apache-2.0", "MIT OR UNLICENSE", "BSD-3-Clause"

4. docs_url (REQUIRED if known): documentation site URL, ≤300 chars. Sources:
   - README "Documentation: <url>" line
   - package.json "homepage"
   - README link to a non-github docs site
   Examples: "https://hono.dev", "https://fastapi.tiangolo.com", "https://zod.dev"

5. repository_url (REQUIRED if known): source repo URL, ≤300 chars. Sources:
   - package.json "repository.url" or "repository" string
   - README clone URL
   Examples: "https://github.com/colinhacks/zod"

6. key_dependencies (REQUIRED): array of the top 3-7 runtime dependencies. Each entry: { "name": string ≤80, "version": string ≤50 (manifest verbatim, e.g. ">=2.9.0", "^4.1.5"), "why": string ≤80 (one line drawn from README context — what role does this dep play). Sources: manifest dependencies (package.json/Cargo.toml/pyproject.toml/go.mod) PLUS README mentions of why those deps were chosen. EMIT THIS — the cold-generation use case relies on it.

7. commands_install (REQUIRED if README has it): the install one-liner from README quick-start. Examples: "npm install zod", "pip install \\"fastapi[standard]\\"", "cargo install ripgrep". Pulled from README quick-start or installation section.

8. commands_dev (OPTIONAL): the dev/quickstart command if README documents one. Examples: "fastapi dev", "npm create hono@latest", "cargo run --release".

YOUR JSON RESPONSE MUST INCLUDE THESE FIELDS at the top level alongside identity_domain, identity_function, rules, flows, decisions. They are NOT a sub-object; they are sibling keys.

Treat the rich fields as equally important as rules/flows/decisions. Cold-generation parity with hand-curated .anatomy depends on you emitting them.`;

function safeReviver(key: string, value: unknown): unknown {
  if (key === "__proto__" || key === "constructor" || key === "prototype") return undefined;
  return value;
}

export function extractJson(text: string): AiFillResponse {
  const trimmed = text.trim();

  // Try direct parse first
  try { return JSON.parse(trimmed, safeReviver); } catch {}

  // Strip markdown fences if present
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced) {
    try { return JSON.parse(fenced[1], safeReviver); } catch {}
  }

  // Extract first {...} block
  const block = trimmed.match(/(\{[\s\S]*\})/);
  if (block) {
    try { return JSON.parse(block[1], safeReviver); } catch {}
  }

  throw new Error(`could not parse JSON from claude response. First 200 chars: ${trimmed.slice(0, 200)}`);
}

export interface EnrichOptions {
  /** Override the provider. Defaults to selectProvider() auto-detection
   *  (which honors ANATOMY_PASS2_PROVIDER env var, then falls back to the
   *  first registered provider that's available). */
  provider?: string;
  /** When true, return the prompt that *would* be sent to the provider
   *  rather than calling it. The returned object has modelId="dry-run"
   *  and `result` is the unmodified Pass1Result. Used by Pass 2 plugin
   *  authors to inspect what their provider will be asked. */
  printPromptOnly?: boolean;
  /** Validation errors from a prior Pass 2 attempt's rendered output. When
   *  provided, the user prompt is appended with a "fix these constraints"
   *  block so the next provider call can self-correct. Used by the
   *  generate command for one-shot retry on schema-violation; the v0.12
   *  50-repo run hit `identity/function: must NOT have more than 40
   *  characters` once, and an unprompted re-roll happened to succeed —
   *  this path makes that recovery deterministic. */
  priorErrors?: readonly ValidationError[];
  /** When true, disables the on-failure retry-with-trimmed-input behavior.
   *  Default false: a single retry is attempted with the README content
   *  capped at 4000 chars (down from 8000) and existing-AGENTS.md dropped.
   *  Used by the eval harness for deterministic re-runs. */
  noRetry?: boolean;
  /** When true, append the RICH MODE block to the user prompt. The block
   *  asks Pass 2 to additionally emit author, license, docs_url,
   *  repository_url, full description, install/dev commands, and
   *  substance.key_dependencies with versions. v0.14+ schema only. */
  rich?: boolean;
}

export interface EnrichResult {
  result: Pass1Result;
  modelId: string;
  /** Populated when printPromptOnly: the system + user prompt the provider
   *  was (or would have been) called with. Always undefined in normal runs. */
  prompt?: { systemPrompt: string; userPrompt: string };
}

/** Like buildContext but with README capped to 4000 chars and the existing
 *  AGENTS.md section dropped. Used as the retry input when the full prompt
 *  triggers a Pass 2 failure. */
function buildTrimmedContext(result: Pass1Result, repoRoot: string): string {
  const parts: string[] = [];

  parts.push(buildTodoManifest(result));

  for (const name of ["README.md", "README.rst", "README.txt", "README"]) {
    try {
      const raw = readFileSync(join(repoRoot, name), "utf8");
      const cleaned = stripReadmeNoise(raw);
      parts.push(`\n## ${name} (trimmed)\n`);
      parts.push(cleaned.slice(0, 4_000));
      break;
    } catch {}
  }

  // Skip top-level config files, entry point, CI context — keep prompt small.
  const subdirSummary = buildSubdirSummary(repoRoot, result.structure.entries);
  if (subdirSummary) {
    parts.push("\n## Repository structure\n");
    parts.push(subdirSummary);
  }

  // EXISTING_AGENTS_MD intentionally dropped on retry.
  return parts.join("\n");
}

/** Wrap provider.generate with one retry-with-trimmed-input on ProviderError.
 *  Trim strategy: rebuild the user prompt with smaller README slice + drop
 *  EXISTING_AGENTS_MD section. The repo summary itself is not trimmed (Pass 1
 *  output is small and load-bearing). */
async function generateWithRetry(
  provider: Pass2Provider,
  systemPrompt: string,
  userPrompt: string,
  result: Pass1Result,
  repoRoot: string,
  noRetry: boolean,
): Promise<string> {
  try {
    return await provider.generate({ systemPrompt, userPrompt });
  } catch (err) {
    if (noRetry || !(err instanceof ProviderError)) throw err;
    // Only retry on the "claude CLI returned non-zero" class — not auth/quota.
    if (err.code !== "pass2-provider-network") throw err;

    debug(`pass2: provider failed with ${err.code}; retrying with trimmed input`);
    const trimmed = buildTrimmedContext(result, repoRoot);
    const trimmedPrompt = `Fill in the TODO fields using the repository context below.\n\n${trimmed}`;
    debug(`pass2: trimmed user prompt is ${trimmedPrompt.length} chars (was ${userPrompt.length})`);
    try {
      return await provider.generate({ systemPrompt, userPrompt: trimmedPrompt });
    } catch (retryErr) {
      if (retryErr instanceof ProviderError) {
        throw new ProviderError(
          retryErr.code,
          `${retryErr.message}\n\nNote: anatomy retried with a trimmed prompt (${trimmedPrompt.length} chars vs original ${userPrompt.length}); both attempts failed.`,
        );
      }
      throw retryErr;
    }
  }
}

/** Public entry point. Builds context, picks a provider, dispatches, parses
 *  the response, applies the fill. Backwards-compatible signature: the
 *  options arg is optional and defaults preserve v0.10 behavior. */
export async function enrichWithAI(
  result: Pass1Result,
  repoRoot: string,
  options: EnrichOptions = {},
): Promise<EnrichResult> {
  const todoCount = countTodos(result);
  if (todoCount === 0 && !options.printPromptOnly) {
    debug("pass2: no TODO fields, skipping");
    return { result, modelId: "none" };
  }
  debug(`pass2: ${todoCount} TODO fields to fill`);

  let userPrompt = `Fill in the TODO fields using the repository context below.\n\n${buildContext(result, repoRoot)}`;
  if (options.priorErrors && options.priorErrors.length > 0) {
    // Self-correct retry: feed validation errors back so the next provider
    // call corrects the constraint violation rather than re-rolling blind.
    const errLines = options.priorErrors.map(
      e => `  - ${e.code} at ${e.pointer || "/"}: ${e.message}`,
    ).join("\n");
    userPrompt +=
      `\n\n## VALIDATION FAILED — your previous response produced output the schema rejected\n` +
      errLines + "\n\n" +
      `Fix every error above and respond with the SAME JSON schema. ` +
      `Pay particular attention to length limits — identity_stack/form/domain/function are each capped at 40 characters.`;
    debug(`pass2: self-correct retry with ${options.priorErrors.length} prior error(s)`);
  }
  if (options.rich) {
    userPrompt += RICH_MODE_BLOCK;
    debug("pass2: rich mode enabled — RICH MODE block appended to prompt");
  }
  debug(`pass2: user prompt is ${userPrompt.length} chars`);

  if (options.printPromptOnly) {
    return {
      result,
      modelId: "dry-run",
      prompt: { systemPrompt: SYSTEM_PROMPT, userPrompt },
    };
  }

  let provider: Pass2Provider;
  try {
    provider = await selectProvider(options.provider);
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    throw new ProviderError("pass2-provider-not-available", err instanceof Error ? err.message : String(err));
  }
  debug(`pass2: using provider ${provider.name}`);

  const raw = await generateWithRetry(
    provider,
    SYSTEM_PROMPT,
    userPrompt,
    result,
    repoRoot,
    options.noRetry ?? false,
  );
  const filled = extractJson(raw);
  debug(`pass2: received fill: domain=${filled.identity_domain}, function=${filled.identity_function}`);
  if (options.rich) {
    debug(`pass2: rich response keys: ${Object.keys(filled).join(", ")}`);
    debug(`pass2: key_dependencies count: ${filled.key_dependencies?.length ?? 0}`);
  }

  const enriched = applyAiFill(result, filled);
  // Provider name doubles as a stable model ID until providers expose richer
  // metadata. claude-cli inherits the legacy "claude-code" string for
  // continuity with v0.10-and-earlier .anatomy files.
  const modelId = provider.name === "claude-cli" ? "claude-code" : provider.name;
  return { result: enriched, modelId };
}

