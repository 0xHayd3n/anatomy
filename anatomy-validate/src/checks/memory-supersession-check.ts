// src/checks/memory-supersession-check.ts
// Cross-entry referential integrity: every superseded_by must point to an
// existing id; the supersession graph must be acyclic.

import type { ValidationError, Warning } from "../errors.js";

interface Entry {
  id?: unknown;
  superseded_by?: unknown;
}

export function memorySupersessionCheck(
  doc: unknown,
): { errors: ValidationError[]; warnings: Warning[] } {
  const errors: ValidationError[] = [];
  const d = doc as { entries?: unknown };
  const entries = Array.isArray(d.entries) ? (d.entries as Entry[]) : [];
  if (entries.length === 0) return { errors, warnings: [] };

  const idIndex = new Map<string, number>();
  for (let i = 0; i < entries.length; i++) {
    const id = entries[i].id;
    if (typeof id === "string") idIndex.set(id, i);
  }

  // Existence check
  for (let i = 0; i < entries.length; i++) {
    const sb = entries[i].superseded_by;
    if (typeof sb === "string" && !idIndex.has(sb)) {
      errors.push({
        code: "memory-supersedes-not-found",
        message: `entry references superseded_by="${sb}" but no entry with that id exists`,
        pointer: `/entries/${i}/superseded_by`,
      });
    }
  }

  // Cycle check (DFS coloring)
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Array<number>(entries.length).fill(WHITE);
  const cycleReported = new Set<number>();

  function visit(i: number): boolean {
    if (color[i] === GRAY) return true;
    if (color[i] === BLACK) return false;
    color[i] = GRAY;
    const sb = entries[i].superseded_by;
    if (typeof sb === "string") {
      const next = idIndex.get(sb);
      if (next !== undefined && visit(next)) {
        if (!cycleReported.has(i)) {
          errors.push({
            code: "memory-supersedes-cycle",
            message: `supersession chain forms a cycle starting at entry "${entries[i].id}"`,
            pointer: `/entries/${i}/superseded_by`,
          });
          cycleReported.add(i);
        }
        return true;
      }
    }
    color[i] = BLACK;
    return false;
  }

  for (let i = 0; i < entries.length; i++) {
    if (color[i] === WHITE) visit(i);
  }

  return { errors, warnings: [] };
}
