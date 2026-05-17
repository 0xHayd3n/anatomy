// src/pass1/manifest/erlang.ts
// Detects Erlang projects via rebar.config (modern) or *.app.src (legacy
// OTP). Stack: "erlang". Form heuristic: cowboy/elli/yaws web server dep
// → service; default library. (CLI Erlang tools are rare; rebar3 itself
// is detected via its rebar.config + ships escripts.)

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { DetectedManifest } from "../../types.js";

const MAX_MANIFEST_BYTES = 256 * 1024;

interface ErlangParsed {
  rebarConfigContent: string;
  hasAppSrc: boolean;
}

function findAppSrc(repoRoot: string): boolean {
  // *.app.src usually lives under src/ but historically also at root.
  for (const dir of [repoRoot, join(repoRoot, "src")]) {
    try {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isFile() && e.name.endsWith(".app.src")) return true;
      }
    } catch {}
  }
  return false;
}

// Count loose .erl files at root or in src/. Same pattern as the Python
// detector's loose-py fallback. Catches hand-rolled Erlang projects and
// erlang/otp-style traditional builds (which don't use rebar3).
const LOOSE_ERL_THRESHOLD = 2;

function looseErlFileCount(repoRoot: string): number {
  let total = 0;
  for (const dir of [repoRoot, join(repoRoot, "src")]) {
    try {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isFile() && e.name.endsWith(".erl") && !e.name.startsWith(".")) total++;
      }
    } catch {}
  }
  return total;
}

export function detectErlang(repoRoot: string): DetectedManifest | null {
  const rebarPath = join(repoRoot, "rebar.config");
  const hasRebar = existsSync(rebarPath);
  const hasAppSrc = findAppSrc(repoRoot);
  // 14th-sweep additions: otp_build script (erlang/otp's traditional
  // build driver) and ≥2 loose .erl files (mirrors the Python loose-py
  // fallback). Either signals a real Erlang project even without rebar3.
  // isFile() check guards against a directory accidentally named otp_build.
  const otpBuildPath = join(repoRoot, "otp_build");
  const hasOtpBuild = existsSync(otpBuildPath) && (() => {
    try { return statSync(otpBuildPath).isFile(); } catch { return false; }
  })();
  const hasLooseErl = looseErlFileCount(repoRoot) >= LOOSE_ERL_THRESHOLD;
  if (!hasRebar && !hasAppSrc && !hasOtpBuild && !hasLooseErl) return null;

  let rebarConfigContent = "";
  if (hasRebar) {
    try {
      const st = statSync(rebarPath);
      if (st.isFile() && st.size <= MAX_MANIFEST_BYTES) {
        rebarConfigContent = readFileSync(rebarPath, "utf8");
      }
    } catch {}
  }
  // path priority: rebar.config (richest) > otp_build (specific) > repo root.
  const path = hasRebar ? rebarPath : (hasOtpBuild ? otpBuildPath : repoRoot);
  return {
    kind: "erlang",
    path,
    parsed: { rebarConfigContent, hasAppSrc } satisfies ErlangParsed,
  };
}

export function erlangFormSuffix(parsed: unknown): "service" | "cli-tool" | "library" {
  const p = parsed as ErlangParsed | undefined;
  const c = p?.rebarConfigContent ?? "";
  // Erlang web servers.
  if (/\b(?:cowboy|elli|yaws|nitrogen|n2o)\b/.test(c)) return "service";
  // rebar3 escript projects declare {escript_name, ...} in rebar.config.
  if (/\{escript_name\s*,/.test(c)) return "cli-tool";
  return "library";
}
