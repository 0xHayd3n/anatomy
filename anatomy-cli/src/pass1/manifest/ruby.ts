// src/pass1/manifest/ruby.ts
// Detects Ruby projects via Gemfile or *.gemspec. A Gemfile alone signals an
// app-shaped project (Bundler resolves deps for the local app); a *.gemspec
// signals a publishable library. Stack: "ruby". Form heuristic: web-framework
// gem present → service; gemspec without service framework → library; else
// library by default.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { DetectedManifest } from "../../types.js";

const MAX_MANIFEST_BYTES = 256 * 1024;

interface RubyParsed {
  hasGemfile: boolean;
  hasGemspec: boolean;
  gemfileContent?: string;
  gemspecContent?: string;
}

function readCapped(path: string): string | null {
  try {
    const st = statSync(path);
    if (!st.isFile() || st.size > MAX_MANIFEST_BYTES) return null;
    return readFileSync(path, "utf8");
  } catch { return null; }
}

function findGemspec(repoRoot: string): string | null {
  try {
    for (const e of readdirSync(repoRoot, { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith(".gemspec")) return join(repoRoot, e.name);
    }
  } catch {}
  return null;
}

// Gems that a non-Ruby project commonly installs as build/CI tooling rather
// than as part of its own dependency surface. Swift projects use fastlane +
// cocoapods + jazzy; static-site projects use asciidoctor; lots of repos
// install rake+rubocop+pry as dev helpers without being Ruby projects. When a
// Gemfile contains ONLY gems from this set, the manifest is treated as
// non-primary (isPrimary=false) so a sibling primary manifest like
// Package.swift wins. Catches the v0.12 50-repo Alamofire false-positive.
//
// Conservative on purpose: any gem outside this set keeps the Gemfile primary.
// A single `gem "rails"` makes it a Ruby app even if every other gem is rake.
const RUBY_TOOLING_ONLY_GEMS = new Set([
  // iOS/macOS build tooling
  "fastlane", "cocoapods", "cocoapods-core", "cocoapods-deintegrate",
  "cocoapods-plugins", "cocoapods-search", "cocoapods-trunk", "cocoapods-try",
  "danger", "xcpretty", "xcodeproj", "jazzy", "slather",
  // Static-site doc tooling
  "asciidoctor", "asciidoctor-pdf", "kramdown",
  // Generic Ruby dev/test tooling that any project may install for scripts
  "pry", "pry-byebug", "rake", "rubocop", "rubocop-rake", "rubocop-rspec",
  "bundler", "bundler-audit",
]);

const GEMFILE_GEM_LINE_RE = /^\s*gem\s+['"]([a-zA-Z0-9_-]+)['"]/;

function isToolingOnlyGemfile(content: string | undefined): boolean {
  if (!content) return false;
  const gems: string[] = [];
  for (const rawLine of content.split("\n")) {
    // Strip line-end comments so `gem "rake" # tooling` still parses.
    const line = rawLine.replace(/#.*$/, "");
    const m = GEMFILE_GEM_LINE_RE.exec(line);
    if (m) gems.push(m[1].toLowerCase());
  }
  if (gems.length === 0) return false;
  return gems.every(g => RUBY_TOOLING_ONLY_GEMS.has(g));
}

export function detectRuby(repoRoot: string): DetectedManifest | null {
  const gemfile = join(repoRoot, "Gemfile");
  const gemspecPath = findGemspec(repoRoot);
  const hasGemfile = existsSync(gemfile);
  const hasGemspec = gemspecPath !== null;
  if (!hasGemfile && !hasGemspec) return null;

  const parsed: RubyParsed = {
    hasGemfile,
    hasGemspec,
    gemfileContent: hasGemfile ? readCapped(gemfile) ?? undefined : undefined,
    gemspecContent: gemspecPath ? readCapped(gemspecPath) ?? undefined : undefined,
  };
  const result: DetectedManifest = {
    kind: "ruby",
    path: hasGemfile ? gemfile : gemspecPath!,
    parsed,
  };
  // Gemfile-only repo where every declared gem is build/CI tooling — demote
  // to non-primary so polyglot fallback in manifest/index.ts picks the real
  // primary manifest. A gemspec is always primary (publishable Ruby gem).
  if (hasGemfile && !hasGemspec && isToolingOnlyGemfile(parsed.gemfileContent)) {
    result.isPrimary = false;
  }
  return result;
}

const RUBY_SERVICE_FRAMEWORKS = ["rails", "sinatra", "hanami", "grape", "roda", "cuba", "padrino", "rack"];

export function rubyFormSuffix(parsed: unknown): "service" | "library" {
  const p = parsed as RubyParsed | undefined;
  const all = `${p?.gemfileContent ?? ""}\n${p?.gemspecContent ?? ""}`;

  // Self-name disqualifier: gemspec has `s.name = "NAME"` (or `spec.name`,
  // `gem.name`) OR `Gem::Specification.new "NAME"` (positional, like
  // sinatra.gemspec). If NAME is one of the listed frameworks, the gem IS
  // the framework, not a service that uses it. Same false-positive class
  // as compojure → library.
  const gemspec = p?.gemspecContent ?? "";
  const assignMatch = /\b(?:s|spec|gem)\.name\s*=\s*['"]([a-zA-Z0-9_-]+)['"]/.exec(gemspec);
  const positionalMatch = /Gem::Specification\.new\s+['"]([a-zA-Z0-9_-]+)['"]/.exec(gemspec);
  const selfName = (assignMatch?.[1] ?? positionalMatch?.[1] ?? "").toLowerCase();
  if (RUBY_SERVICE_FRAMEWORKS.includes(selfName)) return "library";

  if (new RegExp(`gem\\s+['"](?:${RUBY_SERVICE_FRAMEWORKS.join("|")})['"]`, "i").test(all)) return "service";
  return "library";
}
