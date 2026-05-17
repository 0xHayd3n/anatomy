// src/checks/source-cross-check.ts
// Post-Pass-2 drift check. Flags two classes of authoring drift:
//   1. [[substance.key_dependencies]].name with no quoted reference in
//      scanned source ("unused-dependency-claim").
//   2. Stale host-port / scoped-package / source-path literals embedded in
//      [[rules]].rule|why, [[flows]].summary, [[decisions]].topic|reason
//      ("literal-not-in-source").
// Skipped when repoRoot is undefined (matches structure-path-check pattern).
// See docs/superpowers/specs/2026-05-09-pass2-source-cross-check-design.md.

import { existsSync, readdirSync, readFileSync, statSync, type Dirent } from "node:fs";
import { resolve, join } from "node:path";
import type { ValidationError, Warning } from "../errors.js";

type LiteralKind = "host-port" | "scoped-package" | "source-path";

const HOST_PORT_RE = /\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d{2,5}\b/g;
const SCOPED_PACKAGE_RE = /(?<![\w/])@[a-z0-9][\w-]*\/[a-z0-9][\w.-]*(?![\w/])/g;
const SOURCE_PATH_RE =
  /(?<![\w/])(?:src|lib|app|bin|cmd|pkg|internal|test|tests|spec|specs|docs)\/[\w/.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|swift|c|cpp|h|hpp|rb|php|md|json|toml|yaml|yml|sql|sh|bash)\b/g;

export function extractLiterals(text: string): Array<{ literal: string; kind: LiteralKind }> {
  if (typeof text !== "string" || text.length === 0) return [];
  const seen = new Set<string>();
  const out: Array<{ literal: string; kind: LiteralKind }> = [];
  const push = (literal: string, kind: LiteralKind) => {
    const key = `${kind}\x00${literal}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ literal, kind });
  };
  for (const m of text.matchAll(HOST_PORT_RE)) push(m[0], "host-port");
  for (const m of text.matchAll(SCOPED_PACKAGE_RE)) {
    if (m[0].startsWith("@types/")) continue;
    push(m[0], "scoped-package");
  }
  for (const m of text.matchAll(SOURCE_PATH_RE)) push(m[0], "source-path");
  return out;
}

/** Returns true if `name` appears in `haystack` inside a quoted string,
 *  bounded on the right by either a closing quote or `/` (subpath imports
 *  like `'@fontsource/inter/400.css'` or `'react-dom/client'`). The right-
 *  side `/` is the only addition over a strict closing-quote match — `-` and
 *  `.` are still rejected so `react` does not match `react-dom`/`react.foo`. */
export function findQuotedReference(name: string, haystack: string): boolean {
  if (!name || !haystack) return false;
  return (
    haystack.includes(`'${name}'`) || haystack.includes(`"${name}"`) ||
    haystack.includes(`'${name}/`) || haystack.includes(`"${name}/`)
  );
}

const EXCLUDE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "target", "out",
  ".next", ".turbo", "__pycache__", ".pytest_cache",
  ".venv", "venv", "coverage", ".cache",
  // Documentation build outputs — generated HTML / static site artifacts that
  // bloat the byte budget but never carry a meaningful dep / rule literal.
  // Names match site generators' default output dirs (mkdocs `site/`, jekyll
  // `_site/`, sphinx `_build/`). The 50-repo stress test hit budget exhaustion
  // on fastapi/docs/pt translations and Alamofire/docs jazzy output via paths
  // not in the original exclude list.
  "site", "_site", "_build",
]);

// Files that almost never carry a primary source reference but eat the byte
// budget on large repos. Cheap extension test before stat() avoids reading
// pre-rendered HTML, minified bundles, lockfiles, jupyter notebooks, and
// translation/data files from the haystack. If a project genuinely needs
// these scanned (rare), they can raise ANATOMY_SOURCE_SCAN_BYTES — but then
// they should also know that adding `.html` to a real source-of-truth list
// is unusual.
const SKIP_EXT_RE =
  /\.(?:html|htm|svg|min\.js|min\.css|map|lock|sum|snap|ipynb|csv|tsv|po|pot|jsonl|ndjson)$/i;

const TOP_LEVEL_CONFIG_RE =
  /^\.?(vite|webpack|esbuild|rollup|jest|vitest|eslint|prettier|tsconfig|babel|tailwind|postcss|biome|swc|turbo|nx|lerna|pnpm-workspace)[\w.-]*\.(?:js|ts|cjs|mjs|json|yaml|yml)?$/;

