// src/commands/generate.ts
// `anatomy generate` — Pass 1 deterministic generation, optionally followed by
// Pass 2 AI enrichment dispatched through a Pass2Provider (default = claude-cli).
// Composes runPass1 + (optionally) enrichWithAI + renderAll + validation gate (per spec §7).

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { runPass1 } from "../pass1/index.js";
import { renderAll } from "../render/index.js";
import { writeArtifacts } from "../render/write.js";
import { BudgetExceededError } from "../render/budget.js";
import { validate } from "@anatomytool/validate";
import { debug } from "../log.js";
import { listProviders } from "../pass2/providers/index.js";

export interface GenerateOptions {
  repo?: string;
  force?: boolean;
  stdout?: boolean;
  ai?: boolean;
  /** Override the Pass 2 provider. Implies --ai. */
  provider?: string;
  /** Print the prompt that would be sent to Pass 2 (system + user) and
   *  exit 0 without calling any provider. Implies --ai. Useful for plugin
   *  authors verifying their provider against the published contract. */
  printPrompt?: boolean;
  /** List registered Pass 2 providers and exit 0 without generating. */
  listProviders?: boolean;
  /** Skip AGENTS.md emission. AGENTS.md is emitted by default. */
  noAgentsMd?: boolean;
  /** Auto-accept overwrite of hand-written AGENTS.md without prompt. */
  yes?: boolean;
  noCursorMdc?: boolean;
  noCursorRules?: boolean;
  noAider?: boolean;
  noCline?: boolean;
  noRoo?: boolean;
  noContinue?: boolean;
  noWindsurf?: boolean;
  /** Disable the default retry-with-trimmed-input on Pass 2 provider failure. */
  noPass2Retry?: boolean;
  /** Rich mode: Pass 2 fills the v0.14 quick-reference fields (author,
   *  license, docs_url, repository_url, full description, install/dev
   *  commands, key dependencies with versions). Implies --ai; emits the
   *  latest .anatomy format version. */
  rich?: boolean;
}

