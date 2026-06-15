#!/usr/bin/env node
// src/bin.ts
// CLI entry — manual argv parsing + command dispatch.

import { validateCommand } from "./commands/validate.js";
import { generateCommand } from "./commands/generate.js";
import { renderCommand } from "./commands/render.js";
import { explainCommand } from "./commands/explain.js";
import { migrateCommand } from "./commands/migrate.js";
import { rehashCommand } from "./commands/rehash.js";
import { showCommand } from "./commands/show.js";
import { addCommand } from "./commands/add.js";
import { memoryCommand } from "./commands/memory.js";
import { hookCommand } from "./commands/hook.js";
import { mcpCommand } from "./commands/mcp.js";
import { telemetryCommand } from "./commands/telemetry-cmd.js";
import { ingestCommand } from "./commands/ingest.js";
import { verifySuggestCommand } from "./commands/verify-suggest.js";
import { setVerbose } from "./log.js";
import { ECOSYSTEM_VERSION } from "@anatomytool/validate";
import { PKG_VERSION } from "./version.js";

const HELP = `Usage: anatomy <command> [options]

Commands:
  validate [<path>] [--require] [--require-fresh] [--no-strict] [--json] [--quiet]
                                            Validate a .anatomy file (default: ./.anatomy).
                                            --require: exit 1 if no .anatomy found (default: warn + exit 0).
                                            --require-fresh: exit 1 if generated.commit doesn't match git HEAD.
                                            Strict-by-default: source-cross-check warnings
                                                (unused-dependency-claim, literal-not-in-source,
                                                source-cross-check-truncated) are treated as errors and exit 1.
                                            --no-strict: keep them as warnings (exit 0).
                                            --strict: accepted as a back-compat no-op (strict is the default).
                                            --json: emit structured JSON to stdout; human messages to stderr.
  generate [--repo <path>] [--force] [--stdout] [--no-agents-md]
           [--ai] [--rich] [--provider <name>] [--print-prompt] [--providers]
           [--no-pass2-retry] [--model <id>]
           [--no-cursor-mdc] [--no-cursor-rules] [--no-aider]
           [--no-cline] [--no-roo] [--no-continue] [--no-windsurf]
                                            Generate a starter .anatomy from manifest + README + dirs.
                                            Also emits AGENTS.md alongside (--no-agents-md to skip).
                                            --ai: enrich TODO fields via a Pass 2 provider (default: claude-cli).
                                            --rich: rich mode — Pass 2 fills additional README-derivable
                                            fields (author, license, docs URL, install/dev commands, key
                                            dependencies with versions, full description). Implies --ai
                                            and emits the latest .anatomy format version.
                                            --provider <name>: pick a specific Pass 2 provider (implies --ai).
                                            --model <id>: Pass 2 model (implies --ai). Or set
                                            ANATOMY_PASS2_MODEL. Default: the provider's own.
                                            --print-prompt: dump the prompt that would be sent to Pass 2 and
                                            exit 0 without calling any provider (implies --ai).
                                            --providers: list registered Pass 2 providers and exit.
                                            --no-pass2-retry: disable the default retry-with-trimmed-input
                                            on Pass 2 provider failure (used by deterministic eval runs).
  ingest [<path>] [--repo <path>] [--force] [--no-pass1] [--stdout]
                                            Ingest CLAUDE.md / AGENTS.md / .cursorrules / .windsurfrules
                                            into a seed .anatomy. Pass <path> to a single file, or omit
                                            for auto-scan at repo root. Refuses on existing .anatomy
                                            unless --force. --no-pass1: skip identity detection
                                            (placeholder values). --stdout: preview without writing.
  render [--repo <path>] [--no-agents-md] [--budget <tokens>]
         [--memory-count <n>] [--check]
         [--no-cursor-mdc] [--no-cursor-rules] [--no-aider]
         [--no-cline] [--no-roo] [--no-continue] [--no-windsurf]
                                            Re-render output files from an existing .anatomy (no Pass 1/2).
                                            Cheap regen after hand-edits to .anatomy or memory.
                                            --no-agents-md: skip AGENTS.md emission.
                                            --budget: AGENTS.md token cap (default 1500).
                                            --memory-count: max memory entries surfaced (default 10).
                                            --check: exit non-zero if a fresh render would differ from disk.
                                            --yes, -y: auto-accept overwrite of a hand-written AGENTS.md (defaults to true on non-TTY).
                                            --no-cursor-mdc: skip .cursor/rules/anatomy.mdc emission.
                                            --no-cursor-rules: skip .cursorrules emission.
                                            --no-aider: skip CONVENTIONS.md emission.
                                            --no-cline: skip .clinerules emission.
                                            --no-roo: skip .roorules emission.
                                            --no-continue: skip .continuerules emission.
                                            --no-windsurf: skip .windsurfrules emission.
  explain <code>                            Print the documentation for an error or warning code.
  migrate --to <version> [<path>] [--stdout]
                                            Migrate a .anatomy file to a newer format version (default: ./.anatomy).
  rehash [<path>] [--update-memory]         Recompute pillar hashes and fingerprint from IDs (default: ./.anatomy).
                                            --update-memory: also propagate the new fingerprint to a paired
                                            .anatomy-memory file's repo_fingerprint header.
  hook [--root] [--max-tokens N] [--json]
                                            Emit markdown for Claude Code SessionStart injection.
                                            --root: use repo root .anatomy instead of cwd-resolved.
                                            --max-tokens: token budget (default 1200).
                                            --json: emit structured JSON instead of markdown.
  show [<path>] [--prose]
       [--no-memory | --memory-only]
       [--memory-limit-{gotcha,decision,attempt,milestone}=N]
       [--memory-limit-convention=N]   Display a parsed .anatomy file (--prose: natural language).
                                       --prose appends a memory section if .anatomy-memory exists.
                                       --no-memory: suppress memory; --memory-only: only memory.
                                       Default per-kind caps: 10 gotcha/decision, 5 attempt/milestone,
                                       uncapped conventions. --memory-limit-X=N overrides one kind.
  add <kind> <topic> [content] [--refs <a,b>] [--tags <a,b>] [--supersedes <id>]
                                            Append a memory entry. Read content from stdin if "-" passed,
                                            or open $EDITOR when content arg is omitted.
                                            Kinds: gotcha | decision | convention | attempt | milestone
  mcp [--with-fff] [--with-ast-grep]        Start an MCP stdio server exposing anatomy's tools.
                                            --with-fff: also proxy fff's tools (ffgrep, fffind) via
                                            a child fff-mcp subprocess. Hard-fails if no fff
                                            binary is on PATH. ANATOMY_FFF_BIN overrides the binary
                                            path (point at fff-mcp; binary takes no args by default);
                                            ANATOMY_FFF_ARGS sets argv for the rare binary that needs
                                            a subcommand (default: none);
                                            ANATOMY_FFF_TIMEOUT_MS overrides the per-call timeout
                                            (default 5000).
                                            --with-ast-grep: also expose ast_grep_search for
                                            structural code search via @ast-grep/napi (in-process).
                                            Hard-fails if the optional dep failed to install.
                                            ANATOMY_AST_GREP_MAX_FILES (default 5000) caps the
                                            file walk per call.
  memory list [--kind <k>] [--topic <s>]
              [--ref <s>] [--tag <t>]
              [--include-superseded]
              [--only-fresh]              List entries (default: hide superseded/deprecated). v0.2 adds a
                                          decay column (fresh / aging / stale / untouched) and the
                                          --only-fresh flag for restricting to recently-confirmed entries.
  memory grep "<query>"                   Substring match in topic + content (newest first).
  memory search "<query>"                 BM25F relevance ranking (topic ×3, tags ×2, content ×1) × decay.
              [--kind <k>] [--tag <t>]    Filters AND together as hard pre-filters. Default limit 10.
              [--ref <s>] [--limit <n>]
              [--include-superseded]
  memory show <id>                        Full detail of one entry + supersession chain.
  memory stats                            Per-kind counts of active/superseded/deprecated, with v0.2
                                          decay-bucket breakdown for active entries.
  memory deprecate <id> --reason <text>   Mark entry obsolete with no replacement.
  memory thanks <id>                      Record that an entry helped you (idempotent per identity).
  memory verify <id>                      Mark entry as confirmed-still-relevant (v0.2). Updates
                                          last_verified_at + verified_by; bumps the file's
                                          anatomy_memory_version to "0.2" on first verify against a
                                          v0.1 file.
  memory credits                          Markdown table of contributors and their impact.
  telemetry stats                         Show summary of ~/.anatomy/telemetry.jsonl.
  telemetry clear                         Wipe the telemetry log.
  verify suggest [--repo <path>] [--refresh-registry]
                                            Interactively propose verify clauses for rules
                                            that lack one. Three sources (test mining →
                                            registry → LLM) with a dry-run gate. Accept,
                                            edit, reject per rule. Requires a TTY.

Options:
  -h, --help                                Show this help.
  --version                                 Print version info.
  -v, --verbose                             Print debug output to stderr (decisions made by detectors and heuristics).
`;

