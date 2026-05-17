// src/render/toml.ts
// Pass1Result → TOML string. Hand-rolled assembly (smol-toml's stringify
// doesn't preserve comments). Output format is normative per spec §5.

import type { Pass1Result } from "../types.js";
import type { RenderArtifact } from "./types.js";

const LATEST_SCHEMA_URL = "https://anatomy.dev/spec/1.0/schema.json";
const LATEST_ANATOMY_VERSION = "1.0";

function schemaUrlFor(version: string): string {
  return `https://anatomy.dev/spec/${version}/schema.json`;
}

function escapeTomlString(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[\x00-\x1f]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

function tomlString(s: string): string {
  return `"${escapeTomlString(s)}"`;
}

/** Render a TOML inline table for small structured values like [[rules]].verify.
 *  Iterates the object's own enumerable keys in insertion order. Supports
 *  string, number, boolean values (sufficient for the v0.12 verify shape). */
function tomlInlineTable(obj: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    let rendered: string;
    if (typeof v === "string") rendered = tomlString(v);
    else if (typeof v === "number") rendered = String(v);
    else if (typeof v === "boolean") rendered = v ? "true" : "false";
    else continue; // skip unsupported nested objects/arrays — shouldn't occur in v0.12 verify
    parts.push(`${k} = ${rendered}`);
  }
  return `{ ${parts.join(", ")} }`;
}