const TOP_LEVEL_CONFIG_LITERALS = new Set([
  "Makefile", "Dockerfile", "docker-compose.yml", "docker-compose.yaml",
]);

// 32 MB default — the prior 8 MB cap was tight enough that 7 of 50 mainstream
// repos in the v0.12 stress test (curl, fastapi, prettier, pandoc, Alamofire,
// Kong, plus one) hit `source-cross-check-truncated` despite mostly being
// bloated by docs/translations rather than source. With the doc-output
// EXCLUDE_DIRS additions and SKIP_EXT_RE blocklist below, 32 MB clears nearly
// all of them while still bounding pathological repos. Reading 32 MB of text
// into a haystack takes well under a second on any modern machine.
const DEFAULT_MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_FILE_BYTES = 256 * 1024;       // 256 KB
const MAX_DEPTH = 10;
const NUL_SCAN_BYTES = 4096;

/** Reads ANATOMY_SOURCE_SCAN_BYTES (e.g. "16M", "32768K", "16777216").
 *  Defaults to DEFAULT_MAX_TOTAL_BYTES (8 MB) when unset/malformed.
 *  Surfaced via the source-cross-check-truncated warning when the budget
 *  is exhausted, so monorepo users with >8MB of source can raise the cap
 *  without splitting into cascading sub-.anatomy files (per the
 *  2026-05-09 stress test on openclaw-fresh). */
export function getMaxTotalBytes(): number {
  const raw = process.env.ANATOMY_SOURCE_SCAN_BYTES;
  if (!raw) return DEFAULT_MAX_TOTAL_BYTES;
  const m = /^(\d+)([KkMmGg]?)$/.exec(raw.trim());
  if (!m) return DEFAULT_MAX_TOTAL_BYTES;
  const n = Number(m[1]);
  if (!isFinite(n) || n <= 0) return DEFAULT_MAX_TOTAL_BYTES;
  const suffix = m[2].toLowerCase();
  const mul = suffix === "k" ? 1024 : suffix === "m" ? 1024 * 1024 : suffix === "g" ? 1024 * 1024 * 1024 : 1;
  return n * mul;
}

const TYPES_DEP_PREFIX = "@types/";
const TOOLING_DEP_ALLOWLIST = new Set(["husky", "lint-staged"]);

interface SourceIndex {
  files: Array<{ relPath: string; content: string }>;
  combinedHaystack: string;
  truncated: boolean;
  /** The byte budget used for this index (from getMaxTotalBytes()). Echoed
   *  in the truncation warning so the user sees what cap was applied. */
  maxTotalBytes: number;
  /** First file relative-path that exceeded the budget and was therefore
   *  NOT loaded — gives the user a concrete pointer for what got skipped. */
  firstSkippedRel?: string;
  /** Parsed package.json `scripts` section, if package.json existed and parsed
   *  as JSON. Used by the bare-command usage check in checkDependencyUsage. */
  packageJsonScripts?: Record<string, string>;
}

/** Sections of package.json that are *declarations* of deps, not uses. They
 *  must be excluded from the haystack — otherwise every declared dep would
 *  match as a quoted reference and Class 1 could never fire. */
const PACKAGE_JSON_DECLARATION_SECTIONS = [
  "dependencies", "devDependencies", "peerDependencies",
  "optionalDependencies", "bundleDependencies", "bundledDependencies",
];

/** Tokens that delimit commands within a package.json script string. */
const SCRIPT_TOKEN_DELIMITERS = /[\s&|;><]+/;

/** Returns true if `name` appears as a whitespace/operator-bounded token in
 *  any value of the parsed package.json scripts. Handles bare invocation
 *  (`"prettier --write ."`), `npx <name>`, and chained commands
 *  (`"npm run lint && vitest run"`). For `@scope/name` deps, also matches
 *  the conventional bin form `<scope>-<name>` (e.g. `@electron/rebuild`
 *  publishes a bin called `electron-rebuild`). */
export function isUsedInScripts(
  name: string,
  scripts: Record<string, string> | undefined,
): boolean {
  if (!name || !scripts) return false;
  const candidates = [name];
  const scopedMatch = /^@([a-z0-9][\w-]*)\/([a-z0-9][\w.-]*)$/.exec(name);
  if (scopedMatch) candidates.push(`${scopedMatch[1]}-${scopedMatch[2]}`);
  for (const value of Object.values(scripts)) {
    if (typeof value !== "string") continue;
    const tokens = value.split(SCRIPT_TOKEN_DELIMITERS).filter(Boolean);
    for (const c of candidates) if (tokens.includes(c)) return true;
  }
  return false;
}

