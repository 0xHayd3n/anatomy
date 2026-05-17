// src/pass1/manifest/perl.ts
// Detects Perl projects via cpanfile (modern dep manifest) or Makefile.PL
// (classic CPAN/EUMM) or dist.ini (Dist::Zilla) or Build.PL (Module::Build).
// Stack: "perl". Form heuristic: Mojolicious / Dancer / Catalyst → service;
// EU::MM-detected name in Makefile.PL — bare library default.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { DetectedManifest } from "../../types.js";

const MAX_MANIFEST_BYTES = 256 * 1024;

interface PerlParsed {
  cpanfileContent: string;
  makefilePLContent: string;
  distIniContent: string;
}

function readCapped(path: string): string {
  if (!existsSync(path)) return "";
  try {
    const st = statSync(path);
    if (!st.isFile() || st.size > MAX_MANIFEST_BYTES) return "";
    return readFileSync(path, "utf8");
  } catch { return ""; }
}

export function detectPerl(repoRoot: string): DetectedManifest | null {
  const cpanfile = join(repoRoot, "cpanfile");
  const makefilePL = join(repoRoot, "Makefile.PL");
  const buildPL = join(repoRoot, "Build.PL");
  const distIni = join(repoRoot, "dist.ini");
  const hasAny = existsSync(cpanfile) || existsSync(makefilePL) || existsSync(buildPL) || existsSync(distIni);
  if (!hasAny) return null;
  return {
    kind: "perl",
    path: existsSync(cpanfile) ? cpanfile :
          existsSync(makefilePL) ? makefilePL :
          existsSync(buildPL) ? buildPL : distIni,
    parsed: {
      cpanfileContent: readCapped(cpanfile),
      makefilePLContent: readCapped(makefilePL),
      distIniContent: readCapped(distIni),
    } satisfies PerlParsed,
  };
}

export function perlFormSuffix(parsed: unknown): "service" | "library" {
  const p = parsed as PerlParsed | undefined;
  const all = `${p?.cpanfileContent ?? ""}\n${p?.makefilePLContent ?? ""}\n${p?.distIniContent ?? ""}`;
  if (/\b(?:Mojolicious|Dancer2?|Catalyst|Plack|Mojo::Lite)\b/.test(all)) return "service";
  return "library";
}
