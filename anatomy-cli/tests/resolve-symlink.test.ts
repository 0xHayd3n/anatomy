// Regression for the CI macOS/Windows cascade: when the working dir is a
// symlink/junction/8.3 alias (macOS os.tmpdir() = /var→/private; Windows CI
// runner = C:\Users\RUNNER~1 → runneradmin), `git rev-parse --show-toplevel`
// in detectRepoRoot returns the realpath-canonicalized root while startDir
// stays the alias. findAnatomyForPath then sees queryPath "outside" repoRoot
// and resolveAnatomy reports anatomy_not_found. resolveAnatomy must
// canonicalize both sides so discovery works through an aliased path.
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { resolveAnatomy } from "../src/resolve.js";

const ANATOMY = `anatomy_version = "1.0"
tagline = "symlink resolve fixture"

[identity]
stack = "javascript"
form = "library"
domain = "test"
function = "test-fn"
fingerprint = "w87sfqxp999cxnam77z0"

[generated]
at = 2026-05-17T00:00:00.000Z
by = "test"
model = "test"
schema = "https://anatomy.dev/spec/1.0/schema.json"
`;

describe("resolveAnatomy — path canonicalization", () => {
  it("resolves a .anatomy through a symlinked/junction alias of a git repo", async () => {
    const base = mkdtempSync(join(tmpdir(), "anat-sym-"));
    const real = join(base, "real");
    mkdirSync(real);
    writeFileSync(join(real, ".anatomy"), ANATOMY);
    // Make it a git repo so detectRepoRoot's `git rev-parse --show-toplevel`
    // canonicalizes the path (resolving the alias) — the exact CI condition.
    execSync("git init -q", { cwd: real, shell: true });
    execSync('git -c user.email=t@t -c user.name=t add -A', { cwd: real, shell: true });
    execSync('git -c user.email=t@t -c user.name=t commit -qm init', { cwd: real, shell: true });

    // 'junction' works admin-free on Windows; on POSIX the type arg is
    // ignored and a normal dir symlink is created.
    const alias = join(base, "alias");
    symlinkSync(real, alias, "junction");

    // Sanity: the alias really is non-canonical (otherwise the test is moot).
    expect(realpathSync(alias)).not.toBe(alias);

    const result = await resolveAnatomy(alias);
    if ("error" in result) {
      throw new Error(`resolveAnatomy failed through alias: ${JSON.stringify(result)}`);
    }
    expect(result.doc.tagline).toBe("symlink resolve fixture");
  });
});
