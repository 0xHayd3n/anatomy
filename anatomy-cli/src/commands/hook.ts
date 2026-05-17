// src/commands/hook.ts
// `anatomy hook` — emits markdown for SessionStart injection.
// Resolves nearest .anatomy, applies token budget, prepends staleness banner.

import { resolveAnatomy } from "../resolve.js";
import { recordTelemetry } from "../telemetry.js";
import { pillarString } from "../render/identity.js";
import type { AnatomyDoc } from "@anatomy/validate";

export interface HookOptions {
  root?: boolean;
  maxTokens?: number;
  json?: boolean;
}

const DEFAULT_MAX_TOKENS = 1200;
const CHARS_PER_TOKEN = 4;

function estimateTokens(s: string): number {
  return Math.ceil(s.length / CHARS_PER_TOKEN);
}

interface Section {
  name: string;
  markdown: string;
  required: boolean;
}

function renderHeader(doc: AnatomyDoc): string {
  const lines = [`# Repository: ${doc.tagline}`, ""];
  const id = doc.identity;
  // pillarString handles both v0.7 flat strings and v0.1-v0.6 nested {id,hash}.
  lines.push(`\`${pillarString(id.stack)}\` · \`${pillarString(id.form)}\` · \`${pillarString(id.domain)}\` · \`${pillarString(id.function)}\``);
  return lines.join("\n");
}

function renderRules(doc: AnatomyDoc): string | null {
  const rules = doc.rules;
  if (!rules) return null;
  const lines = ["## Rules"];
  for (const r of rules) {
    lines.push(`- ${r.rule}`);
    if (r.why) lines.push(`  *Why: ${r.why}*`);
  }
  return lines.join("\n");
}

function renderDecisions(doc: AnatomyDoc): string | null {
  const ds = doc.decisions;
  if (!ds) return null;
  const lines = ["## Decisions"];
  for (const d of ds) lines.push(`- **${d.topic}**: ${d.reason}`);
  return lines.join("\n");
}

function renderFlows(doc: AnatomyDoc): string | null {
  const fs = doc.flows;
  if (!fs) return null;
  const lines = ["## Flows"];
  for (const f of fs) lines.push(`- **${f.name}**: ${f.summary}`);
  return lines.join("\n");
}

function renderCommands(doc: AnatomyDoc): string | null {
  const cmds = doc.operation?.commands;
  if (!cmds || Object.keys(cmds).length === 0) return null;
  const lines = ["## Commands"];
  for (const [k, v] of Object.entries(cmds)) lines.push(`- \`${k}\`: \`${v}\``);
  return lines.join("\n");
}

function renderEntryPoints(doc: AnatomyDoc): string | null {
  const eps = doc.operation?.entry_points;
  if (!eps || eps.length === 0) return null;
  const lines = ["## Entry points"];
  for (const ep of eps) {
    const tail = ep.purpose ?? ep.description;
    lines.push(`- \`${ep.path}\` (${ep.role})${tail ? ` — ${tail}` : ""}`);
  }
  return lines.join("\n");
}

function buildSections(doc: AnatomyDoc): Section[] {
  const out: Section[] = [];
  out.push({ name: "header", markdown: renderHeader(doc), required: true });
  for (const [name, fn] of [
    ["rules", renderRules],
    ["decisions", renderDecisions],
    ["flows", renderFlows],
    ["commands", renderCommands],
    ["entry_points", renderEntryPoints],
  ] as const) {
    const md = fn(doc);
    if (md) out.push({ name, markdown: md, required: name === "rules" });
  }
  return out;
}

/** Trim a rendered rules section by dropping whole rule entries from the end.
 *
 *  Each entry is a bullet line ("- rule text") followed by zero or more
 *  indented continuation lines (the "*Why: ...*" explanation). Trimming by
 *  raw chars (the prior approach) could leave a rule's bullet but strip its
 *  "why" — splitting a single rule across the truncation boundary. Dropping
 *  whole entries preserves rule integrity at the cost of ellipsis marking.
 */
function trimRulesByEntry(markdown: string, maxChars: number): string {
  if (markdown.length <= maxChars) return markdown;

  const lines = markdown.split("\n");
  const header = lines[0]; // "## Rules"

  // Group continuation lines (anything not starting with "- ") with the
  // preceding bullet entry. Pre-bullet content (rare, defensive) gets
  // attached to the first entry as-is.
  const entries: string[][] = [];
  for (const line of lines.slice(1)) {
    if (line.startsWith("- ") || entries.length === 0) {
      entries.push([line]);
    } else {
      entries[entries.length - 1].push(line);
    }
  }

  const ellipsis = "…";
  // Drop entries from the end until the trial render fits.
  while (entries.length > 0) {
    const trial = [header, ...entries.map(e => e.join("\n")), ellipsis].join("\n");
    if (trial.length <= maxChars) return trial;
    entries.pop();
  }
  // Even header + ellipsis may exceed maxChars at extreme budgets; surface
  // the minimum (caller's contract is "never drop the rules section entirely
  // when any rules existed", not "always fit the budget").
  return [header, ellipsis].join("\n");
}

