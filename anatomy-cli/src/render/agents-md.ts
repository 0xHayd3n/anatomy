// src/render/agents-md.ts
// Pure function: Pass1Result -> Markdown string for AGENTS.md emission.
// Section order is normative (parallel to TOML canonical section order):
//   title -> banner -> tagline -> description -> commands -> structure ->
//   rules -> flows -> decisions -> key deps -> memory -> footer.
// Empty optional sections are skipped silently.
//
// Implementation flow: buildSections (data extraction) -> applyBudget
// (drop/truncate if over token budget) -> renderSections (final join).
// renderSections + applyBudget live in budget.ts; this file owns the
// extract step and the orchestrator.

import { existsSync, readFileSync } from "node:fs";
import type { Pass1Result } from "../types.js";
import type { RenderArtifact, RenderOptions } from "./types.js";
import { formatRegenBannerLine } from "../banner.js";
import { applyBudget, renderSections, type AgentsMdSections } from "./budget.js";
import { parseMemoryDoc, memoryPath } from "../memory/io.js";
import { selectTopMemoryEntries } from "./memory-for-agents-md.js";

const SCHEMA_URL = "https://anatomy.dev/spec/0.10/schema.json";
// Bumped from 1500 in 2026-05-14 — eval found hono's default render exceeded
// 1500 (rules + commands alone hit 1548). 3000 leaves headroom for typical
// repos and lets per-repo overrides via [generate].agents_md_budget take
// over for outliers. See docs/superpowers/specs/2026-05-14-anatomy-rich-mode-design.md.
const DEFAULT_BUDGET_TOKENS = 3000;
const DEFAULT_MEMORY_COUNT = 10;
const MEMORY_CONTENT_TRUNCATE = 120;

/** Read pillar value tolerating both the Pass1Result envelope shape
 *  ({id, isPlaceholder}) and a plain string. */
function pillarValue(p: unknown): string {
  if (typeof p === "string") return p;
  if (p && typeof p === "object" && "id" in p && typeof (p as { id: unknown }).id === "string") {
    return (p as { id: string }).id;
  }
  return "";
}

/** Read tagline tolerating both Pass1Result envelope and plain string. */
function taglineValue(t: unknown): string {
  if (typeof t === "string") return t;
  if (t && typeof t === "object" && "value" in t && typeof (t as { value: unknown }).value === "string") {
    return (t as { value: string }).value;
  }
  return "";
}

/** Extract sectioned data from Pass1Result. When opts.repoRoot is set
 *  and a paired .anatomy-memory file exists, the top-N decay-weighted
 *  entries are surfaced under the memory section. */
