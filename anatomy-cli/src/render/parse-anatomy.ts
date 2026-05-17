// src/render/parse-anatomy.ts
// Adapt a parsed-from-TOML .anatomy document (the AnatomyDoc shape, with
// snake_case keys and plain string pillars) into Pass1Result — the in-memory
// shape the renderers consume.
//
// After parse + validate, every field is real, so isPlaceholder is uniformly
// false. This adapter is used by `anatomy render` and by snapshot fixture
// tests that drive the renderer from a hand-written .anatomy.

import type { Pass1Result, StructureKind } from "../types.js";

interface ParsedAnatomyShape {
  anatomy_version?: string;
  tagline?: string;
  description?: string;
  identity?: { stack?: string; form?: string; domain?: string; function?: string; fingerprint?: string };
  generated?: { at?: Date | string; commit?: string; by?: string; model?: string; schema?: string };
  generate?: { agents_md?: boolean; agents_md_budget?: number; agents_md_memory_count?: number };
  operation?: {
    entry_points?: Array<{ path: string; role: string; purpose?: string }>;
    commands?: Record<string, string>;
  };
  structure?: { entries?: Array<{ path: string; purpose: string; kind: string; convention?: string }> };
  environment?: { language_version?: string; runtime?: string };
  rules?: Array<{ rule: string; why?: string; verify?: unknown }>;
  flows?: Array<{ name: string; summary: string }>;
  decisions?: Array<{ topic: string; reason: string }>;
  vocabulary?: Array<{ term: string; meaning: string; aliases?: string[]; contrast?: string[] }>;
  invariants?: Array<{ invariant: string; triggered_by?: string[]; affected_paths?: string[]; why?: string }>;
  anti_patterns?: Array<{ pattern: string; reason: string; instead?: string; keywords?: string[] }>;
  prerequisites?: Array<{ topic: string; why: string; link?: string }>;
}

export function parsedToPass1Result(raw: unknown): Pass1Result {
  const p = raw as ParsedAnatomyShape;
  const id = p.identity ?? {};
  const gen = p.generated ?? {};
  return {
    manifest: null,
    identity: {
      stack: { id: id.stack ?? "", isPlaceholder: false },
      form: { id: id.form ?? "", isPlaceholder: false },
      domain: { id: id.domain ?? "", isPlaceholder: false },
      function: { id: id.function ?? "", isPlaceholder: false },
      fingerprint: id.fingerprint ?? "",
    },
    tagline: { value: p.tagline ?? "", isPlaceholder: false, source: "manifest-description" },
    description: p.description,
    operation: {
      entryPoints: (p.operation?.entry_points ?? []).map((ep) => ({
        path: ep.path,
        role: ep.role,
        purpose: ep.purpose,
        isPlaceholder: false,
      })),
      commands: p.operation?.commands ?? {},
    },
    substance: { keyDependencies: [] },
    structure: {
      entries: (p.structure?.entries ?? []).map((e) => ({
        path: e.path,
        purpose: e.purpose,
        kind: e.kind as StructureKind,
        isPlaceholder: false,
        convention: e.convention,
      })),
    },
    environment: p.environment
      ? { languageVersion: p.environment.language_version, runtime: p.environment.runtime }
      : undefined,
    generatedAt: gen.at instanceof Date ? gen.at.toISOString() : String(gen.at ?? ""),
    generatorId: gen.by ?? "",
    commit: gen.commit,
    rules: (p.rules ?? []).map((r) => ({
      rule: r.rule,
      why: r.why ?? "",
      isPlaceholder: false,
      // v0.12: preserve verify field as-is through the parse/render round-trip.
      // Schema validation enforces shape; render emits whatever the .anatomy held.
      ...(r.verify !== undefined ? { verify: r.verify as import("../types.js").VerifyConfig } : {}),
    })),
    flows: p.flows ?? [],
    decisions: p.decisions ?? [],
    // v0.15 uncapturable-knowledge sections. Mapped faithfully (optionals
    // carried only when present) so `anatomy render` round-trips an existing
    // v0.15 file byte-for-byte instead of silently truncating these.
    // NOTE: these are conditional-spread (absent => key omitted), unlike
    // flows/decisions above which default to []. The asymmetry is load-
    // bearing: Pass1Result types these as optional and the renderer skips
    // an absent section but emits an empty one; defaulting to [] here would
    // reintroduce false `--check` drift. Do not "normalize" to ?? [].
    ...(p.vocabulary
      ? {
          vocabulary: p.vocabulary.map((v) => ({
            term: v.term,
            meaning: v.meaning,
            ...(v.aliases !== undefined ? { aliases: v.aliases } : {}),
            ...(v.contrast !== undefined ? { contrast: v.contrast } : {}),
          })),
        }
      : {}),
    ...(p.invariants
      ? {
          invariants: p.invariants.map((inv) => ({
            invariant: inv.invariant,
            ...(inv.triggered_by !== undefined ? { triggered_by: inv.triggered_by } : {}),
            ...(inv.affected_paths !== undefined ? { affected_paths: inv.affected_paths } : {}),
            ...(inv.why !== undefined ? { why: inv.why } : {}),
          })),
        }
      : {}),
    ...(p.anti_patterns
      ? {
          anti_patterns: p.anti_patterns.map((ap) => ({
            pattern: ap.pattern,
            reason: ap.reason,
            ...(ap.instead !== undefined ? { instead: ap.instead } : {}),
            ...(ap.keywords !== undefined ? { keywords: ap.keywords } : {}),
          })),
        }
      : {}),
    ...(p.prerequisites
      ? {
          prerequisites: p.prerequisites.map((pr) => ({
            topic: pr.topic,
            why: pr.why,
            ...(pr.link !== undefined ? { link: pr.link } : {}),
          })),
        }
      : {}),
    // [generate] passthrough — Pass1Result type doesn't declare it (it's an
    // out-of-band field used only by the AGENTS.md renderer and renderAll
    // for the agents_md emit toggle). The renderer reads via casting.
    ...(p.generate ? { generate: p.generate } : {}),
  } as Pass1Result;
}
