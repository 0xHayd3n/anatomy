// src/render/budget.ts
// AGENTS.md sectioned model + drop/truncate logic. Sections are dropped
// in this priority order until the rendered string fits the budget:
//   1. Memory tail (drop oldest)
//   2. Decision reason text -> first sentence
//   3. Flow summary text -> first sentence
//   4. Structure entries -> top-level dirs only
//   5. Key deps why text -> truncate to 60 chars
//   6. Drop key deps section entirely
//   7. Drop decisions section entirely
//   8. Drop flows section entirely
//   9. Trim rules from end (keep at least 1)
// If even step 9 doesn't fit, returns truncated content with truncated:true
// rather than throwing. Always returns; the truncation banner signals what
// happened. Commands and the first rule are the load-bearing minimum.
// (BudgetExceededError is retained as an export for back-compat with any
// downstream that might catch it, but applyBudget no longer throws it.)

import { estimateTokens } from "./token-count.js";

export interface AgentsMdSections {
  title: string;
  banner: string[];
  tagline?: string;
  /** v0.14 quick-reference: author/license/docs URL/repo URL. Rendered
   *  between tagline and description when any field is present. */
  quickReference?: {
    author?: string;
    license?: string;
    docsUrl?: string;
    repositoryUrl?: string;
  };
  description?: string;
  commands: { name: string; cmd: string }[];     // never dropped/truncated
  structure: { path: string; purpose: string }[];
  rules: { rule: string; why?: string }[];       // load-bearing minimum: at least 1 always retained
  flows: { name: string; summary: string }[];
  decisions: { topic: string; reason: string }[];
  /** v0.14: includes optional version. Rendered as "name (version) — why". */
  keyDeps: { name: string; version?: string; why: string }[];
  memory: { kind: string; date: string; topic: string; content: string }[];
  footer: string[];
  /** True when applyBudget had to drop or truncate something. */
  truncated: boolean;
  /** Budget value to display in the truncation footer. */
  budgetTokens?: number;
}