/** Source-file extensions for the top-level source-file scan (matches the
 *  source-path regex's extension list). Repos that put code at the root
 *  rather than under src/ rely on this so dep imports there land in the
 *  haystack. */
const TOP_LEVEL_SOURCE_EXT_RE =
  /\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|swift|c|cpp|h|hpp|rb|php)$/;

function isProbablyBinary(buf: Buffer): boolean {
  const limit = Math.min(buf.length, NUL_SCAN_BYTES);
  for (let i = 0; i < limit; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

interface IndexBuilder {
  files: Array<{ relPath: string; content: string }>;
  totalBytes: number;
  truncated: boolean;
  firstSkippedRel: string | null;
  maxTotalBytes: number;
  seenAbs: Set<string>;
}

function recordSkip(builder: IndexBuilder, scanRoot: string, absPath: string): void {
  builder.truncated = true;
  if (builder.firstSkippedRel === null) {
    let rel = absPath.slice(scanRoot.length);
    if (rel.startsWith("/") || rel.startsWith("\\")) rel = rel.slice(1);
    builder.firstSkippedRel = rel || absPath;
  }
}

/** Loads package.json into the haystack but strips dep-declaration sections
 *  (`dependencies`, `devDependencies`, etc.). Without this, every quoted dep
 *  name in the manifest matches as a "use" and Class 1 cannot fire on any
 *  declared dep — which is the very case it exists to catch. Also captures
 *  the parsed scripts so checkDependencyUsage can detect bare-command usage.
 *  Falls back to plain text load if the file is not parseable JSON. */
function loadPackageJson(
  builder: IndexBuilder,
  scanRoot: string,
): Record<string, string> | undefined {
  const absPath = join(scanRoot, "package.json");
  if (!existsSync(absPath)) return undefined;
  if (builder.seenAbs.has(absPath)) return undefined;
  let raw: string;
  try { raw = readFileSync(absPath, "utf8"); } catch { return undefined; }
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(raw); } catch {
    tryLoadFile(builder, scanRoot, absPath);
    return undefined;
  }
  const filtered: Record<string, unknown> = { ...parsed };
  for (const k of PACKAGE_JSON_DECLARATION_SECTIONS) delete filtered[k];
  const filteredText = JSON.stringify(filtered, null, 2);
  const size = Buffer.byteLength(filteredText, "utf8");
  if (builder.totalBytes + size > builder.maxTotalBytes) {
    recordSkip(builder, scanRoot, absPath);
    return undefined;
  }
  builder.files.push({ relPath: "package.json", content: filteredText });
  builder.totalBytes += size;
  builder.seenAbs.add(absPath);
  const scripts: Record<string, string> = {};
  const rawScripts = parsed.scripts;
  if (rawScripts && typeof rawScripts === "object") {
    for (const [k, v] of Object.entries(rawScripts)) {
      if (typeof v === "string") scripts[k] = v;
    }
  }
  return scripts;
}

function tryLoadFile(builder: IndexBuilder, scanRoot: string, absPath: string): void {
  if (builder.truncated) return;
  if (builder.seenAbs.has(absPath)) return;
  // Cheap extension test before stat() — skip rendered HTML, minified bundles,
  // lockfiles, jupyter notebooks, translation/data files. None of these
  // typically carry the dep / rule literals the cross-check is looking for,
  // and on large repos they collectively dominate the byte budget.
  if (SKIP_EXT_RE.test(absPath)) return;
  let st;
  try { st = statSync(absPath); } catch { return; }
  if (!st.isFile()) return;
  if (st.size > MAX_FILE_BYTES) return;
  if (builder.totalBytes + st.size > builder.maxTotalBytes) {
    recordSkip(builder, scanRoot, absPath);
    return;
  }
  let buf: Buffer;
  try { buf = readFileSync(absPath); } catch { return; }
  if (isProbablyBinary(buf)) return;
  let relPath = absPath.slice(scanRoot.length);
  if (relPath.startsWith("/") || relPath.startsWith("\\")) relPath = relPath.slice(1);
  builder.files.push({ relPath, content: buf.toString("utf8") });
  builder.totalBytes += st.size;
  builder.seenAbs.add(absPath);
}

function walkDir(builder: IndexBuilder, scanRoot: string, dirAbs: string, depth: number): void {
  if (builder.truncated) return;
  if (depth > MAX_DEPTH) return;
  let entries;
  try { entries = readdirSync(dirAbs, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (builder.truncated) return;
    if (e.isDirectory()) {
      if (EXCLUDE_DIRS.has(e.name)) continue;
      walkDir(builder, scanRoot, join(dirAbs, e.name), depth + 1);
    } else if (e.isFile()) {
      tryLoadFile(builder, scanRoot, join(dirAbs, e.name));
    }
  }
}

export function buildSourceIndex(
  scanRoot: string,
  structureEntries: Array<{ path?: string }>,
): SourceIndex {
  const maxTotalBytes = getMaxTotalBytes();
  const builder: IndexBuilder = {
    files: [],
    totalBytes: 0,
    truncated: false,
    firstSkippedRel: null,
    maxTotalBytes,
    seenAbs: new Set(),
  };

  if (!existsSync(scanRoot)) {
    return { files: [], combinedHaystack: "", truncated: false, maxTotalBytes };
  }

  // 1. package.json — load FIRST so the filtered version (dep-declaration
  //    sections stripped) is what lands in the haystack. The structure walker
  //    below skips already-seen absolute paths, so a structure entry like
  //    path = "." won't re-load the unfiltered file.
  const packageJsonScripts = loadPackageJson(builder, scanRoot);

  // 2. Structure dirs (every entry, regardless of kind).
  for (const entry of structureEntries) {
    if (typeof entry?.path !== "string") continue;
    const dirAbs = resolve(scanRoot, entry.path);
    if (!existsSync(dirAbs)) continue;
    let st;
    try { st = statSync(dirAbs); } catch { continue; }
    if (st.isFile()) {
      tryLoadFile(builder, scanRoot, dirAbs);
    } else if (st.isDirectory()) {
      walkDir(builder, scanRoot, dirAbs, 0);
    }
  }

  // 3. Top-level config files + top-level source files. Source-file inclusion
  //    handles small repos that put server.js / database.js / main.py at the
  //    root rather than under src/ — without this, deps imported there look
  //    "unused" because the structure entries don't cover them.
  let topEntries: Dirent[];
  try { topEntries = readdirSync(scanRoot, { withFileTypes: true }); } catch { topEntries = []; }
  for (const e of topEntries) {
    if (!e.isFile()) continue;
    if (
      TOP_LEVEL_CONFIG_LITERALS.has(e.name) ||
      TOP_LEVEL_CONFIG_RE.test(e.name) ||
      TOP_LEVEL_SOURCE_EXT_RE.test(e.name)
    ) {
      tryLoadFile(builder, scanRoot, join(scanRoot, e.name));
    }
  }

  // 4. .github/workflows/*.{yml,yaml}.
  const workflowsDir = join(scanRoot, ".github", "workflows");
  if (existsSync(workflowsDir)) {
    let wfEntries: Dirent[];
    try { wfEntries = readdirSync(workflowsDir, { withFileTypes: true }); } catch { wfEntries = []; }
    for (const e of wfEntries) {
      if (!e.isFile()) continue;
      if (e.name.endsWith(".yml") || e.name.endsWith(".yaml")) {
        tryLoadFile(builder, scanRoot, join(workflowsDir, e.name));
      }
    }
  }

  const combinedHaystack = builder.files.map(f => f.content).join("\n\x00\n");
  return {
    files: builder.files,
    combinedHaystack,
    truncated: builder.truncated,
    maxTotalBytes,
    firstSkippedRel: builder.firstSkippedRel ?? undefined,
    packageJsonScripts,
  };
}

function checkDependencyUsage(
  keyDependencies: Array<{ name?: unknown }>,
  index: SourceIndex,
): Warning[] {
  const warnings: Warning[] = [];
  for (let i = 0; i < keyDependencies.length; i++) {
    const name = keyDependencies[i]?.name;
    if (typeof name !== "string" || name.length === 0) continue;
    if (name.startsWith(TYPES_DEP_PREFIX)) continue;
    if (TOOLING_DEP_ALLOWLIST.has(name)) continue;
    if (findQuotedReference(name, index.combinedHaystack)) continue;
    if (isUsedInScripts(name, index.packageJsonScripts)) continue;
    warnings.push({
      code: "unused-dependency-claim",
      message: `key_dependencies[${i}].name "${name}" not found as a quoted reference in scanned source. Either it's unused (consider removing) or it's referenced in a location the cross-check doesn't scan.`,
      pointer: `/substance/key_dependencies/${i}`,
      actual: name,
    });
  }
  return warnings;
}

interface ClaimField {
  arrayName: "rules" | "flows" | "decisions";
  index: number;
  field: "rule" | "why" | "summary" | "topic" | "reason";
  text: string;
}

function collectClaimFields(doc: unknown): ClaimField[] {
  const out: ClaimField[] = [];
  const d = doc as {
    rules?: Array<{ rule?: unknown; why?: unknown }>;
    flows?: Array<{ summary?: unknown }>;
    decisions?: Array<{ topic?: unknown; reason?: unknown }>;
  };
  if (Array.isArray(d.rules)) {
    for (let i = 0; i < d.rules.length; i++) {
      const r = d.rules[i];
      if (typeof r?.rule === "string") out.push({ arrayName: "rules", index: i, field: "rule", text: r.rule });
      if (typeof r?.why === "string") out.push({ arrayName: "rules", index: i, field: "why", text: r.why });
    }
  }
  if (Array.isArray(d.flows)) {
    for (let i = 0; i < d.flows.length; i++) {
      const f = d.flows[i];
      if (typeof f?.summary === "string") out.push({ arrayName: "flows", index: i, field: "summary", text: f.summary });
    }
  }
  if (Array.isArray(d.decisions)) {
    for (let i = 0; i < d.decisions.length; i++) {
      const dec = d.decisions[i];
      if (typeof dec?.topic === "string") out.push({ arrayName: "decisions", index: i, field: "topic", text: dec.topic });
      if (typeof dec?.reason === "string") out.push({ arrayName: "decisions", index: i, field: "reason", text: dec.reason });
    }
  }
  return out;
}

function checkLiteralCrossReferences(
  fields: ClaimField[],
  scanRoot: string,
  index: SourceIndex,
): Warning[] {
  const warnings: Warning[] = [];
  for (const f of fields) {
    const literals = extractLiterals(f.text);
    for (const { literal, kind } of literals) {
      let found = false;
      if (kind === "source-path") {
        if (existsSync(resolve(scanRoot, literal))) {
          found = true;
        } else if (index.combinedHaystack.includes(literal)) {
          found = true;
        }
      } else {
        if (index.combinedHaystack.includes(literal)) found = true;
      }
      if (found) continue;
      warnings.push({
        code: "literal-not-in-source",
        message: `${kind} literal "${literal}" referenced in ${f.arrayName}[${f.index}].${f.field} not found in scanned source. Either the claim is stale or the literal is in an unscanned location.`,
        pointer: `/${f.arrayName}/${f.index}/${f.field}`,
        actual: literal,
        literalKind: kind,
      });
    }
  }
  return warnings;
}

export function sourceCrossCheck(
  doc: unknown,
  repoRoot?: string,
  anatomyDir?: string,
): { errors: ValidationError[]; warnings: Warning[] } {
  if (!repoRoot) return { errors: [], warnings: [] };

  const scanRoot = anatomyDir ? resolve(repoRoot, anatomyDir) : repoRoot;
  const structureEntries =
    (doc as { structure?: { entries?: Array<{ path?: string }> } })?.structure?.entries ?? [];
  const keyDependencies =
    (doc as { substance?: { key_dependencies?: Array<{ name?: unknown }> } })?.substance?.key_dependencies ?? [];
  const claimFields = collectClaimFields(doc);

  if (keyDependencies.length === 0 && claimFields.length === 0) {
    return { errors: [], warnings: [] };
  }

  const index = buildSourceIndex(scanRoot, structureEntries);
  const warnings: Warning[] = [];

  if (index.truncated) {
    const skippedNote = index.firstSkippedRel
      ? ` First file skipped: ${JSON.stringify(index.firstSkippedRel)}.`
      : "";
    warnings.push({
      code: "source-cross-check-truncated",
      message: `source-cross-check stopped indexing at ${index.maxTotalBytes} bytes; some files were not scanned.${skippedNote} Set ANATOMY_SOURCE_SCAN_BYTES (e.g. 16M, 64M) to raise the budget, or split via cascading sub-.anatomy files for monorepos. Drift in unscanned files cannot be detected.`,
      pointer: "",
    });
  }

  warnings.push(...checkDependencyUsage(keyDependencies, index));
  warnings.push(...checkLiteralCrossReferences(claimFields, scanRoot, index));

  return { errors: [], warnings };
}
