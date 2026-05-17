// src/commands/render.ts
// `anatomy render` — load .anatomy, parse, validate, run renderAll,
// write artifacts. No Pass 1, no Pass 2. The cheap-regen path after
// hand-editing .anatomy or when AGENTS.md needs to catch up after a
// memory append.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as parseToml } from "smol-toml";
import { validate } from "@anatomy/validate";
import { renderAll } from "../render/index.js";
import { writeArtifacts } from "../render/write.js";
import { unifiedDiff } from "../diff.js";
import { debug } from "../log.js";
import { parsedToPass1Result } from "../render/parse-anatomy.js";

export interface RenderOptions {
  repo?: string;
  noAgentsMd?: boolean;
  budgetTokens?: number;
  memoryCount?: number;
  /** --check: exit non-zero if a fresh render would differ from disk. */
  check?: boolean;
  /** Auto-accept overwrite of hand-written AGENTS.md without prompt. */
  yes?: boolean;
  noCursorMdc?: boolean;
  noCursorRules?: boolean;
  noAider?: boolean;
  noCline?: boolean;
  noRoo?: boolean;
  noContinue?: boolean;
  noWindsurf?: boolean;
}

export async function renderCommand(opts: RenderOptions): Promise<number> {
  const repoRoot = resolve(opts.repo ?? process.cwd());
  const anatomyPath = join(repoRoot, ".anatomy");
  if (!existsSync(anatomyPath)) {
    console.error(`anatomy: no .anatomy file at ${anatomyPath}`);
    return 2;
  }
  const raw = readFileSync(anatomyPath, "utf8");
  const v = await validate(raw, { repoRoot, anatomyDir: "" });
  if (!v.ok) {
    console.error(`anatomy: .anatomy fails validation, cannot render:`);
    for (const err of v.errors) console.error(`  ${err.code}: ${err.message}`);
    return 1;
  }
  const parsed = parseToml(raw);
  const pass1 = parsedToPass1Result(parsed);
  const genBlock = (parsed as Record<string, unknown>).generated as Record<string, unknown> | undefined;
  const modelId = typeof genBlock?.model === "string" && genBlock.model !== "none"
    ? genBlock.model
    : undefined;
  const parsedVersion = (parsed as Record<string, unknown>).anatomy_version;
  const anatomyVersion = typeof parsedVersion === "string" ? parsedVersion : undefined;

  // applyBudget no longer throws — it returns truncated content with a banner.
  const artifacts = renderAll(pass1, {
    modelId,
    anatomyVersion,
    emitAnatomy: true,
    // --no-agents-md overrides; otherwise honor file [generate].agents_md (default true).
    emitAgentsMd: opts.noAgentsMd ? false : undefined,
    agentsMdBudgetTokens: opts.budgetTokens,
    agentsMdMemoryCount: opts.memoryCount,
    repoRoot,
    emitCursorMdc: opts.noCursorMdc ? false : undefined,
    emitCursorRules: opts.noCursorRules ? false : undefined,
    emitAider: opts.noAider ? false : undefined,
    emitCline: opts.noCline ? false : undefined,
    emitRoo: opts.noRoo ? false : undefined,
    emitContinue: opts.noContinue ? false : undefined,
    emitWindsurf: opts.noWindsurf ? false : undefined,
  });

  debug(`render: ${artifacts.length} artifact(s) (${artifacts.map(a => a.path).join(", ")})`);

  if (opts.check) {
    let driftFound = false;
    for (const artifact of artifacts) {
      const dst = join(repoRoot, artifact.path);
      if (!existsSync(dst)) {
        console.error(`anatomy: ${artifact.path} missing on disk`);
        driftFound = true;
        continue;
      }
      const onDisk = readFileSync(dst, "utf8");
      if (onDisk !== artifact.content) {
        console.error(`anatomy: ${artifact.path} differs from a fresh render`);
        console.error(unifiedDiff(onDisk, artifact.content, artifact.path));
        driftFound = true;
      }
    }
    return driftFound ? 4 : 0;
  }

  await writeArtifacts(repoRoot, artifacts, { yes: opts.yes });
  for (const a of artifacts) {
    console.log(`✓ wrote ${join(repoRoot, a.path)}`);
  }
  return 0;
}
