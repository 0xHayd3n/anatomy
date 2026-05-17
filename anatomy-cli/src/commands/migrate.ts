// src/commands/migrate.ts
// `anatomy migrate --to <version>` — mechanical format migration.
// Currently supports v0.1 → v0.2 per spec §12.2.

import { existsSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { validate } from "@anatomy/validate";
import { readAnatomyFile } from "../io.js";
import { debug } from "../log.js";
import { PKG_VERSION } from "../version.js";
import { fingerprintFromPillars } from "../canonical.js";
const SCHEMA_URLS: Record<string, string> = {
  "0.2": "https://anatomy.dev/spec/0.2/schema.json",
  "0.4": "https://anatomy.dev/spec/0.4/schema.json",
  "0.5": "https://anatomy.dev/spec/0.5/schema.json",
  "0.6": "https://anatomy.dev/spec/0.6/schema.json",
  "0.7": "https://anatomy.dev/spec/0.7/schema.json",
  "0.8": "https://anatomy.dev/spec/0.8/schema.json",
  "0.9": "https://anatomy.dev/spec/0.9/schema.json",
  "0.10": "https://anatomy.dev/spec/0.10/schema.json",
  "0.11": "https://anatomy.dev/spec/0.11/schema.json",
  "0.12": "https://anatomy.dev/spec/0.12/schema.json",
  "0.13": "https://anatomy.dev/spec/0.13/schema.json",
  "0.14": "https://anatomy.dev/spec/0.14/schema.json",
  "0.15": "https://anatomy.dev/spec/0.15/schema.json",
  "1.0": "https://anatomy.dev/spec/1.0/schema.json",
};

/**
 * Derives a tagline from a v0.1 description field.
 * Takes the first sentence (delimited by ". " or terminal ".") of the first
 * line, then truncates to 120 chars on a word boundary.
 * Only "." is treated as a sentence boundary — "?" and "!" are not.
 */
export function deriveTaglineFromDescription(description: string): string {
  const firstLine = description.split("\n")[0] ?? description;
  const dotSpace = firstLine.indexOf(". ");
  const terminalDot = firstLine.endsWith(".") ? firstLine.length - 1 : -1;
  let candidate = firstLine;
  if (dotSpace !== -1) {
    candidate = firstLine.slice(0, dotSpace + 1);
  } else if (terminalDot !== -1) {
    candidate = firstLine.slice(0, terminalDot + 1);
  }
  if (candidate.length <= 120) return candidate.trim();
  const truncated = candidate.slice(0, 120);
  const lastSpace = truncated.lastIndexOf(" ");
  return (lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated).trim();
}

function migrateV1toV2(doc: Record<string, unknown>): void {
  doc.anatomy_version = "0.2";

  const description = doc.description;
  if (typeof description !== "string" || description.trim() === "") {
    throw new Error("v0.1 file has no description field; cannot derive tagline");
  }
  doc.tagline = deriveTaglineFromDescription(description);

  const op = doc.operation as { entry_points?: Array<Record<string, unknown>> } | undefined;
  if (op && Array.isArray(op.entry_points)) {
    for (const ep of op.entry_points) {
      if (Object.prototype.hasOwnProperty.call(ep, "description") &&
          !Object.prototype.hasOwnProperty.call(ep, "purpose")) {
        ep.purpose = ep.description;
        delete ep.description;
      }
    }
  }

  const existingModel = (doc.generated as Record<string, unknown> | undefined)?.model;
  doc.generated = {
    by: `anatomy-cli@${PKG_VERSION}`,
    at: new Date(),
    schema: SCHEMA_URLS["0.2"],
    ...(existingModel !== undefined ? { model: existingModel } : {}),
  };
}

function migrateV2toV4(doc: Record<string, unknown>): void {
  // v0.4 is strictly additive over v0.2 — it added only the optional
  // [code_profile] section. No field renames, no removals. So a v0.2
  // document is byte-equivalent to a v0.4 document modulo the version
  // declaration and the schema URL in [generated].
  doc.anatomy_version = "0.4";
  const gen = doc.generated as Record<string, unknown> | undefined;
  if (gen) {
    gen.schema = SCHEMA_URLS["0.4"];
    gen.by = `anatomy-cli@${PKG_VERSION}`;
  }
}

function migrateV4toV5(doc: Record<string, unknown>): void {
  doc.anatomy_version = "0.5";
  const gen = doc.generated as Record<string, unknown> | undefined;
  if (gen) {
    gen.schema = SCHEMA_URLS["0.5"];
    gen.by = `anatomy-cli@${PKG_VERSION}`;
  }
}

function migrateV5toV6(doc: Record<string, unknown>): void {
  doc.anatomy_version = "0.6";
  const gen = doc.generated as Record<string, unknown> | undefined;
  if (gen) {
    gen.schema = SCHEMA_URLS["0.6"];
    gen.by = `anatomy-cli@${PKG_VERSION}`;
  }
}

function migrateV6toV7(doc: Record<string, unknown>): void {
  doc.anatomy_version = "0.7";

  // Flatten nested identity pillars to plain strings
  const id = doc.identity as Record<string, unknown> | undefined;
  if (id) {
    const flatId: Record<string, unknown> = {};
    for (const pillar of ["stack", "form", "domain", "function"] as const) {
      const p = id[pillar] as Record<string, unknown> | undefined;
      flatId[pillar] = typeof p?.id === "string" ? p.id : "todo";
    }
    // Recompute fingerprint with new formula
    flatId.fingerprint = fingerprintFromPillars(
      String(flatId.stack),
      String(flatId.form),
      String(flatId.domain),
      String(flatId.function),
    );
    doc.identity = flatId;
  }

  // Drop insights and architecture sections
  delete doc.insights;
  delete doc.architecture;

  // Update generated metadata
  const gen = doc.generated as Record<string, unknown> | undefined;
  if (gen) {
    gen.schema = SCHEMA_URLS["0.7"];
    gen.by = `anatomy-cli@${PKG_VERSION}`;
  }
}

interface MigrationWarning {
  message: string;
}

function migrateV7toV8(doc: Record<string, unknown>): MigrationWarning[] {
  doc.anatomy_version = "0.8";
  const warnings: MigrationWarning[] = [];

  // Drop code_profile silently — was dead surface, Pass 1 generator removed in ec73e00.
  delete doc.code_profile;

  // Drop substance.capabilities/limitations, warn if non-empty (user content present).
  const substance = doc.substance as Record<string, unknown> | undefined;
  if (substance) {
    const caps = substance.capabilities;
    if (Array.isArray(caps) && caps.length > 0) {
      const phrases = caps
        .map(c => (c as { phrase?: unknown }).phrase)
        .filter((p): p is string => typeof p === "string")
        .join("; ");
      warnings.push({
        message: `Dropped substance.capabilities (${caps.length} entries: ${phrases}). Consider re-expressing as [[decisions]] entries if any represent uncapturable design choices.`,
      });
    }
    delete substance.capabilities;

    const lims = substance.limitations;
    if (Array.isArray(lims) && lims.length > 0) {
      const phrases = lims
        .map(l => (l as { phrase?: unknown }).phrase)
        .filter((p): p is string => typeof p === "string")
        .join("; ");
      warnings.push({
        message: `Dropped substance.limitations (${lims.length} entries: ${phrases}). Consider re-expressing as [[decisions]] entries if any represent uncapturable design choices.`,
      });
    }
    delete substance.limitations;

    // If [substance] is now empty, drop the section entirely.
    if (Object.keys(substance).length === 0) {
      delete doc.substance;
    }
  }

  // Update generated metadata. Identity (pillars + fingerprint) is unchanged,
  // so paired .anatomy-memory keeps its repo_fingerprint pairing.
  const gen = doc.generated as Record<string, unknown> | undefined;
  if (gen) {
    gen.schema = SCHEMA_URLS["0.8"];
    gen.by = `anatomy-cli@${PKG_VERSION}`;
  }

  return warnings;
}

function migrateV8toV9(doc: Record<string, unknown>): MigrationWarning[] {
  doc.anatomy_version = "0.9";
  const warnings: MigrationWarning[] = [];

  // Drop [interface] entirely. Warn if any variant was populated.
  const iface = doc.interface as Record<string, unknown> | undefined;
  if (iface) {
    const populated: string[] = [];
    for (const variant of ["exports", "endpoints", "subcommands"] as const) {
      const arr = iface[variant];
      if (Array.isArray(arr) && arr.length > 0) populated.push(`${variant}(${arr.length})`);
    }
    if (populated.length > 0) {
      warnings.push({
        message: `Dropped [interface] section (${populated.join(", ")}). Interface details are derivable from package.json#exports + bin + endpoint definitions in source on every read; reconstruct from there if needed.`,
      });
    }
    delete doc.interface;
  }

  // Drop [domain_model] entirely. Warn if entities were populated.
  const dm = doc.domain_model as Record<string, unknown> | undefined;
  if (dm) {
    const ents = dm.entities;
    if (Array.isArray(ents) && ents.length > 0) {
      const names = ents
        .map(e => (e as { name?: unknown }).name)
        .filter((n): n is string => typeof n === "string")
        .join(", ");
      warnings.push({
        message: `Dropped [domain_model] section (${ents.length} entities: ${names}). Entity names are derivable from README + type definitions; consider promoting genuinely uncapturable rationale to [[decisions]].`,
      });
    }
    delete doc.domain_model;
  }

  // Drop [substance] entirely (key_dependencies and any leftover fields).
  const substance = doc.substance as Record<string, unknown> | undefined;
  if (substance) {
    const deps = substance.key_dependencies;
    if (Array.isArray(deps) && deps.length > 0) {
      const names = deps
        .map(d => (d as { name?: unknown }).name)
        .filter((n): n is string => typeof n === "string")
        .join(", ");
      warnings.push({
        message: `Dropped [substance.key_dependencies] (${deps.length} entries: ${names}). Direct deps are derivable from the manifest top-level on every read.`,
      });
    }
    delete doc.substance;
  }

  // Update generated metadata. Identity unchanged → memory pairing preserved.
  const gen = doc.generated as Record<string, unknown> | undefined;
  if (gen) {
    gen.schema = SCHEMA_URLS["0.9"];
    gen.by = `anatomy-cli@${PKG_VERSION}`;
  }

  return warnings;
}

function migrateV9toV10(doc: Record<string, unknown>): void {
  // v0.10 is strictly additive: adds optional [generate] section. Existing
  // v0.9 fields are unchanged. Migration is a version + schema URL bump only;
  // the optional [generate] section is intentionally NOT added (defaults
  // apply if absent — agents_md=true, agents_md_budget=1500,
  // agents_md_memory_count=10). Identity and fingerprint unchanged, so
  // paired .anatomy-memory keeps its repo_fingerprint pairing.
  doc.anatomy_version = "0.10";
  const gen = doc.generated as Record<string, unknown> | undefined;
  if (gen) {
    gen.schema = SCHEMA_URLS["0.10"];
    gen.by = `anatomy-cli@${PKG_VERSION}`;
  }
}

function migrateV10toV11(doc: Record<string, unknown>): void {
  // v0.11 is strictly additive: adds optional per-tool emit flags in [generate]
  // (Cursor, Aider, Cline, Roo, Continue, Windsurf) plus shared render_budget
  // and render_memory_count fields. Existing v0.10 fields are unchanged.
  // Migration is a version + schema URL bump only; the optional per-tool flags
  // and budget/memory fields are intentionally NOT added (defaults apply if
  // absent). Identity and fingerprint unchanged, so paired .anatomy-memory
  // keeps its repo_fingerprint pairing.
  doc.anatomy_version = "0.11";
  const gen = doc.generated as Record<string, unknown> | undefined;
  if (gen) {
    gen.schema = SCHEMA_URLS["0.11"];
    gen.by = `anatomy-cli@${PKG_VERSION}`;
  }
}

function migrateV11toV12(doc: Record<string, unknown>): void {
  // v0.12 is strictly additive: adds an optional [[rules]].verify field to each
  // rule entry. Existing v0.11 fields are unchanged. Migration is a version +
  // schema URL bump only; the optional verify field is intentionally NOT added
  // (authors write verify clauses by hand). Identity and fingerprint unchanged,
  // so paired .anatomy-memory keeps its repo_fingerprint pairing.
  doc.anatomy_version = "0.12";
  const gen = doc.generated as Record<string, unknown> | undefined;
  if (gen && typeof gen === "object") {
    gen.schema = SCHEMA_URLS["0.12"];
    gen.by = `anatomy-cli@${PKG_VERSION}`;
  }
}

function migrateV12toV13(doc: Record<string, unknown>): void {
  // v0.13 is strictly additive: adds a 4th verify.kind = "semgrep" variant
  // (inline pattern + lang, or rule_file pointing at Semgrep YAML). Existing
  // v0.12 fields are unchanged. Migration is a version + schema URL bump only;
  // the optional semgrep verify clause is intentionally NOT added (authors
  // write verify clauses by hand). Identity and fingerprint unchanged.
  doc.anatomy_version = "0.13";
  const gen = doc.generated as Record<string, unknown> | undefined;
  if (gen && typeof gen === "object") {
    gen.schema = SCHEMA_URLS["0.13"];
    gen.by = `anatomy-cli@${PKG_VERSION}`;
  }
}

function migrateV13toV14(doc: Record<string, unknown>): void {
  // v0.14 is strictly additive: adds 4 optional top-level string fields
  // (author, license, docs_url, repository_url) and re-introduces optional
  // [substance] section with key_dependencies items that may carry an
  // optional 'version' field. Existing v0.13 fields are unchanged.
  // Migration is a version + schema URL bump only; the new fields are NOT
  // auto-populated (they require Pass 2 with --rich, or hand authoring).
  // Identity and fingerprint unchanged.
  doc.anatomy_version = "0.14";
  const gen = doc.generated as Record<string, unknown> | undefined;
  if (gen && typeof gen === "object") {
    gen.schema = SCHEMA_URLS["0.14"];
    gen.by = `anatomy-cli@${PKG_VERSION}`;
  }
}

function migrateV14toV15(doc: Record<string, unknown>): void {
  // v0.15 is strictly additive over v0.14: adds optional [[vocabulary]],
  // [[invariants]], [[anti_patterns]], [[prerequisites]] top-level sections.
  // Existing v0.14 fields are unchanged. Version + schema URL bump only; the
  // new optional sections are NOT auto-populated. Identity and fingerprint
  // unchanged, so paired .anatomy-memory keeps its repo_fingerprint pairing.
  doc.anatomy_version = "0.15";
  const gen = doc.generated as Record<string, unknown> | undefined;
  if (gen && typeof gen === "object") {
    gen.schema = SCHEMA_URLS["0.15"];
    gen.by = `anatomy-cli@${PKG_VERSION}`;
  }
}

function migrateV15toV1_0(doc: Record<string, unknown>): void {
  // v1.0 is the stabilization of the v0.15 format — structurally identical.
  // Relabel only: version + schema URL bump. Identity and fingerprint
  // unchanged, so paired .anatomy-memory keeps its repo_fingerprint pairing.
  doc.anatomy_version = "1.0";
  const gen = doc.generated as Record<string, unknown> | undefined;
  if (gen && typeof gen === "object") {
    gen.schema = SCHEMA_URLS["1.0"];
    gen.by = `anatomy-cli@${PKG_VERSION}`;
  }
}

type MigrateFn = (doc: Record<string, unknown>) => void | MigrationWarning[];
const MIGRATIONS: Record<string, Record<string, MigrateFn>> = {
  "0.1": { "0.2": migrateV1toV2 },
  "0.2": { "0.4": migrateV2toV4 },
  "0.4": { "0.5": migrateV4toV5 },
  "0.5": { "0.6": migrateV5toV6 },
  "0.6": { "0.7": migrateV6toV7 },
  "0.7": { "0.8": migrateV7toV8 },
  "0.8": { "0.9": migrateV8toV9 },
  "0.9": { "0.10": migrateV9toV10 },
  "0.10": { "0.11": migrateV10toV11 },
  "0.11": { "0.12": migrateV11toV12 },
  "0.12": { "0.13": migrateV12toV13 },
  "0.13": { "0.14": migrateV13toV14 },
  "0.14": { "0.15": migrateV14toV15 },
  "0.15": { "1.0": migrateV15toV1_0 },
};
const SUPPORTED_PATHS = Object.entries(MIGRATIONS)
  .flatMap(([from, tos]) => Object.keys(tos).map(to => `${from} → ${to}`))
  .join(", ");

/** BFS through MIGRATIONS to find a forward chain from `from` to `to`.
 *  Returns the inclusive sequence of versions, or null if no path exists.
 *  Linear chain in practice; BFS leaves room for branching versions. */
export function findMigrationPath(from: string, to: string): string[] | null {
  if (from === to) return [from];
  const queue: string[][] = [[from]];
  const visited = new Set<string>([from]);
  while (queue.length > 0) {
    const path = queue.shift()!;
    const last = path[path.length - 1];
    for (const next of Object.keys(MIGRATIONS[last] ?? {})) {
      if (visited.has(next)) continue;
      const newPath = [...path, next];
      if (next === to) return newPath;
      visited.add(next);
      queue.push(newPath);
    }
  }
  return null;
}

export interface MigrateOptions {
  to?: string;
  stdout?: boolean;
}

export async function migrateCommand(rawPath: string | undefined, opts: MigrateOptions): Promise<number> {
  if (!opts.to) {
    console.error("anatomy: migrate --to requires a version argument");
    return 1;
  }
  const targetPath = resolve(rawPath ?? "./.anatomy");
  debug(`migrate: path=${targetPath} to=${opts.to}`);

  if (!existsSync(targetPath)) {
    console.error(`anatomy: .anatomy not found at ${targetPath}`);
    return 1;
  }

  let text: string;
  try {
    text = readAnatomyFile(targetPath);
  } catch (err) {
    console.error(`anatomy: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  let doc: Record<string, unknown>;
  try {
    doc = parseToml(text) as Record<string, unknown>;
  } catch (err) {
    console.error(`anatomy: TOML parse error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  const sourceVersion = String(doc.anatomy_version ?? "");
  if (sourceVersion === opts.to) {
    console.error(`anatomy: already at ${opts.to} — nothing to do`);
    return 0;
  }

  const path = findMigrationPath(sourceVersion, opts.to);
  if (!path || path.length < 2) {
    console.error(`anatomy: no migration path: ${sourceVersion} → ${opts.to} (supported single-step: ${SUPPORTED_PATHS})`);
    return 1;
  }

  const migrationWarnings: MigrationWarning[] = [];
  try {
    for (let i = 0; i < path.length - 1; i++) {
      const fn = MIGRATIONS[path[i]][path[i + 1]];
      const result = fn(doc);
      if (Array.isArray(result)) migrationWarnings.push(...result);
      debug(`migrate: applied ${path[i]} → ${path[i + 1]}`);
    }
  } catch (err) {
    console.error(`anatomy: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  for (const w of migrationWarnings) {
    process.stderr.write(`anatomy: warning: ${w.message}\n`);
  }

  // NOTE: smol-toml.stringify does not preserve insertion order of array-of-tables
  // (see decision in .anatomy and memory entry m0jnp3kq). This is currently safe
  // here because no migrateVxToVy adds [[rules]]/[[flows]]/[[decisions]] (the
  // sections where order is normative for human readability) — migrations only
  // bump anatomy_version + schema URL and add/rename scalar fields. If a future
  // migration ever produces array-of-tables sections, this serialize step must
  // be reworked the same way rehash.ts was (in-place line edits or hand-rolled
  // emission via render/toml.ts).
  const serialized = stringifyToml(doc);
  debug(`migrate: serialized ${serialized.length} bytes`);

  const repoRoot = dirname(targetPath);
  const v = await validate(serialized, { repoRoot, anatomyDir: "" });
  debug(`migrate: validation gate ok=${v.ok}`);
  if (!v.ok) {
    console.error("anatomy: MIGRATE BUG — produced output failed validation:");
    for (const e of v.errors) console.error(`  ${e.code} at ${e.pointer || "/"}: ${e.message}`);
    return 3;
  }

  if (opts.stdout) {
    process.stdout.write(serialized);
    return 0;
  }

  const tmpPath = `${targetPath}.${process.pid}.tmp`;
  writeFileSync(tmpPath, serialized);
  try {
    renameSync(tmpPath, targetPath);
  } catch (err) {
    try { unlinkSync(tmpPath); } catch { /* ignore cleanup error */ }
    console.error(`anatomy: failed to write ${targetPath}: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  const via = path.length > 2 ? ` (via ${path.slice(1, -1).join(" → ")})` : "";
  console.log(`anatomy: migrated ${targetPath} from ${sourceVersion} to ${opts.to}${via}`);
  return 0;
}
