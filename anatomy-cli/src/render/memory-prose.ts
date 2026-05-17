// src/render/memory-prose.ts
// Render the memory section appended to `anatomy show --prose`.
// Default selection: all conventions, last 10 decisions, last 10 gotchas, last 5 attempts, last 5 milestones.
// "Active" = not superseded, not deprecated.

import type { MemoryDoc, MemoryEntry, EntryKind } from "../memory/io.js";

export interface MemoryProseOptions {
  limitGotcha?: number;
  limitDecision?: number;
  limitAttempt?: number;
  limitMilestone?: number;
  limitConvention?: number; // optional override; default = no cap
}

const DEFAULT_LIMITS: Required<Omit<MemoryProseOptions, "limitConvention">> & { limitConvention: number | null } = {
  limitGotcha: 10,
  limitDecision: 10,
  limitAttempt: 5,
  limitMilestone: 5,
  limitConvention: null, // null = uncapped
};

function isActive(e: MemoryEntry): boolean {
  return !e.superseded_by && !e.deprecated_at;
}

function byKind(entries: MemoryEntry[], kind: EntryKind): MemoryEntry[] {
  return entries.filter(e => e.kind === kind);
}

export function renderMemoryProse(doc: MemoryDoc, opts: MemoryProseOptions = {}): string {
  const entries = doc.entries;
  if (entries.length === 0) return "";

  // Per-field nullish-coalesce: a spread-merge ({...defaults, ...opts}) would
  // let opts.limitX = undefined override DEFAULT_LIMITS.limitX, which makes
  // take(arr, undefined) compute hidden = NaN and silently suppress the
  // "X older entries not shown" footer.
  const limits = {
    limitGotcha:     opts.limitGotcha     ?? DEFAULT_LIMITS.limitGotcha,
    limitDecision:   opts.limitDecision   ?? DEFAULT_LIMITS.limitDecision,
    limitAttempt:    opts.limitAttempt    ?? DEFAULT_LIMITS.limitAttempt,
    limitMilestone:  opts.limitMilestone  ?? DEFAULT_LIMITS.limitMilestone,
    limitConvention: opts.limitConvention ?? DEFAULT_LIMITS.limitConvention,
  };
  const active = entries.filter(isActive);

  const counts = {
    gotcha: byKind(active, "gotcha").length,
    decision: byKind(active, "decision").length,
    convention: byKind(active, "convention").length,
    attempt: byKind(active, "attempt").length,
    milestone: byKind(active, "milestone").length,
  };
  const total = entries.length;

  const lines: string[] = [];
  lines.push("");
  lines.push(`## Memory (${total} entries — ${counts.gotcha} gotcha · ${counts.decision} decision · ${counts.convention} convention · ${counts.attempt} attempt · ${counts.milestone} milestone)`);

  function take<T>(arr: T[], n: number | null): { shown: T[]; hidden: number } {
    if (n === null || arr.length <= n) return { shown: arr, hidden: 0 };
    // arr is sorted newest-first by caller — take first n
    return { shown: arr.slice(0, n), hidden: arr.length - n };
  }

  function activeByKindNewestFirst(kind: EntryKind): MemoryEntry[] {
    return byKind(active, kind).slice().reverse(); // input is oldest-first append order
  }

  let totalHidden = 0;

  // Conventions — uncapped by default
  const conv = activeByKindNewestFirst("convention");
  const convPick = take(conv, limits.limitConvention);
  if (convPick.shown.length > 0) {
    lines.push("");
    lines.push("### Conventions");
    for (const e of convPick.shown) lines.push(`[${e.id}] ${e.topic} — ${e.content}`);
  }
  totalHidden += convPick.hidden;

  // Decisions
  const dec = activeByKindNewestFirst("decision");
  const decPick = take(dec, limits.limitDecision);
  if (decPick.shown.length > 0) {
    lines.push("");
    lines.push(`### Recent decisions (${decPick.shown.length})`);
    for (const e of decPick.shown) {
      lines.push(`[${e.id}] ${e.at.slice(0, 10)} ${e.by} — ${e.topic}`);
      lines.push(`  ${e.content}`);
    }
  }
  totalHidden += decPick.hidden;

  // Gotchas
  const got = activeByKindNewestFirst("gotcha");
  const gotPick = take(got, limits.limitGotcha);
  if (gotPick.shown.length > 0) {
    lines.push("");
    lines.push(`### Recent gotchas (${gotPick.shown.length})`);
    for (const e of gotPick.shown) {
      lines.push(`[${e.id}] ${e.at.slice(0, 10)} ${e.by} — ${e.topic}`);
      lines.push(`  ${e.content}`);
    }
  }
  totalHidden += gotPick.hidden;

  // Attempts
  const att = activeByKindNewestFirst("attempt");
  const attPick = take(att, limits.limitAttempt);
  if (attPick.shown.length > 0) {
    lines.push("");
    lines.push(`### Recent attempts (${attPick.shown.length})`);
    for (const e of attPick.shown) {
      lines.push(`[${e.id}] ${e.at.slice(0, 10)} ${e.by} — ${e.topic}`);
      lines.push(`  ${e.content}`);
    }
  }
  totalHidden += attPick.hidden;

  // Milestones
  const mile = activeByKindNewestFirst("milestone");
  const milePick = take(mile, limits.limitMilestone);
  if (milePick.shown.length > 0) {
    lines.push("");
    lines.push(`### Recent milestones (${milePick.shown.length})`);
    for (const e of milePick.shown) {
      lines.push(`[${e.id}] ${e.at.slice(0, 10)} ${e.by} — ${e.topic}`);
      lines.push(`  ${e.content}`);
    }
  }
  totalHidden += milePick.hidden;

  if (totalHidden > 0) {
    lines.push("");
    lines.push(`${totalHidden} older entries not shown — \`anatomy memory grep "<term>"\` to query.`);
  }

  return lines.join("\n") + "\n";
}
