// src/pass1/manifest/dotnet.ts
// Detects .NET projects via top-level .sln, .csproj, .fsproj, or .vbproj.
// Parsed contains { slnPath?, projPaths, projContents, language } where
// language is csharp/fsharp/vbnet — picked from the dominant project-file
// extension. Project contents are loaded lazily (max 5, capped at 256KB
// each) for form-detection (UseWPF, OutputType) without requiring an XML
// parser.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { DetectedManifest } from "../../types.js";

const MAX_PROJ_BYTES = 256 * 1024;

export type DotnetLanguage = "csharp" | "fsharp" | "vbnet";

interface DotnetParsed {
  slnPath?: string;
  projPaths: string[];
  projContents: string[];
  language: DotnetLanguage;
}

function projExt(name: string): "csharp" | "fsharp" | "vbnet" | null {
  if (name.endsWith(".csproj")) return "csharp";
  if (name.endsWith(".fsproj")) return "fsharp";
  if (name.endsWith(".vbproj")) return "vbnet";
  return null;
}

/** Solution-file names .NET SDK 17.10+ writes / Visual Studio recognizes:
 *    .sln  — legacy text format
 *    .slnx — XML solution format (default in VS 17.10+ / .NET 9 era; both
 *            App-vNext/Polly and jbogard/MediatR use this in the v0.12.7
 *            stress test, and both fell out of detectDotnet pre-fix)
 *    .slnf — solution filter, scopes a parent .sln/.slnx view; common in
 *            very large .NET repos for partial loads */
function isSolutionFile(name: string): boolean {
  return name.endsWith(".sln") || name.endsWith(".slnx") || name.endsWith(".slnf");
}

function findProjRecursive(dir: string, depth: number, out: string[]): void {
  if (depth > 2 || out.length >= 5) return;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith(".") || e.name === "bin" || e.name === "obj" || e.name === "node_modules") continue;
    const abs = join(dir, e.name);
    if (e.isDirectory()) {
      findProjRecursive(abs, depth + 1, out);
    } else if (e.isFile() && projExt(e.name) !== null) {
      out.push(abs);
    }
  }
}

/** Pick the dominant language across discovered project files. csharp wins
 *  ties (most common in mixed solutions). */
function pickLanguage(projPaths: string[]): DotnetLanguage {
  const counts: Record<DotnetLanguage, number> = { csharp: 0, fsharp: 0, vbnet: 0 };
  for (const p of projPaths) {
    const lang = projExt(p);
    if (lang) counts[lang]++;
  }
  const max = Math.max(counts.csharp, counts.fsharp, counts.vbnet);
  if (max === 0) return "csharp"; // sln-only repo with no proj files (rare)
  if (counts.csharp === max) return "csharp";
  if (counts.fsharp === max) return "fsharp";
  return "vbnet";
}

export function detectDotnet(repoRoot: string): DetectedManifest | null {
  let entries;
  try { entries = readdirSync(repoRoot, { withFileTypes: true }); } catch { return null; }

  const slnFiles = entries.filter(e => e.isFile() && isSolutionFile(e.name));
  const rootProjFiles = entries.filter(e => e.isFile() && projExt(e.name) !== null);

  if (slnFiles.length === 0 && rootProjFiles.length === 0) return null;

  const projPaths: string[] = rootProjFiles.map(e => join(repoRoot, e.name));

  // Solution file present but no project files at root: walk up to depth 2.
  if (projPaths.length === 0) {
    findProjRecursive(repoRoot, 0, projPaths);
  }

  const projContents: string[] = [];
  for (const p of projPaths.slice(0, 5)) {
    try {
      const st = statSync(p);
      if (!st.isFile() || st.size > MAX_PROJ_BYTES) continue;
      projContents.push(readFileSync(p, "utf8"));
    } catch { continue; }
  }

  const parsed: DotnetParsed = {
    slnPath: slnFiles[0] ? join(repoRoot, slnFiles[0].name) : undefined,
    projPaths,
    projContents,
    language: pickLanguage(projPaths),
  };

  return {
    kind: "dotnet",
    path: parsed.slnPath ?? projPaths[0] ?? join(repoRoot, "(unknown).csproj"),
    parsed,
  };
}

/** Stack id for a DotnetParsed — csharp / fsharp / vbnet. */
export function dotnetStack(parsed: unknown): "csharp" | "fsharp" | "vbnet" {
  return (parsed as DotnetParsed | undefined)?.language ?? "csharp";
}

/** Inspect project file contents to decide form. Same heuristic for
 *  csproj/fsproj/vbproj since the relevant elements (<OutputType>,
 *  <UseWPF>, etc.) are MSBuild-level, not language-specific. Pure string
 *  match — no XML parser.
 *
 *  Desktop signals (WPF/WinForms/WinExe) are strong — any one project being
 *  desktop means the repo is desktop-shaped (other projects are typically
 *  adapter libs).
 *
 *  Exe vs Library is decided by COUNT across all loaded project files —
 *  multi-project solutions often ship a small build/tools/build.fsproj
 *  with OutputType=Exe alongside many src/*.fsproj libraries (FSharp.Data
 *  regression). The dominant explicit OutputType wins. */
export function dotnetFormSuffix(parsed: unknown): "desktop-app" | "cli-tool" | "library" {
  const p = parsed as DotnetParsed | undefined;
  if (!p?.projContents?.length) return "library";
  const all = p.projContents.join("\n");
  if (/<UseWPF>\s*true\s*<\/UseWPF>/i.test(all)) return "desktop-app";
  if (/<UseWindowsForms>\s*true\s*<\/UseWindowsForms>/i.test(all)) return "desktop-app";
  if (/<OutputType>\s*WinExe\s*<\/OutputType>/i.test(all)) return "desktop-app";
  const exeCount = (all.match(/<OutputType>\s*Exe\s*<\/OutputType>/gi) ?? []).length;
  const libCount = (all.match(/<OutputType>\s*Library\s*<\/OutputType>/gi) ?? []).length;
  if (exeCount > libCount) return "cli-tool";
  return "library";
}