export function buildSections(r: Pass1Result, opts: RenderOptions): AgentsMdSections {
  const id = r.identity;
  const stack = pillarValue((id as unknown as Record<string, unknown>).stack);
  const form = pillarValue((id as unknown as Record<string, unknown>).form);
  const domain = pillarValue((id as unknown as Record<string, unknown>).domain);
  const fn = pillarValue((id as unknown as Record<string, unknown>).function);
  const fingerprint = id.fingerprint;

  const commit = r.commit ?? "unknown";
  const by = r.generatorId ?? "anatomy-cli";
  const banner: string[] = [
    `> **${formatRegenBannerLine(commit, by)}**`,
    `> DO NOT EDIT — changes will be overwritten on next \`anatomy render\`.`,
    `> Edit \`.anatomy\` instead, then run \`anatomy render\`.`,
    `> If your HEAD ≠ \`${commit}\`, this file may be stale — re-run \`anatomy render\`.`,
  ];

  const cmds = r.operation?.commands ?? {};
  const commands = Object.keys(cmds).map((k) => ({ name: k, cmd: String(cmds[k]) }));

  const structure = (r.structure?.entries ?? []).map((e) => ({
    path: e.path,
    purpose: e.purpose,
  }));

  const rules = (r.rules ?? []).map((rule) => ({
    rule: rule.rule,
    why: rule.why || undefined,
  }));

  const flows = (r.flows ?? []).map((f) => ({ name: f.name, summary: f.summary }));
  const decisions = (r.decisions ?? []).map((d) => ({ topic: d.topic, reason: d.reason }));

  // Memory — only when repoRoot is provided AND a paired .anatomy-memory exists.
  const memory: AgentsMdSections["memory"] = [];
  if (opts.repoRoot) {
    const memPath = memoryPath(opts.repoRoot);
    if (existsSync(memPath)) {
      try {
        const memoryRaw = readFileSync(memPath, "utf8");
        const memoryDoc = parseMemoryDoc(memoryRaw);
        const fileMemCount = (r as unknown as { generate?: { agents_md_memory_count?: number } })
          .generate?.agents_md_memory_count;
        const limit = opts.agentsMdMemoryCount ?? fileMemCount ?? DEFAULT_MEMORY_COUNT;
        const top = selectTopMemoryEntries(memoryDoc.entries, limit);
        for (const e of top) {
          const date = e.at.slice(0, 10);
          const truncated = e.content.length > MEMORY_CONTENT_TRUNCATE
            ? e.content.slice(0, MEMORY_CONTENT_TRUNCATE - 1) + "…"
            : e.content;
          memory.push({ kind: e.kind, date, topic: e.topic, content: truncated });
        }
      } catch {
        // Malformed memory file: silently emit no memory section. The
        // validator surfaces memory errors separately via `anatomy validate`.
      }
    }
  }

  const footer: string[] = [
    "---",
    "",
    `*Fingerprint: \`${fingerprint}\` · Schema: \`${SCHEMA_URL}\`*`,
    `*Machine-readable source: [\`.anatomy\`](.anatomy) · Memory log: [\`.anatomy-memory\`](.anatomy-memory)*`,
  ];

  // v0.14 keyDeps from substance.keyDependencies (filtered to non-placeholder).
  // Each entry may carry an optional 'version' field (attached by Pass 2's
  // applyAiFill via any-cast since Pass1Result type doesn't model it).
  const keyDeps = r.substance.keyDependencies
    .filter(d => !d.isPlaceholder)
    .map(d => {
      const ver = (d as unknown as { version?: string }).version;
      return ver ? { name: d.name, version: ver, why: d.why } : { name: d.name, why: d.why };
    });

  // v0.14 quick-reference fields. Built only when at least one is present.
  const richFields = r as unknown as {
    author?: string; license?: string; docs_url?: string; repository_url?: string;
  };
  const hasAnyRich = richFields.author || richFields.license || richFields.docs_url || richFields.repository_url;
  const quickReference = hasAnyRich
    ? {
        author: richFields.author,
        license: richFields.license,
        docsUrl: richFields.docs_url,
        repositoryUrl: richFields.repository_url,
      }
    : undefined;

  return {
    title: `# ${stack} ${form} · ${domain} · ${fn}`,
    banner,
    tagline: taglineValue(r.tagline) || undefined,
    quickReference,
    description: r.description,
    commands,
    structure,
    rules,
    flows,
    decisions,
    keyDeps,
    memory,
    footer,
    truncated: false,
  };
}

// Rich-mode budget: bumped from the global 3000 default to 4000 because
// rich content (Quick reference + key dependencies + a longer description)
// adds ~500-1000 tokens above a baseline anatomy.
const RICH_MODE_BUDGET_TOKENS = 4000;

export function renderAgentsMd(r: Pass1Result, opts: RenderOptions): string {
  const fileBudget = (r as unknown as { generate?: { agents_md_budget?: number } }).generate?.agents_md_budget;
  // If the file has rich-mode quick-reference fields, default to a higher budget.
  const richFields = r as unknown as {
    author?: string; license?: string; docs_url?: string; repository_url?: string;
  };
  const isRich = !!(richFields.author || richFields.license || richFields.docs_url || richFields.repository_url);
  const defaultBudget = isRich ? RICH_MODE_BUDGET_TOKENS : DEFAULT_BUDGET_TOKENS;
  const budget = opts.agentsMdBudgetTokens ?? fileBudget ?? defaultBudget;
  const sections = buildSections(r, opts);
  const final = applyBudget(sections, budget);
  return renderSections(final);
}

export function renderAgentsMdArtifact(r: Pass1Result, opts: RenderOptions): RenderArtifact {
  return { path: "AGENTS.md", content: renderAgentsMd(r, opts) };
}
