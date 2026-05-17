// src/pass1/interface.ts
// Form-conditional interface variant emission per spec §4.2 step 9.
// In v0.1: only npm produces interface entries (cargo/python/go skip).

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { DetectedManifest, Pass1Result, ExportKind } from "../types.js";

const CMD_TEST_PATTERNS = [".test.", ".spec.", ".test-", ".mocks.", ".mock."];

/** Extract subcommand-style file stems from src/commands/ (or commands/, cmd/).
 *  Used to pre-populate interface.subcommands for CLI tools. */
export function extractCommandNamesFromDir(repoRoot: string): string[] {
  for (const candidate of [join(repoRoot, "src", "commands"), join(repoRoot, "commands"), join(repoRoot, "cmd")]) {
    if (!existsSync(candidate)) continue;
    try {
      if (!statSync(candidate).isDirectory()) continue;
      const files = readdirSync(candidate, { withFileTypes: true })
        .filter(e => e.isFile())
        .map(e => e.name)
        .sort()
        .filter(f => !f.startsWith(".") && !CMD_TEST_PATTERNS.some(p => f.includes(p)));
      const names = files.map(f => basename(f, extname(f))).filter(Boolean).slice(0, 10);
      if (names.length > 0) return names;
    } catch { /* ignore — fall through to next candidate */ }
  }
  return [];
}

export function extractSignature(line: string, kind: string): string | undefined {
  if (kind === "function") {
    const open = line.indexOf("(");
    if (open === -1) return undefined;
    const brace = line.indexOf("{", open);
    const raw = brace !== -1 ? line.slice(open, brace) : line.slice(open).replace(/;$/, "");
    const sig = raw.trimEnd();
    // Must contain a closing paren — otherwise this is a multi-line signature
    if (!sig.includes(")")) return undefined;
    if (sig.length > 200) return undefined;
    return sig;
  }
  if (kind === "type") {
    const eq = line.indexOf("=");
    if (eq === -1) return undefined;
    const semi = line.indexOf(";", eq);
    const raw = semi !== -1 ? line.slice(eq + 1, semi) : line.slice(eq + 1);
    const sig = raw.trim();
    if (sig.length === 0 || sig.length > 200) return undefined;
    return sig;
  }
  return undefined;
}

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? v as Record<string, unknown> : {};
}

function npmSubcommands(parsed: Record<string, unknown>, commandNames?: string[]): Pass1Result["interface"] {
  const bin = parsed.bin;
  const entries: Array<{ name: string; summary: string; isPlaceholder: boolean }> = [];
  if (commandNames && commandNames.length > 0) {
    for (const name of commandNames) {
      entries.push({ name: name.toLowerCase(), summary: "TODO describe subcommand", isPlaceholder: true });
    }
  } else if (typeof bin === "string") {
    const rawName = typeof parsed.name === "string" ? parsed.name : "tool";
    const name = rawName.replace(/^@[^/]+\//, "").toLowerCase();
    entries.push({ name, summary: "TODO describe subcommand", isPlaceholder: true });
  } else if (bin && typeof bin === "object") {
    for (const k of Object.keys(bin as object)) {
      entries.push({ name: k.toLowerCase(), summary: "TODO describe subcommand", isPlaceholder: true });
    }
  }
  if (entries.length === 0) return undefined;
  return { variant: "subcommands", entries };
}

function npmExports(parsed: Record<string, unknown>, repoRoot?: string): Pass1Result["interface"] {
  const exports_ = parsed.exports;
  const entries: Array<{ symbol: string; kind: ExportKind; summary: string; isPlaceholder: boolean; signature?: string }> = [];
  if (typeof exports_ === "string") {
    entries.push({ symbol: ".", kind: "namespace", summary: "TODO describe export", isPlaceholder: true });
  } else if (exports_ && typeof exports_ === "object") {
    for (const k of Object.keys(exports_ as object)) {
      const kind: ExportKind = k === "." ? "namespace" : "function";
      entries.push({ symbol: k, kind, summary: "TODO describe export", isPlaceholder: true });
    }
  } else if (typeof parsed.main === "string") {
    entries.push({ symbol: ".", kind: "namespace", summary: "TODO describe export", isPlaceholder: true });
  }
  if (entries.length === 0) return undefined;
  // Attempt signature extraction from src/index.ts or index.ts
  if (repoRoot && entries.length > 0) {
    const srcFile =
      existsSync(join(repoRoot, "src/index.ts")) ? join(repoRoot, "src/index.ts") :
      existsSync(join(repoRoot, "index.ts")) ? join(repoRoot, "index.ts") : null;
    if (srcFile) {
      try {
        const lines = readFileSync(srcFile, "utf8").split("\n");
        for (const entry of entries) {
          if (entry.kind !== "function" && entry.kind !== "type") continue;
          // Skip path-style symbols like "." or "./util"
          if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(entry.symbol)) continue;
          const prefix = entry.kind === "function"
            ? `export function ${entry.symbol}(`
            : `export type ${entry.symbol} `;
          const line = lines.find(l => l.includes(prefix));
          if (line) {
            const sig = extractSignature(line, entry.kind);
            if (sig) entry.signature = sig;
          }
        }
      } catch {
        // file unreadable — omit signatures gracefully
      }
    }
  }
  return { variant: "exports", entries };
}

export function deriveInterface(manifest: DetectedManifest | null, formId: string, repoRoot?: string, commandNames?: string[]): Pass1Result["interface"] {
  if (!manifest || manifest.kind !== "npm") return undefined;
  const parsed = asObj(manifest.parsed);
  // Match form's substring per the v0.3 form↔interface rules (cli > library)
  if (formId.includes("cli")) return npmSubcommands(parsed, commandNames);
  if (formId.includes("library")) return npmExports(parsed, repoRoot);
  return undefined;
}
