// src/checks/nested-path-escape.ts
// When anatomyDir is supplied, every path-bearing field MUST resolve within
// the anatomy's directory after lexical normalisation. The check uses POSIX
// path semantics (forward slashes, lexical resolution); no filesystem access.

import type { ValidationError, Warning } from "../errors.js";

function escapesScope(rawPath: string): boolean {
  // Lexical normalisation: split on / (path-bearing fields are POSIX-style
  // relative paths per the v0.2 schema), resolve "." and ".." segments,
  // and check whether the depth ever goes negative.
  const segments = rawPath.split("/").filter(s => s.length > 0 && s !== ".");
  let depth = 0;
  for (const seg of segments) {
    if (seg === "..") {
      depth--;
      if (depth < 0) return true;
    } else {
      depth++;
    }
  }
  return false;
}

function checkPath(
  rawPath: unknown,
  pointer: string,
  errors: ValidationError[],
): void {
  if (typeof rawPath !== "string") return;
  if (escapesScope(rawPath)) {
    errors.push({
      code: "nested-path-escape",
      message: `path escapes the anatomy's directory: ${rawPath}`,
      pointer,
      actual: rawPath,
    });
  }
}

export function nestedPathEscapeCheck(doc: unknown, anatomyDir?: string): {
  errors: ValidationError[];
  warnings: Warning[];
} {
  if (anatomyDir === undefined) return { errors: [], warnings: [] };
  const errors: ValidationError[] = [];
  const d = doc as {
    operation?: { entry_points?: Array<{ path?: unknown }> };
    structure?: { entries?: Array<{ path?: unknown }> };
    substance?: Record<string, Array<{ source?: unknown }> | undefined>;
  };

  // entry_points
  const eps = d?.operation?.entry_points;
  if (Array.isArray(eps)) {
    for (let i = 0; i < eps.length; i++) {
      checkPath(eps[i]?.path, `/operation/entry_points/${i}/path`, errors);
    }
  }

  // structure.entries
  const ents = d?.structure?.entries;
  if (Array.isArray(ents)) {
    for (let i = 0; i < ents.length; i++) {
      checkPath(ents[i]?.path, `/structure/entries/${i}/path`, errors);
    }
  }

  // substance.capabilities/limitations source (both forms)
  const subst = d?.substance;
  if (subst) {
    for (const arrName of ["capabilities", "limitations"] as const) {
      const arr = subst[arrName];
      if (!Array.isArray(arr)) continue;
      for (let i = 0; i < arr.length; i++) {
        const src = arr[i]?.source;
        if (typeof src === "string") {
          const hashIdx = src.indexOf("#");
          const pathPart = hashIdx === -1 ? src : src.slice(0, hashIdx);
          checkPath(pathPart, `/substance/${arrName}/${i}/source`, errors);
        } else if (src && typeof src === "object" && typeof (src as { path?: unknown }).path === "string") {
          checkPath((src as { path: string }).path, `/substance/${arrName}/${i}/source/path`, errors);
        }
      }
    }
  }

  return { errors, warnings: [] };
}
