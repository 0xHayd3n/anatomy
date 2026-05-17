// src/commands/rehash.ts
// `anatomy rehash [<path>] [--update-memory]` — recomputes fingerprint (and,
// for v0.1–v0.6, per-pillar hashes) from IDs. With --update-memory, also
// propagates the new fingerprint to a paired .anatomy-memory file.

import { existsSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { validate } from "@anatomytool/validate";
import { canonicalize, canonicalHash, fingerprintFromPillars } from "../canonical.js";
import { readAnatomyFile, readAnatomyMemoryFile } from "../io.js";
import { debug } from "../log.js";

const PILLARS = ["stack", "form", "domain", "function"] as const;

export interface RehashOptions {
  updateMemory?: boolean;
}

export async function rehashCommand(rawPath: string | undefined, opts: RehashOptions = {}): Promise<number> {
  const targetPath = resolve(rawPath ?? "./.anatomy");
  debug(`rehash: path=${targetPath} updateMemory=${!!opts.updateMemory}`);

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

  const version = String(doc.anatomy_version ?? "");
  const changes: string[] = [];
  const identity = doc.identity as Record<string, unknown> | undefined;

  if (!identity || typeof identity !== "object") {
    console.error("anatomy: [identity] section missing");
    return 1;
  }

  // Flat vs nested identity is structural, not version-gated: v0.7+ uses
  // plain string pillars; v0.1–v0.6 uses nested { id, hash } objects. A
  // hardcoded version set silently misroutes any flat version not listed
  // (it sent v0.14/v0.15 into the nested branch → "identity.stack missing").
  const isFlat = typeof identity.stack === "string";
  if (isFlat) {
    // Flat string pillars — only recompute fingerprint
    const { stack, form, domain } = identity;
    const fn = identity.function;
    if (
      typeof stack !== "string" || typeof form !== "string" ||
      typeof domain !== "string" || typeof fn !== "string"
    ) {
      console.error(`anatomy: rehash: identity fields (stack/form/domain/function) must be strings in v${version}`);
      return 1;
    }
    const computed = fingerprintFromPillars(stack, form, domain, fn);
    if (identity.fingerprint !== computed) {
      changes.push(`  identity.fingerprint: ${String(identity.fingerprint)} → ${computed}`);
      identity.fingerprint = computed;
    }
  } else {
    // v0.1–v0.6: nested pillar objects with per-pillar hash fields
    for (const pillar of PILLARS) {
      const p = identity[pillar] as Record<string, unknown> | undefined;
      if (!p || typeof p !== "object") {
        console.error(`anatomy: identity.${pillar} missing`);
        return 1;
      }
      const id = p.id;
      if (typeof id !== "string") {
        console.error(`anatomy: identity.${pillar}.id is missing or not a string`);
        return 1;
      }
      if (canonicalize(id) !== id) {
        console.error(`anatomy: identity.${pillar}.id ${JSON.stringify(id)} is not canonical; fix before rehashing`);
        return 1;
      }
      const expected = canonicalHash(id)!;
      const old = p.hash;
      if (old !== expected) {
        changes.push(`  identity.${pillar}.hash: ${String(old)} → ${expected}`);
        p.hash = expected;
      }
    }

    const stackHash  = (identity.stack    as Record<string, unknown>).hash as string;
    const formHash   = (identity.form     as Record<string, unknown>).hash as string;
    const domainHash = (identity.domain   as Record<string, unknown>).hash as string;
    const fnHash     = (identity.function as Record<string, unknown>).hash as string;
    const computedFingerprint = stackHash + formHash + domainHash + fnHash;

    if (identity.fingerprint !== computedFingerprint) {
      changes.push(`  identity.fingerprint: ${String(identity.fingerprint)} → ${computedFingerprint}`);
      identity.fingerprint = computedFingerprint;
    }
  }

  if (changes.length === 0) {
    console.log("already correct — nothing to do");
    if (opts.updateMemory) {
      updateMemoryFingerprint(targetPath, identity.fingerprint as string);
    }
    return 0;
  }

  // For v0.7, do an in-place line replace of `fingerprint = "..."` so the
  // file's section ordering and formatting are preserved byte-for-byte
  // outside the one changed line. Per the project's own decision (see
  // .anatomy[[decisions]] and memory entry m0jnp3kq), smol-toml.stringify
  // is not safe when section order matters. v0.1-v0.6 still go through
  // stringify because their per-pillar hash fields make a line-targeted
  // edit brittle, and older docs lack [[rules]]/[[flows]]/[[decisions]]
  // where ordering would be load-bearing.
  let serialized: string;
  if (isFlat) {
    const newFp = identity.fingerprint as string;
    const fpRe = /^fingerprint = "[a-z0-9]{20}"$/gm;
    const matches = text.match(fpRe);
    if (!matches || matches.length === 0) {
      console.error(`anatomy: rehash: could not locate v${version} fingerprint line for in-place edit`);
      return 1;
    }
    if (matches.length > 1) {
      // Could happen if a [[rules]]/[[flows]]/[[decisions]] string field contains
      // a literal `fingerprint = "..."` line via a multi-line basic string. Refuse
      // rather than risk corrupting the wrong line.
      console.error(`anatomy: rehash: refusing to replace — found ${matches.length} fingerprint-shaped lines in .anatomy; suggests one is inside a string field. Edit manually.`);
      return 1;
    }
    serialized = text.replace(/^fingerprint = "[a-z0-9]{20}"$/m, `fingerprint = "${newFp}"`);
  } else {
    serialized = stringifyToml(doc);
  }
  const v = await validate(serialized, { repoRoot: dirname(targetPath), anatomyDir: "" });
  debug(`rehash: validation gate ok=${v.ok}`);
  if (!v.ok) {
    console.error("anatomy: REHASH BUG — produced output failed validation:");
    for (const e of v.errors) console.error(`  ${e.code} at ${e.pointer || "/"}: ${e.message}`);
    return 3;
  }

  const tmpPath = `${targetPath}.${process.pid}.tmp`;
  writeFileSync(tmpPath, serialized);
  try {
    renameSync(tmpPath, targetPath);
  } catch (err) {
    try { unlinkSync(tmpPath); } catch { /* ignore */ }
    console.error(`anatomy: failed to write ${targetPath}: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  for (const line of changes) console.log(line);
  console.log(`anatomy: ${changes.length} field(s) updated`);
  if (opts.updateMemory) {
    updateMemoryFingerprint(targetPath, identity.fingerprint as string);
  }
  return 0;
}

/** Propagate a fingerprint change to a paired .anatomy-memory file's repo_fingerprint. */
function updateMemoryFingerprint(anatomyPath: string, newFingerprint: string): void {
  const memPath = join(dirname(anatomyPath), ".anatomy-memory");
  if (!existsSync(memPath)) {
    console.log("anatomy: --update-memory: no .anatomy-memory found, nothing to update");
    return;
  }
  let memText: string;
  try {
    memText = readAnatomyMemoryFile(memPath);
  } catch (err) {
    console.error(`anatomy: --update-memory: failed to read ${memPath}: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  // Use match-count-then-replace rather than includes()-then-replace so we
  // don't false-positive on a memory entry whose multi-line content happens
  // to contain a `repo_fingerprint = "..."` line.
  const fpRe = /^repo_fingerprint = "([a-z0-9]{20})"$/gm;
  const matches = [...memText.matchAll(fpRe)];
  if (matches.length === 0) {
    console.error("anatomy: --update-memory: could not locate repo_fingerprint line in .anatomy-memory");
    return;
  }
  if (matches.length > 1) {
    console.error(`anatomy: --update-memory: refusing to replace — found ${matches.length} repo_fingerprint-shaped lines in .anatomy-memory; suggests an entry's content contains one. Edit manually.`);
    return;
  }
  if (matches[0][1] === newFingerprint) {
    console.log("anatomy: --update-memory: .anatomy-memory fingerprint already matches");
    return;
  }
  const target = `repo_fingerprint = "${newFingerprint}"`;
  const replaced = memText.replace(/^repo_fingerprint = "[a-z0-9]{20}"$/m, target);
  const tmp = `${memPath}.${process.pid}.tmp`;
  writeFileSync(tmp, replaced);
  try {
    renameSync(tmp, memPath);
  } catch (err) {
    try { unlinkSync(tmp); } catch { /* ignore */ }
    console.error(`anatomy: --update-memory: failed to write ${memPath}: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  console.log(`anatomy: --update-memory: updated repo_fingerprint to ${newFingerprint}`);
}
