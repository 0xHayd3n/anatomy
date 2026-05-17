// src/pass1/structure.ts
// Top-level dir walker + kind classifier per spec §4.4.
// Exact basename match (case-insensitive) against a closed-name table.
// Skips dotfiles, node_modules, target, dist, build entirely.
// Tier 1 enrichment: tries subdir package.json description then README
// first paragraph before falling back to a TODO placeholder.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Pass1Result, StructureKind } from "../types.js";
import { debug } from "../log.js";

const KIND_TABLE: Record<string, StructureKind> = {
  // source
  src: "source", source: "source", lib: "source", app: "source", apps: "source",
  packages: "source", crates: "source", cmd: "source", internal: "source", pkg: "source",
  // tests
  test: "tests", tests: "tests", __tests__: "tests", spec: "tests", specs: "tests", e2e: "tests",
  // docs
  doc: "docs", docs: "docs", documentation: "docs",
  // config
  config: "config", conf: "config", configuration: "config",
  // build
  dist: "build", build: "build", target: "build", out: "build", output: "build",
  // scripts
  script: "scripts", scripts: "scripts", tools: "scripts", bin: "scripts",
  // examples
  example: "examples", examples: "examples", samples: "examples",
  // generated
  gen: "generated", generated: "generated", __generated__: "generated",
};

const SKIP_ENTIRELY = new Set([".git", "node_modules", "target", "dist", "build"]);

// Schema cap on [structure].entries is 25; emit at most that many.
const STRUCTURE_ENTRIES_CAP = 25;
const WALKER_HARD_LIMIT = 1000;
const MAX_SUBDIR_FILE_BYTES = 512_000; // 512 KB — large enough for any real subdir README

function classify(name: string): StructureKind {
  return KIND_TABLE[name.toLowerCase()] ?? "other";
}

const PURPOSE_MAX = 120;

function capPurpose(text: string): string {
  if (text.length <= PURPOSE_MAX) return text;
  const cut = text.lastIndexOf(" ", PURPOSE_MAX);
  return cut > 0 ? text.slice(0, cut) : text.slice(0, PURPOSE_MAX);
}

function stripMarkdownLinks(text: string): string {
  // [label](url) → label
  return text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
}

function firstParagraph(text: string): string | null {
  const paragraphs = text.split(/\r?\n\s*\r?\n/);
  for (const para of paragraphs) {
    const cleaned = para.split(/\r?\n/)
      .filter(l => !l.trim().startsWith("#") && !l.trim().startsWith("<"))
      .join(" ")
      .trim();
    if (cleaned.length > 0) return capPurpose(stripMarkdownLinks(cleaned));
  }
  return null;
}

function readSubdirPurpose(dirPath: string, rootDescription?: string): string | null {
  // Try package.json description — skip if it matches the root repo's description
  // (subpackages often copy the root tagline verbatim, which is useless as a purpose)
  try {
    const raw = readFileSync(join(dirPath, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.description === "string" && parsed.description.trim()) {
      const desc = parsed.description.trim();
      const isRootCopy = rootDescription && (() => {
        const d = desc.toLowerCase();
        const r = rootDescription.toLowerCase();
        return d === r || r.includes(d) || d.includes(r);
      })();
      if (!isRootCopy) return capPurpose(desc);
    }
  } catch {}
  // Try README first paragraph (skip oversized files)
  for (const name of ["README.md", "README.rst", "README.txt", "README"]) {
    try {
      const filePath = join(dirPath, name);
      if (statSync(filePath).size > MAX_SUBDIR_FILE_BYTES) continue;
      const raw = readFileSync(filePath, "utf8");
      const para = firstParagraph(raw);
      if (para) return para;
    } catch {}
  }
  return null;
}

export function deriveStructure(repoRoot: string, rootDescription?: string): Pass1Result["structure"] {
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(repoRoot, { withFileTypes: true });
  } catch {
    return { entries: [] };
  }
  if (entries.length > WALKER_HARD_LIMIT) {
    debug(`structure: top-level entry count ${entries.length} exceeds hard limit ${WALKER_HARD_LIMIT}; truncating`);
    entries = entries.slice(0, WALKER_HARD_LIMIT);
  }
  const out: Pass1Result["structure"]["entries"] = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    if (ent.name.startsWith(".")) continue;        // dotfile skip
    if (SKIP_ENTIRELY.has(ent.name)) continue;     // closed-list skip
    const subdirPath = join(repoRoot, ent.name);
    const purpose = readSubdirPurpose(subdirPath, rootDescription);
    out.push({
      path: `${ent.name}/`,
      purpose: purpose ?? "TODO describe purpose",
      kind: classify(ent.name),
      isPlaceholder: purpose === null,
    });
  }
  // Deterministic order: lexicographic by path. Cap at schema's maxItems.
  out.sort((a, b) => a.path.localeCompare(b.path));
  const capped = out.slice(0, STRUCTURE_ENTRIES_CAP);
  debug(`structure: ${out.length} entries discovered, ${capped.length} emitted (cap=${STRUCTURE_ENTRIES_CAP})`);
  return { entries: capped };
}