export async function generateCommand(opts: GenerateOptions): Promise<number> {
  // --providers: enumerate available providers and exit. Pass 1 doesn't run.
  if (opts.listProviders) {
    const providers = await listProviders();
    process.stdout.write("Pass 2 providers:\n");
    for (const p of providers) {
      const ok = await p.available();
      process.stdout.write(`  ${ok ? "✓" : "✗"} ${p.name.padEnd(15)} ${p.description}\n`);
    }
    return 0;
  }

  const repoRoot = resolve(opts.repo ?? process.cwd());
  const targetPath = join(repoRoot, ".anatomy");
  debug(`generate: repoRoot=${repoRoot} target=${targetPath} stdout=${!!opts.stdout} force=${!!opts.force}`);

  // --print-prompt, --provider, and --rich all imply --ai. The user shouldn't
  // have to pass --ai redundantly when they're explicitly invoking Pass 2.
  const ai = opts.ai || opts.printPrompt || !!opts.provider || !!opts.rich;

  // --print-prompt outputs to stdout and never writes a file; skip the
  // overwrite-protection check.
  if (!opts.stdout && !opts.printPrompt && existsSync(targetPath) && !opts.force) {
    console.error(`anatomy: ${targetPath} already exists. Use --force to overwrite.`);
    return 2;
  }

  let pass1;
  const t0 = Date.now();
  try {
    pass1 = runPass1(repoRoot);
  } catch (err) {
    console.error(`anatomy: pass 1 failed: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  debug(`generate: pass1 completed in ${Date.now() - t0}ms`);

  let modelId: string | undefined;
  let pass1Initial = pass1; // preserve the pre-Pass-2 state for the retry path
  if (ai) {
    try {
      const { enrichWithAI } = await import("../pass2/index.js");
      const t1 = Date.now();
      const enriched = await enrichWithAI(pass1, repoRoot, {
        provider: opts.provider,
        printPromptOnly: opts.printPrompt,
        noRetry: opts.noPass2Retry ?? false,
        rich: opts.rich ?? false,
      });
      // --print-prompt: dump system + user prompt and exit 0. No file write.
      if (opts.printPrompt) {
        if (!enriched.prompt) {
          console.error("anatomy: --print-prompt: provider returned no prompt (internal bug)");
          return 1;
        }
        process.stdout.write(`# ─── system prompt ───\n${enriched.prompt.systemPrompt}\n`);
        process.stdout.write(`\n# ─── user prompt ───\n${enriched.prompt.userPrompt}\n`);
        return 0;
      }
      pass1 = enriched.result;
      modelId = enriched.modelId;
      debug(`generate: pass2 completed in ${Date.now() - t1}ms, model=${modelId}`);
    } catch (err) {
      console.error(`anatomy: pass 2 (AI enrichment) failed: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
  }

  let artifacts;
  try {
    artifacts = renderAll(pass1, {
      modelId,
      // Always emit the latest format (LATEST_ANATOMY_VERSION). v0.15 is
      // additive over v0.14 so rich-mode quick-reference fields still
      // validate, and the v0.15 sections (vocabulary/invariants/
      // anti_patterns/prerequisites) are emitted by DEFAULT per
      // spec/0.15/pass2-prompt-contract.md. Pinning the version here was
      // silently discarding Pass 2's v0.15 output.
      anatomyVersion: undefined,
      emitAnatomy: true,
      emitAgentsMd: opts.noAgentsMd ? false : undefined,
      emitCursorMdc: opts.noCursorMdc ? false : undefined,
      emitCursorRules: opts.noCursorRules ? false : undefined,
      emitAider: opts.noAider ? false : undefined,
      emitCline: opts.noCline ? false : undefined,
      emitRoo: opts.noRoo ? false : undefined,
      emitContinue: opts.noContinue ? false : undefined,
      emitWindsurf: opts.noWindsurf ? false : undefined,
    });
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      console.error(`anatomy: ${err.message}`);
      return 3;
    }
    throw err;
  }
  let tomlArtifact = artifacts.find(a => a.path === ".anatomy")!;
  debug(`generate: rendered ${tomlArtifact.content.length} bytes (.anatomy) + ${artifacts.length - 1} other artifact(s)`);

  // Validation gate
  let v = await validate(tomlArtifact.content, { repoRoot, anatomyDir: "" });
  debug(`generate: validation gate ok=${v.ok} errors=${v.ok ? 0 : v.errors.length} warnings=${v.warnings.length}`);

  // Self-correct retry: when the AI-filled output fails validation, give the
  // provider one chance to fix it by feeding the validation errors back. Only
  // attempted with --ai (Pass 1 output is deterministic; if it fails validation
  // that's a generator bug and retry won't help). v0.12 50-repo stress test
  // saw 1/50 hit `identity/function: must NOT have more than 40 characters`;
  // an unprompted re-roll happened to succeed — this makes recovery
  // deterministic and bounded to one extra provider call.
  if (!v.ok && ai) {
    const priorErrors = v.errors;
    debug(`generate: validation failed with ${priorErrors.length} error(s); attempting one-shot self-correct retry`);
    try {
      const { enrichWithAI } = await import("../pass2/index.js");
      const t2 = Date.now();
      const corrected = await enrichWithAI(pass1Initial, repoRoot, {
        provider: opts.provider,
        priorErrors,
        noRetry: opts.noPass2Retry ?? false,
        rich: opts.rich ?? false,
      });
      pass1 = corrected.result;
      modelId = corrected.modelId;
      artifacts = renderAll(pass1, {
        modelId,
        anatomyVersion: undefined,
        emitAnatomy: true,
        emitAgentsMd: opts.noAgentsMd ? false : undefined,
        emitCursorMdc: opts.noCursorMdc ? false : undefined,
        emitCursorRules: opts.noCursorRules ? false : undefined,
        emitAider: opts.noAider ? false : undefined,
        emitCline: opts.noCline ? false : undefined,
        emitRoo: opts.noRoo ? false : undefined,
        emitContinue: opts.noContinue ? false : undefined,
        emitWindsurf: opts.noWindsurf ? false : undefined,
      });
      tomlArtifact = artifacts.find(a => a.path === ".anatomy")!;
      v = await validate(tomlArtifact.content, { repoRoot, anatomyDir: "" });
      debug(`generate: self-correct retry completed in ${Date.now() - t2}ms, validation ok=${v.ok}`);
    } catch (err) {
      // Retry itself failed (e.g. provider error). Fall through to surface the
      // ORIGINAL validation error below — it's more informative than a retry-
      // path provider error.
      debug(`generate: self-correct retry failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (!v.ok) {
    console.error("anatomy: GENERATOR BUG — produced output failed validation. TOML:\n");
    console.error(tomlArtifact.content);
    console.error("\nErrors:");
    for (const e of v.errors) console.error(`  ${e.code} at ${e.pointer || "/"}: ${e.message}`);
    return 3;
  }

  // Surface non-blocking warnings (e.g., source-cross-check drift) to stderr
  // so the user sees them immediately after generation. No exit-code change.
  if (v.warnings.length > 0) {
    for (const w of v.warnings) {
      console.error(`anatomy: WARN ${w.code} at ${w.pointer || "/"}: ${w.message}`);
    }
  }

  if (opts.stdout) {
    // --stdout emits only the .anatomy TOML — AGENTS.md is a side-effect of
    // file-emitting generate, not the preview path.
    process.stdout.write(tomlArtifact.content);
  } else {
    await writeArtifacts(repoRoot, artifacts, { yes: opts.yes });
    for (const a of artifacts) {
      console.log(`✓ wrote ${join(repoRoot, a.path)}`);
    }
  }
  return 0;
}