function applyBudget(sections: Section[], maxTokens: number): { kept: Section[]; truncated: boolean } {
  let total = sections.reduce((s, sec) => s + estimateTokens(sec.markdown), 0);
  if (total <= maxTokens) return { kept: sections, truncated: false };

  const kept = [...sections];
  let truncated = false;
  // Drop optional sections from the end until we fit OR only required remain.
  while (total > maxTokens && kept.length > 0) {
    const last = kept[kept.length - 1];
    if (last.required) break;
    total -= estimateTokens(last.markdown);
    kept.pop();
    truncated = true;
  }
  // If still over budget and rules section is present, trim by whole entries
  // (never split a single rule across the truncation boundary; never drop
  // the section entirely if any rules existed).
  if (total > maxTokens) {
    const idx = kept.findIndex(s => s.name === "rules");
    if (idx >= 0) {
      const rules = kept[idx];
      const otherTokens = total - estimateTokens(rules.markdown);
      const rulesBudgetTokens = Math.max(0, maxTokens - otherTokens);
      const rulesBudgetChars = rulesBudgetTokens * CHARS_PER_TOKEN;
      const trimmed = trimRulesByEntry(rules.markdown, rulesBudgetChars);
      if (trimmed !== rules.markdown) {
        kept[idx] = { ...rules, markdown: trimmed };
        truncated = true;
      }
    }
  }
  return { kept, truncated };
}

function fingerprintOf(doc: AnatomyDoc): string {
  return doc.identity?.fingerprint ?? "";
}

/** Truthy values that disable the hook entirely. Mirrors the
 *  ANATOMY_TELEMETRY_DISABLE env-var convention: any non-"0"/"false"/empty
 *  string disables. Used by the mcp-only eval condition (see
 *  docs/superpowers/specs/2026-05-08-eval-methodology-design.md §4) to
 *  decompose hook-vs-MCP contribution without uninstalling the plugin. */
function isHookDisabledByEnv(): boolean {
  const raw = process.env.ANATOMY_HOOK_DISABLE;
  if (!raw) return false;
  if (raw === "0") return false;
  if (raw.toLowerCase() === "false") return false;
  return true;
}

export async function hookCommand(opts: HookOptions): Promise<number> {
  // Eval-mode opt-out: emit no markdown so an mcp-only eval condition can
  // measure MCP-only behavior without the SessionStart hook contribution.
  if (isHookDisabledByEnv()) return 0;

  const cwd = process.cwd();
  let result = await resolveAnatomy(cwd);

  if ("error" in result) {
    if (result.error === "anatomy_not_found") {
      // Silent — exit 0, no output.
      return 0;
    }
    if (result.error === "validation_failed") {
      process.stdout.write(`> anatomy_error: ${result.code} at ${result.pointer} — ${result.message}\n`);
      return 0;
    }
    return 0;
  }

  if (opts.root) {
    const rootResult = await resolveAnatomy(result.repo_root, { repoRoot: result.repo_root });
    if ("error" in rootResult) {
      if (rootResult.error === "anatomy_not_found") {
        return 0; // silent
      }
      if (rootResult.error === "validation_failed") {
        process.stdout.write(`> anatomy_error: ${rootResult.code} at ${rootResult.pointer} — ${rootResult.message}\n`);
        return 0;
      }
      return 0;
    }
    result = rootResult;
  }

  const { doc, staleness } = result;
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;

  if (opts.json) {
    process.stdout.write(JSON.stringify(doc) + "\n");
    recordTelemetry({
      kind: "hook_fire",
      ts: new Date().toISOString(),
      repo_fingerprint: fingerprintOf(doc),
      cwd,
      sections: ["json"],
      tokens_estimated: estimateTokens(JSON.stringify(doc)),
      truncated: false,
      stale: staleness !== null,
    });
    return 0;
  }

  const allSections = buildSections(doc);
  const { kept, truncated } = applyBudget(allSections, maxTokens);

  const parts: string[] = [];
  if (staleness) {
    parts.push(`> staleness: file at ${staleness.file_commit}, HEAD at ${staleness.head_commit}`);
  }
  for (const s of kept) parts.push(s.markdown);
  process.stdout.write(parts.join("\n\n") + "\n");

  recordTelemetry({
    kind: "hook_fire",
    ts: new Date().toISOString(),
    repo_fingerprint: fingerprintOf(doc),
    cwd,
    sections: kept.map(s => s.name),
    tokens_estimated: kept.reduce((sum, s) => sum + estimateTokens(s.markdown), 0),
    truncated,
    stale: staleness !== null,
  });
  return 0;
}
