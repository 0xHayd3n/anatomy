// src/verify-suggest/prompt.ts
// readline-based per-rule interactive prompt. Supports [a]ccept / [r]eject /
// [e]dit / [s]kip / [q]uit. Edit opens $EDITOR with the candidate clause.

import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import type { RuleSuggestion, VerifyCandidate, DryRunResult } from "./types.js";

export type PromptAction =
  | { kind: "accept"; candidate: VerifyCandidate }
  | { kind: "reject" }
  | { kind: "skip" }
  | { kind: "quit" };

export interface PromptIO {
  stdin: Readable;
  stdout: Writable;
}

export interface PromptDeps {
  io: PromptIO;
  /** Called after the user's editor returns a candidate. Returns the dry-run
   *  result. The prompt loop uses this to validate edits before accepting. */
  dryRunCandidate?: (candidate: VerifyCandidate) => Promise<DryRunResult>;
}

function renderSuggestion(sug: RuleSuggestion, total: number): string {
  const lines: string[] = [];
  lines.push("─".repeat(77));
  lines.push(`Rule ${sug.ruleIndex + 1} of ${total}: "${sug.rule.rule}"`);
  if (sug.rule.why) lines.push(`  why: ${sug.rule.why}`);
  lines.push("");
  if (!sug.candidate) {
    lines.push("  No static verifier feasible (no source produced a viable candidate).");
    lines.push("  Per-rule staleness will report status='unverified' for this rule.");
    lines.push("");
    lines.push("  Press Enter to continue (or [q]uit).");
  } else {
    lines.push(`  Source: ${sug.source}`);
    lines.push(`  Proposed verify clause:`);
    for (const [k, v] of Object.entries(sug.candidate)) {
      lines.push(`    ${k} = ${typeof v === "string" ? `"${v}"` : v}`);
    }
    if (sug.dryRun?.hits.length) {
      const h = sug.dryRun.hits[0];
      lines.push(`  Dry-run: passed, sample hit at ${h.file}:${h.line}`);
    } else if (sug.dryRun?.accepted) {
      lines.push(`  Dry-run: passed, no current hits`);
    }
    lines.push("");
    lines.push(`  [a]ccept / [r]eject / [e]dit / [s]kip / [q]uit  ?`);
  }
  lines.push("─".repeat(77));
  return lines.join("\n") + "\n";
}

function candidateToTomlInline(c: VerifyCandidate): string {
  const parts: string[] = [`kind = "${c.kind}"`];
  for (const [k, v] of Object.entries(c)) {
    if (k === "kind") continue;
    if (typeof v === "string") parts.push(`${k} = "${v.replace(/"/g, '\\"')}"`);
    else if (typeof v === "boolean") parts.push(`${k} = ${v}`);
  }
  return `{ ${parts.join(", ")} }`;
}

function openEditor(candidate: VerifyCandidate): VerifyCandidate | null {
  const editor = process.env.EDITOR || (process.platform === "win32" ? "notepad" : null);
  if (!editor) return null;
  const tmp = join(tmpdir(), `anatomy-verify-edit-${process.pid}.toml`);
  const initial = `# Edit the verify clause, then save and quit.\n# Format: TOML inline table.\nv = ${candidateToTomlInline(candidate)}\n`;
  writeFileSync(tmp, initial, "utf8");
  const r = spawnSync(editor, [tmp], { stdio: "inherit", shell: true });
  if (r.status !== 0) { try { unlinkSync(tmp); } catch {} return null; }
  let parsed: unknown;
  try {
    const text = readFileSync(tmp, "utf8");
    parsed = parseToml(text);
  } catch {
    try { unlinkSync(tmp); } catch {}
    return null;
  }
  try { unlinkSync(tmp); } catch {}
  const v = (parsed as { v?: unknown }).v;
  if (v && typeof v === "object" && "kind" in (v as object)) {
    return v as VerifyCandidate;
  }
  return null;
}

interface LineReader {
  next(): Promise<string>;
}

function makeLineReader(rl: ReturnType<typeof createInterface>): LineReader {
  // Buffer line events so a fast stream (Readable.from a single chunk in
  // tests) doesn't drop lines between consumers. Resolve outstanding waits
  // on 'close' with empty string so callers terminate cleanly instead of
  // hitting rl.question's "readline was closed" rejection.
  const queued: string[] = [];
  const waiters: ((line: string) => void)[] = [];
  let closed = false;
  rl.on("line", (line: string) => {
    const w = waiters.shift();
    if (w) w(line); else queued.push(line);
  });
  rl.on("close", () => {
    closed = true;
    while (waiters.length) waiters.shift()!("");
  });
  return {
    next(): Promise<string> {
      const q = queued.shift();
      if (q !== undefined) return Promise.resolve(q);
      if (closed) return Promise.resolve("");
      return new Promise(resolve => waiters.push(resolve));
    },
  };
}

export async function promptForSuggestion(
  sug: RuleSuggestion,
  deps: PromptDeps,
  total = 1,
): Promise<PromptAction> {
  const { io } = deps;
  const rl = createInterface({ input: io.stdin, output: io.stdout });
  const reader = makeLineReader(rl);
  io.stdout.write(renderSuggestion(sug, total));

  if (!sug.candidate) {
    const answer = await reader.next();
    rl.close();
    return answer.trim().toLowerCase() === "q" ? { kind: "quit" } : { kind: "skip" };
  }

  // After the null check above, candidate is guaranteed non-null. Track it
  // separately so edit-driven reassignment preserves the type narrowing.
  let candidate: VerifyCandidate = sug.candidate;

  while (true) {
    io.stdout.write("> ");
    const answer = await reader.next();
    const key = answer.trim().toLowerCase();
    switch (key) {
      case "a": rl.close(); return { kind: "accept", candidate };
      case "r": rl.close(); return { kind: "reject" };
      case "s": rl.close(); return { kind: "skip" };
      case "q": rl.close(); return { kind: "quit" };
      case "":  // stdin closed mid-prompt — treat as quit
        rl.close();
        return { kind: "quit" };
      case "e": {
        const edited = openEditor(candidate);
        if (!edited) { io.stdout.write("edit cancelled or failed; reprompting\n"); continue; }
        // Re-dry-run the edited candidate.
        let dryRun: DryRunResult | null = null;
        if (deps.dryRunCandidate) {
          dryRun = await deps.dryRunCandidate(edited);
          if (!dryRun.accepted) {
            io.stdout.write(`edit failed dry-run: ${dryRun.reason}\n`);
            continue;
          }
        }
        // Re-render with the new candidate + dry-run result, then loop back for a/r/e/s/q.
        const newSug: RuleSuggestion = { ...sug, candidate: edited, dryRun };
        io.stdout.write(renderSuggestion(newSug, total));
        // Replace the displayed candidate so future edits build on the new one.
        candidate = edited;
        continue;
      }
      default:
        io.stdout.write(`invalid: '${answer.trim()}'. Use a/r/e/s/q.\n`);
    }
  }
}