export function renderToml(r: Pass1Result, opts?: { modelId?: string; anatomyVersion?: string }): string {
  const out: string[] = [];
  const version = opts?.anatomyVersion ?? LATEST_ANATOMY_VERSION;
  const schemaUrl = opts?.anatomyVersion ? schemaUrlFor(opts.anatomyVersion) : LATEST_SCHEMA_URL;

  // Top-level
  out.push(`anatomy_version = ${tomlString(version)}`);
  if (r.tagline.isPlaceholder) {
    out.push(`tagline = ${tomlString(r.tagline.value)}  # TODO: replace with real tagline`);
  } else {
    out.push(`tagline = ${tomlString(r.tagline.value)}`);
  }
  if (r.description !== undefined) {
    out.push(`description = ${tomlString(r.description)}`);
  }
  // v0.14 rich-mode top-level fields. Emitted only when the field is filled
  // (and the renderer is targeting v0.14+; v0.13 schemas reject these as
  // additionalProperties:false). Default mode leaves them undefined so this
  // block is a no-op for non-rich generation.
  // Lexicographic version compare. Works correctly for all "0.x" through "0.99"
  // versions; would break at "0.100"+ where "0.100" < "0.15" lexicographically.
  // Acceptable for the current versioning cadence; revisit if a v0.100 is ever needed.
  // Lexicographic compare. "1.0" >= "0.14" is true ('1' > '0'), so v1.0
  // (== v0.15 structurally) still emits rich-mode fields. Intentional and
  // relied upon — do not "fix" this into a numeric parse without updating
  // the v1.0 expectations.
  const richVersionOk = version >= "0.14";
  if (richVersionOk && r.author !== undefined) out.push(`author = ${tomlString(r.author)}`);
  if (richVersionOk && r.license !== undefined) out.push(`license = ${tomlString(r.license)}`);
  if (richVersionOk && r.docs_url !== undefined) out.push(`docs_url = ${tomlString(r.docs_url)}`);
  if (richVersionOk && r.repository_url !== undefined) out.push(`repository_url = ${tomlString(r.repository_url)}`);
  out.push("");

  // [identity] — flat strings
  out.push(`[identity]`);
  for (const pillar of ["stack", "form", "domain", "function"] as const) {
    const p = r.identity[pillar];
    const comment = p.isPlaceholder ? `  # TODO: replace with real ${pillar}` : "";
    out.push(`${pillar} = ${tomlString(p.id)}${comment}`);
  }
  out.push(`fingerprint = ${tomlString(r.identity.fingerprint)}`);
  out.push("");

  // [[operation.entry_points]]
  for (const ep of r.operation.entryPoints) {
    out.push("");
    out.push(`[[operation.entry_points]]`);
    out.push(`path = ${tomlString(ep.path)}`);
    out.push(`role = ${tomlString(ep.role)}`);
    if (ep.purpose !== undefined) {
      const comment = ep.isPlaceholder ? "  # TODO describe purpose" : "";
      out.push(`purpose = ${tomlString(ep.purpose)}${comment}`);
    }
  }

  // [operation.commands]
  if (Object.keys(r.operation.commands).length > 0) {
    out.push("");
    out.push(`[operation.commands]`);
    for (const [k, v] of Object.entries(r.operation.commands)) {
      const key = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(k) ? k : `"${k}"`;
      out.push(`${key} = ${tomlString(v)}`);
    }
  }

  // [[substance.key_dependencies]] — RE-ADDED in v0.14 (rich mode only).
  // Per v0.9 the cite rate was 1/27 in the cross-repo N=3 eval (key deps
  // derivable from manifest). v0.14 brings them back as an opt-in carrier
  // for the version-pinned dep info that --rich Pass 2 emits with whys
  // sourced from README context. Default mode keeps the v0.9 omission.
  if (richVersionOk && r.substance.keyDependencies.length > 0) {
    for (const dep of r.substance.keyDependencies) {
      // Filter out placeholders — they have no real why content. The
      // schema requires {name, why}; placeholders fail validation.
      if (dep.isPlaceholder) continue;
      out.push("");
      out.push(`[[substance.key_dependencies]]`);
      out.push(`name = ${tomlString(dep.name)}`);
      // version is an optional v0.14 field carried via any-cast (Pass1Result
      // type doesn't model it; applyAiFill attaches it to entries when --rich).
      const ver = (dep as unknown as { version?: string }).version;
      if (typeof ver === "string" && ver.length > 0) {
        out.push(`version = ${tomlString(ver)}`);
      }
      out.push(`why = ${tomlString(dep.why)}`);
    }
  }

  // [[structure.entries]]
  for (const ent of r.structure.entries) {
    out.push("");
    out.push(`[[structure.entries]]`);
    out.push(`path = ${tomlString(ent.path)}`);
    const purposeComment = ent.isPlaceholder ? "  # TODO: describe this directory's purpose" : "";
    out.push(`purpose = ${tomlString(ent.purpose)}${purposeComment}`);
    out.push(`kind = ${tomlString(ent.kind)}`);
    if (ent.convention !== undefined) {
      out.push(`convention = ${tomlString(ent.convention)}`);
    }
  }

  // [environment]
  if (r.environment) {
    out.push("");
    out.push(`[environment]`);
    if (r.environment.languageVersion !== undefined) out.push(`language_version = ${tomlString(r.environment.languageVersion)}`);
    if (r.environment.runtime !== undefined) out.push(`runtime = ${tomlString(r.environment.runtime)}`);
  }

  // [[interface.*]] — REMOVED in v0.9 (0/27 cite rate in cross-repo N=3
  // eval; exports/endpoints/subcommands are derivable from package.json
  // exports + bin + endpoint definitions in source).

  // [[rules]] — placeholder stubs when Pass 2 hasn't run; real entries after Pass 2.
  // v0.12: optional `verify` field (discriminated union with three kinds) is
  // emitted as an inline TOML table after `why`. Authors hand-write verify;
  // the renderer just preserves the field through the round-trip.
  if (r.rules && r.rules.length > 0) {
    for (const rule of r.rules) {
      out.push("");
      out.push(`[[rules]]`);
      const ruleComment = rule.isPlaceholder ? "  # TODO: add a real architectural rule" : "";
      out.push(`rule = ${tomlString(rule.rule)}${ruleComment}`);
      if (rule.why !== undefined && rule.why !== "") {
        out.push(`why = ${tomlString(rule.why)}`);
      }
      if (rule.verify !== undefined) {
        out.push(`verify = ${tomlInlineTable(rule.verify as unknown as Record<string, unknown>)}`);
      }
    }
  }

  // [[flows]]
  if (r.flows && r.flows.length > 0) {
    for (const flow of r.flows) {
      out.push("");
      out.push(`[[flows]]`);
      out.push(`name = ${tomlString(flow.name)}`);
      out.push(`summary = ${tomlString(flow.summary)}`);
    }
  }

  // [[decisions]]
  if (r.decisions && r.decisions.length > 0) {
    for (const dec of r.decisions) {
      out.push("");
      out.push(`[[decisions]]`);
      out.push(`topic = ${tomlString(dec.topic)}`);
      out.push(`reason = ${tomlString(dec.reason)}`);
    }
  }

  // v0.15+ uncapturable-knowledge sections.
  // Lexicographic compare. "1.0" >= "0.15" is true ('1' > '0'), so the
  // v0.15-era uncapturable-knowledge sections also emit for v1.0.
  const v015Ok = version >= "0.15";

  if (v015Ok && r.vocabulary && r.vocabulary.length > 0) {
    for (const v of r.vocabulary) {
      out.push("");
      out.push("[[vocabulary]]");
      out.push(`term = ${tomlString(v.term)}`);
      out.push(`meaning = ${tomlString(v.meaning)}`);
      if (v.aliases && v.aliases.length > 0) {
        out.push(`aliases = [${v.aliases.map(tomlString).join(", ")}]`);
      }
      if (v.contrast && v.contrast.length > 0) {
        out.push(`contrast = [${v.contrast.map(tomlString).join(", ")}]`);
      }
    }
  }

  if (v015Ok && r.invariants && r.invariants.length > 0) {
    for (const inv of r.invariants) {
      out.push("");
      out.push("[[invariants]]");
      out.push(`invariant = ${tomlString(inv.invariant)}`);
      if (inv.triggered_by && inv.triggered_by.length > 0) {
        out.push(`triggered_by = [${inv.triggered_by.map(tomlString).join(", ")}]`);
      }
      if (inv.affected_paths && inv.affected_paths.length > 0) {
        out.push(`affected_paths = [${inv.affected_paths.map(tomlString).join(", ")}]`);
      }
      if (inv.why !== undefined) {
        out.push(`why = ${tomlString(inv.why)}`);
      }
    }
  }

  if (v015Ok && r.anti_patterns && r.anti_patterns.length > 0) {
    for (const ap of r.anti_patterns) {
      out.push("");
      out.push("[[anti_patterns]]");
      out.push(`pattern = ${tomlString(ap.pattern)}`);
      out.push(`reason = ${tomlString(ap.reason)}`);
      if (ap.instead !== undefined) {
        out.push(`instead = ${tomlString(ap.instead)}`);
      }
      if (ap.keywords && ap.keywords.length > 0) {
        out.push(`keywords = [${ap.keywords.map(tomlString).join(", ")}]`);
      }
    }
  }

  if (v015Ok && r.prerequisites && r.prerequisites.length > 0) {
    for (const p of r.prerequisites) {
      out.push("");
      out.push("[[prerequisites]]");
      out.push(`topic = ${tomlString(p.topic)}`);
      out.push(`why = ${tomlString(p.why)}`);
      if (p.link !== undefined) {
        out.push(`link = ${tomlString(p.link)}`);
      }
    }
  }

  // [generate] — optional per-repo render preferences (v0.10+).
  // v0.10 fields: agents_md, agents_md_budget, agents_md_memory_count.
  // v0.11 fields: cursor_mdc, cursor_rules, aider_conventions, cline_rules,
  //               roo_rules, continue_rules, windsurf_rules, render_budget,
  //               render_memory_count.
  // The renderer emits fields in canonical order so round-tripping is stable.
  const generate = (r as unknown as { generate?: Record<string, unknown> }).generate;
  if (generate && Object.keys(generate).length > 0) {
    out.push("");
    out.push(`[generate]`);
    const BOOL_FIELDS = [
      "agents_md",
      "cursor_mdc", "cursor_rules", "aider_conventions",
      "cline_rules", "roo_rules", "continue_rules", "windsurf_rules",
    ] as const;
    const NUMBER_FIELDS = [
      "agents_md_budget", "agents_md_memory_count",
      "render_budget", "render_memory_count",
    ] as const;
    for (const key of BOOL_FIELDS) {
      if (typeof generate[key] === "boolean") {
        out.push(`${key} = ${generate[key]}`);
      }
    }
    for (const key of NUMBER_FIELDS) {
      if (typeof generate[key] === "number") {
        out.push(`${key} = ${generate[key]}`);
      }
    }
  }

  // [generated]
  out.push("");
  out.push(`[generated]`);
  out.push(`at = ${r.generatedAt}`);
  if (r.commit !== undefined) {
    out.push(`commit = ${tomlString(r.commit)}`);
  }
  out.push(`by = ${tomlString(r.generatorId)}`);
  out.push(`model = ${tomlString(opts?.modelId ?? "none")}`);
  out.push(`schema = ${tomlString(schemaUrl)}`);

  return out.join("\n") + "\n";
}

/** Wraps renderToml into a RenderArtifact for the unified render boundary. */
export function renderAnatomyArtifact(r: Pass1Result, opts?: { modelId?: string; anatomyVersion?: string }): RenderArtifact {
  return { path: ".anatomy", content: renderToml(r, opts) };
}