interface ParsedArgs {
  cmd: string;
  positional: string[];
  flags: Record<string, string | boolean>;
}

function parseLimit(s: string | boolean | undefined): number | undefined {
  if (typeof s !== "string") return undefined;
  const n = Number(s);
  return isNaN(n) ? undefined : n;
}

function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  let i = 0;
  const cmd = argv[i++] ?? "";
  while (i < argv.length) {
    const a = argv[i];
    if (a === "--help" || a === "-h") { flags.help = true; i++; continue; }
    if (a === "--version") { flags.version = true; i++; continue; }
    if (a === "--quiet") { flags.quiet = true; i++; continue; }
    if (a === "--require") { flags.require = true; i++; continue; }
    if (a === "--require-fresh") { flags.requireFresh = true; i++; continue; }
    if (a === "--strict") { flags.strict = true; i++; continue; } // back-compat no-op (strict is default)
    if (a === "--no-strict") { flags.noStrict = true; i++; continue; }
    if (a === "--root") { flags.root = true; i++; continue; }
    if (a === "--max-tokens") { flags.maxTokens = argv[++i] ?? ""; i++; continue; }
    if (a === "--json") { flags.json = true; i++; continue; }
    if (a === "--force") { flags.force = true; i++; continue; }
    if (a === "--stdout") { flags.stdout = true; i++; continue; }
    if (a === "--verbose" || a === "-v") { flags.verbose = true; i++; continue; }
    if (a === "--ai") { flags.ai = true; i++; continue; }
    if (a === "--provider") { flags.provider = argv[++i] ?? ""; i++; continue; }
    if (a === "--model") { flags.model = argv[++i] ?? ""; i++; continue; }
    if (a === "--print-prompt") { flags.printPrompt = true; i++; continue; }
    if (a === "--providers") { flags.listProviders = true; i++; continue; }
    if (a === "--no-agents-md") { flags.noAgentsMd = true; i++; continue; }
    if (a === "--no-cursor-mdc") { flags.noCursorMdc = true; i++; continue; }
    if (a === "--no-cursor-rules") { flags.noCursorRules = true; i++; continue; }
    if (a === "--no-aider") { flags.noAider = true; i++; continue; }
    if (a === "--no-cline") { flags.noCline = true; i++; continue; }
    if (a === "--no-roo") { flags.noRoo = true; i++; continue; }
    if (a === "--no-continue") { flags.noContinue = true; i++; continue; }
    if (a === "--no-windsurf") { flags.noWindsurf = true; i++; continue; }
    if (a === "--no-pass2-retry") { flags.noPass2Retry = true; i++; continue; }
    if (a === "--with-fff") { flags.withFff = true; i++; continue; }
    if (a === "--with-ast-grep") { flags.withAstGrep = true; i++; continue; }
    if (a === "--refresh-registry") { flags.refreshRegistry = true; i++; continue; }
    if (a === "--rich") { flags.rich = true; i++; continue; }
    if (a === "--no-pass1") { flags.noPass1 = true; i++; continue; }
    if (a === "--budget") { flags.budget = argv[++i] ?? ""; i++; continue; }
    if (a === "--memory-count") { flags.memoryCount = argv[++i] ?? ""; i++; continue; }
    if (a === "--check") { flags.check = true; i++; continue; }
    if (a === "--yes" || a === "-y") { flags.yes = true; i++; continue; }
    if (a === "--prose") { flags.prose = true; i++; continue; }
    if (a === "--no-memory") { flags.noMemory = true; i++; continue; }
    if (a === "--memory-only") { flags.memoryOnly = true; i++; continue; }
    if (a === "--memory-limit-gotcha") { flags.memoryLimitGotcha = argv[++i] ?? ""; i++; continue; }
    if (a === "--memory-limit-decision") { flags.memoryLimitDecision = argv[++i] ?? ""; i++; continue; }
    if (a === "--memory-limit-attempt") { flags.memoryLimitAttempt = argv[++i] ?? ""; i++; continue; }
    if (a === "--memory-limit-milestone") { flags.memoryLimitMilestone = argv[++i] ?? ""; i++; continue; }
    if (a === "--memory-limit-convention") { flags.memoryLimitConvention = argv[++i] ?? ""; i++; continue; }
    if (a === "--repo") { flags.repo = argv[++i] ?? ""; i++; continue; }
    if (a === "--to") { flags.to = argv[++i] ?? ""; i++; continue; }
    if (a === "--supersedes") { flags.supersedes = argv[++i] ?? ""; i++; continue; }
    if (a === "--refs") { flags.refs = argv[++i] ?? ""; i++; continue; }
    if (a === "--tags") { flags.tags = argv[++i] ?? ""; i++; continue; }
    if (a === "--reason") { flags.reason = argv[++i] ?? ""; i++; continue; }
    if (a === "--include-superseded") { flags.includeSuperseded = true; i++; continue; }
    if (a === "--only-fresh") { flags.onlyFresh = true; i++; continue; }
    if (a === "--update-memory") { flags.updateMemory = true; i++; continue; }
    if (a === "--kind") { flags.kind = argv[++i] ?? ""; i++; continue; }
    if (a === "--topic") { flags.topic = argv[++i] ?? ""; i++; continue; }
    if (a === "--ref") { flags.ref = argv[++i] ?? ""; i++; continue; }
    if (a === "--tag") { flags.tag = argv[++i] ?? ""; i++; continue; }
    if (a === "--limit") { flags.limit = argv[++i] ?? ""; i++; continue; }
    if (a.startsWith("--")) {
      console.error(`anatomy: unknown flag ${a}`);
      process.exit(1);
    }
    positional.push(a);
    i++;
  }
  return { cmd, positional, flags };
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    console.log(HELP);
    return 0;
  }
  if (argv[0] === "--version") {
    console.log(`@anatomytool/cli@${PKG_VERSION} (anatomy ecosystem v${ECOSYSTEM_VERSION})`);
    return 0;
  }
  const { cmd, positional, flags } = parseArgs(argv);
  if (flags.help) {
    console.log(HELP);
    return 0;
  }
  if (flags.verbose) setVerbose(true);
  switch (cmd) {
    case "validate":
      return validateCommand(positional[0], {
        quiet: !!flags.quiet,
        require: !!flags.require,
        requireFresh: !!flags.requireFresh,
        json: !!flags.json,
        noStrict: !!flags.noStrict,
      });
    case "generate":
      return generateCommand({
        repo: typeof flags.repo === "string" ? flags.repo : undefined,
        force: !!flags.force,
        stdout: !!flags.stdout,
        ai: !!flags.ai,
        provider: typeof flags.provider === "string" ? flags.provider : undefined,
        model: typeof flags.model === "string" ? flags.model : undefined,
        printPrompt: !!flags.printPrompt,
        listProviders: !!flags.listProviders,
        noAgentsMd: !!flags.noAgentsMd,
        yes: !!flags.yes,
        noCursorMdc: !!flags.noCursorMdc,
        noCursorRules: !!flags.noCursorRules,
        noAider: !!flags.noAider,
        noCline: !!flags.noCline,
        noRoo: !!flags.noRoo,
        noContinue: !!flags.noContinue,
        noWindsurf: !!flags.noWindsurf,
        noPass2Retry: !!flags.noPass2Retry,
        rich: !!flags.rich,
      });
    case "ingest":
      await ingestCommand({
        inputPath: positional[0],
        repo: typeof flags.repo === "string" ? flags.repo : undefined,
        force: !!flags.force,
        noPass1: !!flags.noPass1,
        stdout: !!flags.stdout,
      });
      return 0;
    case "render":
      return renderCommand({
        repo: typeof flags.repo === "string" ? flags.repo : undefined,
        noAgentsMd: !!flags.noAgentsMd,
        budgetTokens: parseLimit(flags.budget),
        memoryCount: parseLimit(flags.memoryCount),
        check: !!flags.check,
        yes: !!flags.yes,
        noCursorMdc: !!flags.noCursorMdc,
        noCursorRules: !!flags.noCursorRules,
        noAider: !!flags.noAider,
        noCline: !!flags.noCline,
        noRoo: !!flags.noRoo,
        noContinue: !!flags.noContinue,
        noWindsurf: !!flags.noWindsurf,
      });
    case "explain":
      return explainCommand(positional[0]);
    case "migrate":
      return migrateCommand(positional[0], {
        to: typeof flags.to === "string" ? flags.to : undefined,
        stdout: !!flags.stdout,
      });
    case "rehash":
      return rehashCommand(positional[0], { updateMemory: !!flags.updateMemory });
    case "hook":
      return hookCommand({
        root: !!flags.root,
        // parseLimit returns undefined for non-numeric (incl. NaN), so the
        // hook's DEFAULT_MAX_TOKENS fallback via ?? actually fires.
        // Number("abc") would have produced NaN, which ?? doesn't catch.
        maxTokens: parseLimit(flags.maxTokens),
        json: !!flags.json,
      });
    case "show":
      return showCommand(positional[0], {
        prose: !!flags.prose,
        noMemory: !!flags.noMemory,
        memoryOnly: !!flags.memoryOnly,
        memoryLimitGotcha: parseLimit(flags.memoryLimitGotcha),
        memoryLimitDecision: parseLimit(flags.memoryLimitDecision),
        memoryLimitAttempt: parseLimit(flags.memoryLimitAttempt),
        memoryLimitMilestone: parseLimit(flags.memoryLimitMilestone),
        memoryLimitConvention: parseLimit(flags.memoryLimitConvention),
      });
    case "add":
      return addCommand(positional, {
        supersedes: typeof flags.supersedes === "string" ? flags.supersedes : undefined,
        refs: typeof flags.refs === "string" ? flags.refs : undefined,
        tags: typeof flags.tags === "string" ? flags.tags : undefined,
      });
    case "memory":
      return memoryCommand(positional, {
        reason: typeof flags.reason === "string" ? flags.reason : undefined,
        kind: typeof flags.kind === "string" ? flags.kind : undefined,
        topic: typeof flags.topic === "string" ? flags.topic : undefined,
        ref: typeof flags.ref === "string" ? flags.ref : undefined,
        tag: typeof flags.tag === "string" ? flags.tag : undefined,
        limit: parseLimit(flags.limit),
        includeSuperseded: !!flags.includeSuperseded,
        onlyFresh: !!flags.onlyFresh,
      });
    case "mcp":
      return mcpCommand({
        withFff: !!flags.withFff,
        withAstGrep: !!flags.withAstGrep,
      });
    case "telemetry":
      return telemetryCommand(positional, {});
    case "verify": {
      const sub = positional[0];
      if (sub !== "suggest") {
        console.error(`anatomy verify: unknown subcommand '${sub ?? ""}'. Use 'anatomy verify suggest'.`);
        return 1;
      }
      return verifySuggestCommand({
        repo: typeof flags.repo === "string" ? flags.repo : undefined,
        refreshRegistry: !!flags.refreshRegistry,
      });
    }
    default:
      console.error(`anatomy: unknown command "${cmd}"\n\n${HELP}`);
      return 1;
  }
}

(async () => {
  try {
    process.exit(await main());
  } catch (err) {
    console.error("anatomy:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
})();