export class BudgetExceededError extends Error {
  constructor(message: string, public minTokens: number) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

/** Join a sectioned model into the final AGENTS.md markdown string.
 *  Section order is normative — see the design doc Section 2. */
export function renderSections(s: AgentsMdSections): string {
  const out: string[] = [];

  // Title
  out.push(s.title);
  out.push("");

  // Banner
  for (const line of s.banner) out.push(line);
  out.push("");

  // Tagline
  if (s.tagline) { out.push(s.tagline); out.push(""); }

  // Quick reference (v0.14): author/license/docs/repo as bullet list.
  // Appears between tagline and description when any field is filled.
  if (s.quickReference) {
    const qr = s.quickReference;
    const lines: string[] = [];
    if (qr.docsUrl)        lines.push(`- **Docs:** ${qr.docsUrl}`);
    if (qr.repositoryUrl)  lines.push(`- **Repo:** ${qr.repositoryUrl}`);
    if (qr.license)        lines.push(`- **License:** ${qr.license}`);
    if (qr.author)         lines.push(`- **Maintainer:** ${qr.author}`);
    if (lines.length > 0) {
      out.push("## Quick reference");
      for (const l of lines) out.push(l);
      out.push("");
    }
  }

  // Description
  if (s.description) { out.push(s.description); out.push(""); }

  // Commands — fenced shell block
  if (s.commands.length > 0) {
    out.push("## Commands");
    out.push("```sh");
    for (const c of s.commands) {
      out.push(`# ${c.name}`);
      out.push(c.cmd);
    }
    out.push("```");
    out.push("");
  }

  // Project structure
  if (s.structure.length > 0) {
    out.push("## Project structure");
    for (const e of s.structure) {
      out.push(`- \`${e.path}\` — ${e.purpose}`);
    }
    out.push("");
  }

  // Rules
  if (s.rules.length > 0) {
    out.push("## Rules");
    for (const r of s.rules) {
      out.push(`- ${r.rule}`);
      if (r.why) out.push(`  *Why:* ${r.why}`);
    }
    out.push("");
  }

  // Flows
  if (s.flows.length > 0) {
    out.push("## Flows");
    for (const f of s.flows) {
      out.push(`- **${f.name}** — ${f.summary}`);
    }
    out.push("");
  }

  // Key decisions
  if (s.decisions.length > 0) {
    out.push("## Key decisions");
    for (const d of s.decisions) {
      out.push(`- **${d.topic}** — ${d.reason}`);
    }
    out.push("");
  }

  // Key dependencies (v0.14: version suffix when present)
  if (s.keyDeps.length > 0) {
    out.push("## Key dependencies");
    for (const k of s.keyDeps) {
      const ver = k.version ? ` (${k.version})` : "";
      out.push(`- **${k.name}**${ver} — ${k.why}`);
    }
    out.push("");
  }

  // Recent lived experience (memory)
  if (s.memory.length > 0) {
    out.push("## Recent lived experience");
    for (const m of s.memory) {
      out.push(`- **${m.kind}** *(${m.date})* — **${m.topic}**: ${m.content}`);
    }
    out.push("");
  }

  // Truncation footer (before the canonical footer)
  if (s.truncated && s.budgetTokens) {
    out.push(`*Truncated under ${s.budgetTokens}-token budget — see [\`.anatomy\`](.anatomy) for full content.*`);
    out.push("");
  }

  // Footer
  for (const line of s.footer) out.push(line);
  out.push("");

  return out.join("\n");
}

function firstSentence(s: string): string {
  const m = s.match(/^[^.!?]*[.!?]/);
  return m ? m[0] : s;
}

/** Iteratively drop / truncate sections in priority order until the
 *  rendered string is under budgetTokens. Throws BudgetExceededError if
 *  rules + commands alone (load-bearing, never dropped) exceed the budget. */
export function applyBudget(sections: AgentsMdSections, budgetTokens: number): AgentsMdSections {
  const working: AgentsMdSections = structuredClone(sections);
  let truncated = working.truncated;

  const tokens = (): number => estimateTokens(renderSections(working));

  // Step 1: drop memory tail until under budget or empty.
  while (tokens() > budgetTokens && working.memory.length > 0) {
    working.memory.pop();
    truncated = true;
  }
  if (tokens() <= budgetTokens) {
    working.truncated = truncated;
    working.budgetTokens = budgetTokens;
    return working;
  }

  // Step 2: truncate decision reasons to first sentence (if multi-sentence).
  let changed = false;
  for (let i = 0; i < working.decisions.length; i++) {
    const first = firstSentence(working.decisions[i].reason);
    if (first.length < working.decisions[i].reason.length) {
      working.decisions[i] = { ...working.decisions[i], reason: first };
      changed = true;
    }
  }
  if (changed) truncated = true;
  if (tokens() <= budgetTokens) {
    working.truncated = truncated;
    working.budgetTokens = budgetTokens;
    return working;
  }

  // Step 3: truncate flow summaries to first sentence.
  changed = false;
  for (let i = 0; i < working.flows.length; i++) {
    const first = firstSentence(working.flows[i].summary);
    if (first.length < working.flows[i].summary.length) {
      working.flows[i] = { ...working.flows[i], summary: first };
      changed = true;
    }
  }
  if (changed) truncated = true;
  if (tokens() <= budgetTokens) {
    working.truncated = truncated;
    working.budgetTokens = budgetTokens;
    return working;
  }

  // Step 4: collapse structure entries to top-level dirs.
  if (working.structure.length > 0) {
    const topLevel = new Map<string, string>();
    for (const e of working.structure) {
      const top = e.path.split("/")[0] + "/";
      if (!topLevel.has(top)) topLevel.set(top, e.purpose);
    }
    const collapsed = Array.from(topLevel.entries()).map(([path, purpose]) => ({ path, purpose }));
    if (collapsed.length < working.structure.length) {
      working.structure = collapsed;
      truncated = true;
    }
  }
  if (tokens() <= budgetTokens) {
    working.truncated = truncated;
    working.budgetTokens = budgetTokens;
    return working;
  }

  // Step 5: truncate key-deps why to 60 chars with ellipsis.
  changed = false;
  for (let i = 0; i < working.keyDeps.length; i++) {
    if (working.keyDeps[i].why.length > 60) {
      working.keyDeps[i] = {
        ...working.keyDeps[i],
        why: working.keyDeps[i].why.slice(0, 57) + "...",
      };
      changed = true;
    }
  }
  if (changed) truncated = true;
  if (tokens() <= budgetTokens) {
    working.truncated = truncated;
    working.budgetTokens = budgetTokens;
    return working;
  }

  // Step 6: drop keyDeps section entirely.
  if (working.keyDeps.length > 0) {
    working.keyDeps = [];
    truncated = true;
  }
  if (tokens() <= budgetTokens) {
    working.truncated = truncated;
    working.budgetTokens = budgetTokens;
    return working;
  }

  // Step 7: drop decisions section entirely.
  if (working.decisions.length > 0) {
    working.decisions = [];
    truncated = true;
  }
  if (tokens() <= budgetTokens) {
    working.truncated = truncated;
    working.budgetTokens = budgetTokens;
    return working;
  }

  // Step 8: drop flows section entirely.
  if (working.flows.length > 0) {
    working.flows = [];
    truncated = true;
  }
  if (tokens() <= budgetTokens) {
    working.truncated = truncated;
    working.budgetTokens = budgetTokens;
    return working;
  }

  // Step 9: trim rules from the end (keep at least 1).
  while (tokens() > budgetTokens && working.rules.length > 1) {
    working.rules.pop();
    truncated = true;
  }

  // Soft floor: even if we're still over budget, return what we have. The
  // truncation banner in renderSections will signal what happened. We never
  // throw — that broke real-world generation in the eval (hono case).
  working.truncated = truncated;
  working.budgetTokens = budgetTokens;
  return working;
}
