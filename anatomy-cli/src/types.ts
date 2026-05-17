// src/types.ts
// The structured contract between Pass 1 and the renderer.
// Every field that can't be derived deterministically carries an isPlaceholder
// flag so the renderer knows where to emit # TODO comments.

export type StructureKind =
  | "source" | "tests" | "docs" | "config" | "build"
  | "scripts" | "examples" | "generated" | "other";

export type ExportKind = "function" | "class" | "type" | "constant" | "namespace" | "trait";

/** v0.12 [[rules]].verify — optional discriminated-union verify clause.
 *  Carried as-is through the render round-trip; the actual verifier dispatch
 *  lives in @anatomytool/validate. */
export type VerifyConfig =
  | { kind: "glob_exists"; path: string; should_not?: boolean }
  | { kind: "glob_only"; match: string; container: string }
  | {
      kind: "ast_pattern";
      lang: "ts" | "tsx" | "js" | "jsx" | "py" | "rs" | "go" | "java";
      pattern: string;
      expect_in?: string;
      forbid_in?: string;
    };

export interface Rule {
  rule: string;
  why?: string;
  verify?: VerifyConfig;
  isPlaceholder?: boolean;
}

export interface Flow {
  name: string;
  summary: string;
}

export interface Decision {
  topic: string;
  reason: string;
}

export type ManifestKind =
  | "npm" | "cargo" | "pyproject" | "go" | "dotnet"
  | "java" | "ruby" | "php" | "swift" | "elixir" | "zig"
  | "dart" | "haskell" | "ocaml" | "clojure" | "crystal" | "nim"
  | "r" | "julia" | "erlang" | "lua" | "scala" | "perl"
  | "deno"
  | "solidity" | "gleam"
  | "cpp" | "v" | "terraform"
  | "helm" | "godot" | "github-action";

export interface DetectedManifest {
  kind: ManifestKind;
  path: string;
  parsed: unknown;
  /** False when the manifest is a tooling sidecar (linter config, build
   *  helper) without a real publishable-product declaration. Defaults to
   *  true (treat as primary) — only the dual-usage formats (npm,
   *  pyproject, cargo, mix.exs) explicitly set this to false on stub
   *  shapes. detectManifest filters out non-primary manifests when a
   *  competing primary is present, eliminating the whole class of
   *  "tooling stub wins because it's first in detect order"
   *  misclassifications surfaced by the 7-sweep stress test series
   *  (mdBook with eslint-only package.json, nodejs/node with ruff-only
   *  pyproject.toml, etc.). */
  isPrimary?: boolean;
}

export interface IdentityFields {
  stack:    { id: string; isPlaceholder: boolean };
  form:     { id: string; isPlaceholder: boolean };
  domain:   { id: string; isPlaceholder: boolean };
  function: { id: string; isPlaceholder: boolean };
  fingerprint: string;
}

export interface Pass1Result {
  manifest: DetectedManifest | null;
  identity: IdentityFields;
  tagline: { value: string; isPlaceholder: boolean; source: "readme" | "manifest-description" | "placeholder" };
  description?: string;
  operation: {
    entryPoints: Array<{ path: string; role: string; purpose?: string; isPlaceholder?: boolean }>;
    commands: Record<string, string>;
  };
  substance: {
    keyDependencies: Array<{ name: string; why: string; isPlaceholder: boolean }>;
  };
  structure: {
    entries: Array<{ path: string; purpose: string; kind: StructureKind; isPlaceholder: boolean; convention?: string }>;
  };
  environment?: {
    languageVersion?: string;
    runtime?: string;
  };
  interface?:
    | { variant: "subcommands"; entries: Array<{ name: string; summary: string; isPlaceholder: boolean }> }
    | { variant: "exports"; entries: Array<{ symbol: string; kind: ExportKind; summary: string; isPlaceholder: boolean; signature?: string }> };
  generatedAt: string;
  generatorId: string;
  commit?: string;
  rules?: Rule[];
  flows?: Flow[];
  decisions?: Decision[];
  /** v0.14 rich-mode fields. All optional; populated by Pass 2 when --rich. */
  author?: string;
  license?: string;
  docs_url?: string;
  repository_url?: string;
  /** v0.15 uncapturable-knowledge sections. All optional; populated by Pass 2. */
  vocabulary?: Array<{ term: string; meaning: string; aliases?: string[]; contrast?: string[] }>;
  invariants?: Array<{ invariant: string; triggered_by?: string[]; affected_paths?: string[]; why?: string }>;
  anti_patterns?: Array<{ pattern: string; reason: string; instead?: string; keywords?: string[] }>;
  prerequisites?: Array<{ topic: string; why: string; link?: string }>;
}
