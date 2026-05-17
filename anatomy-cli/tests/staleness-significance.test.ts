import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { matchesAllowlist, classifyStaleness } from "../src/staleness-significance.js";

describe("matchesAllowlist — documentation files (§5.1)", () => {
  it("matches *.md extension", () => {
    expect(matchesAllowlist("README.md")).toBe(true);
    expect(matchesAllowlist("nested/dir/notes.md")).toBe(true);
  });
  it("matches *.txt and *.rst", () => {
    expect(matchesAllowlist("CHANGELOG.txt")).toBe(true);
    expect(matchesAllowlist("docs/intro.rst")).toBe(true);
  });
  it("matches conventional license/credit filenames at any depth", () => {
    expect(matchesAllowlist("LICENSE")).toBe(true);
    expect(matchesAllowlist("LICENSE.txt")).toBe(true);
    expect(matchesAllowlist("subdir/COPYING")).toBe(true);
    expect(matchesAllowlist("NOTICE")).toBe(true);
    expect(matchesAllowlist("AUTHORS")).toBe(true);
  });
  it("rejects markdown look-alikes", () => {
    expect(matchesAllowlist("mydoc.md.bak")).toBe(false);
    expect(matchesAllowlist("md/something.ts")).toBe(false);
  });
});

describe("matchesAllowlist — documentation directories (§5.2)", () => {
  it("matches any path under docs/ or doc/", () => {
    expect(matchesAllowlist("docs/intro.html")).toBe(true);
    expect(matchesAllowlist("docs/diagrams/img.svg")).toBe(true);
    expect(matchesAllowlist("doc/api.json")).toBe(true);
  });
  it("does not match docs/ as a substring", () => {
    expect(matchesAllowlist("src/docs/index.ts")).toBe(false);
  });
});

describe("matchesAllowlist — lockfiles (§5.3)", () => {
  it("matches recognized lockfiles at any depth", () => {
    expect(matchesAllowlist("package-lock.json")).toBe(true);
    expect(matchesAllowlist("packages/foo/yarn.lock")).toBe(true);
    expect(matchesAllowlist("Cargo.lock")).toBe(true);
    expect(matchesAllowlist("go.sum")).toBe(true);
    expect(matchesAllowlist("Gemfile.lock")).toBe(true);
    expect(matchesAllowlist("poetry.lock")).toBe(true);
    expect(matchesAllowlist("Pipfile.lock")).toBe(true);
    expect(matchesAllowlist("composer.lock")).toBe(true);
    expect(matchesAllowlist("pnpm-lock.yaml")).toBe(true);
  });
  it("does not match lockfile look-alikes", () => {
    expect(matchesAllowlist("my-package-lock.json")).toBe(false);
  });
});

describe("matchesAllowlist — config dotfiles (§5.4)", () => {
  it("matches at any depth", () => {
    expect(matchesAllowlist(".gitignore")).toBe(true);
    expect(matchesAllowlist("subdir/.gitignore")).toBe(true);
    expect(matchesAllowlist(".gitattributes")).toBe(true);
    expect(matchesAllowlist(".editorconfig")).toBe(true);
    expect(matchesAllowlist(".prettierrc")).toBe(true);
    expect(matchesAllowlist(".prettierrc.json")).toBe(true);
    expect(matchesAllowlist(".prettierrc.yaml")).toBe(true);
    expect(matchesAllowlist(".eslintrc.cjs")).toBe(true);
    expect(matchesAllowlist(".eslintignore")).toBe(true);
    expect(matchesAllowlist(".nvmrc")).toBe(true);
    expect(matchesAllowlist(".tool-versions")).toBe(true);
  });
});

describe("matchesAllowlist — CI workflow files (§5.5)", () => {
  it("matches GitHub Actions workflows", () => {
    expect(matchesAllowlist(".github/workflows/ci.yml")).toBe(true);
    expect(matchesAllowlist(".github/workflows/release.yaml")).toBe(true);
  });
  it("matches other CI config files", () => {
    expect(matchesAllowlist(".circleci/config.yml")).toBe(true);
    expect(matchesAllowlist(".gitlab-ci.yml")).toBe(true);
    expect(matchesAllowlist(".travis.yml")).toBe(true);
  });
  it("does not match non-workflow files under .github/", () => {
    expect(matchesAllowlist(".github/CODEOWNERS")).toBe(false);
  });
});

describe("matchesAllowlist — anatomy-internal + renderer outputs (§5.6)", () => {
  it("matches anatomy/memory files", () => {
    expect(matchesAllowlist(".anatomy")).toBe(true);
    expect(matchesAllowlist(".anatomy-memory")).toBe(true);
    expect(matchesAllowlist("subdir/.anatomy")).toBe(true);
  });
  it("matches AGENTS.md and renderer outputs", () => {
    expect(matchesAllowlist("AGENTS.md")).toBe(true);
    expect(matchesAllowlist(".cursorrules")).toBe(true);
    expect(matchesAllowlist(".cursor/rules/anatomy.mdc")).toBe(true);
    expect(matchesAllowlist(".clinerules")).toBe(true);
    expect(matchesAllowlist(".roorules")).toBe(true);
    expect(matchesAllowlist(".continuerules")).toBe(true);
    expect(matchesAllowlist(".windsurfrules")).toBe(true);
  });
  it("does not match user-managed config (e.g. aider config)", () => {
    expect(matchesAllowlist(".aider.conf.yml")).toBe(false);
  });
});

describe("matchesAllowlist — negative cases", () => {
  it("rejects source files", () => {
    expect(matchesAllowlist("src/index.ts")).toBe(false);
    expect(matchesAllowlist("lib/foo.js")).toBe(false);
    expect(matchesAllowlist("main.go")).toBe(false);
    expect(matchesAllowlist("script.py")).toBe(false);
  });
  it("rejects binary assets", () => {
    expect(matchesAllowlist("assets/logo.png")).toBe(false);
  });
});

function setupRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "anat-stale-sig-"));
  execSync("git init", { cwd: dir, stdio: "ignore", shell: true });
  execSync('git config user.email "t@t.com"', { cwd: dir, stdio: "ignore", shell: true });
  execSync('git config user.name "T"', { cwd: dir, stdio: "ignore", shell: true });
  return dir;
}

function commit(dir: string, msg: string): string {
  execSync("git add -A", { cwd: dir, stdio: "ignore", shell: true });
  execSync(`git commit -m "${msg}"`, { cwd: dir, stdio: "ignore", shell: true });
  return execSync("git rev-parse --short HEAD", { cwd: dir, encoding: "utf8", shell: true }).trim();
}

let dir: string;
beforeEach(() => { dir = setupRepo(); });
afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

describe("classifyStaleness — cosmetic cases", () => {
  it("classifies markdown-only changes as cosmetic", () => {
    writeFileSync(join(dir, "README.md"), "v1\n");
    const c1 = commit(dir, "c1");
    writeFileSync(join(dir, "README.md"), "v2\n");
    const c2 = commit(dir, "c2");
    expect(classifyStaleness(dir, c1, c2)).toBe("cosmetic");
  });

  it("classifies lockfile-only changes as cosmetic", () => {
    writeFileSync(join(dir, "package-lock.json"), '{"v":1}\n');
    const c1 = commit(dir, "c1");
    writeFileSync(join(dir, "package-lock.json"), '{"v":2}\n');
    const c2 = commit(dir, "c2");
    expect(classifyStaleness(dir, c1, c2)).toBe("cosmetic");
  });

  it("classifies .anatomy-only changes as cosmetic", () => {
    writeFileSync(join(dir, ".anatomy"), "x = 1\n");
    const c1 = commit(dir, "c1");
    writeFileSync(join(dir, ".anatomy"), "x = 2\n");
    const c2 = commit(dir, "c2");
    expect(classifyStaleness(dir, c1, c2)).toBe("cosmetic");
  });

  it("classifies renderer-output-only changes as cosmetic", () => {
    writeFileSync(join(dir, ".cursorrules"), "rule1\n");
    const c1 = commit(dir, "c1");
    writeFileSync(join(dir, ".cursorrules"), "rule2\n");
    const c2 = commit(dir, "c2");
    expect(classifyStaleness(dir, c1, c2)).toBe("cosmetic");
  });

  it("classifies multiple allowlisted changes as cosmetic", () => {
    writeFileSync(join(dir, "README.md"), "v1\n");
    writeFileSync(join(dir, "package-lock.json"), '{"v":1}\n');
    const c1 = commit(dir, "c1");
    writeFileSync(join(dir, "README.md"), "v2\n");
    writeFileSync(join(dir, "package-lock.json"), '{"v":2}\n');
    writeFileSync(join(dir, ".gitignore"), "node_modules\n");
    const c2 = commit(dir, "c2");
    expect(classifyStaleness(dir, c1, c2)).toBe("cosmetic");
  });

  it("classifies empty diff (semantically identical trees) as cosmetic", () => {
    writeFileSync(join(dir, "x.md"), "x\n");
    const c1 = commit(dir, "c1");
    execSync('git commit --allow-empty -m "c2"', { cwd: dir, stdio: "ignore", shell: true });
    const c2 = execSync("git rev-parse --short HEAD", { cwd: dir, encoding: "utf8", shell: true }).trim();
    expect(classifyStaleness(dir, c1, c2)).toBe("cosmetic");
  });
});

describe("classifyStaleness — unknown cases", () => {
  it("classifies code-file changes as unknown", () => {
    writeFileSync(join(dir, "src.ts"), "const x = 1;\n");
    const c1 = commit(dir, "c1");
    writeFileSync(join(dir, "src.ts"), "const x = 2;\n");
    const c2 = commit(dir, "c2");
    expect(classifyStaleness(dir, c1, c2)).toBe("unknown");
  });

  it("classifies mixed (doc + code) changes as unknown", () => {
    writeFileSync(join(dir, "src.ts"), "const x = 1;\n");
    writeFileSync(join(dir, "README.md"), "v1\n");
    const c1 = commit(dir, "c1");
    writeFileSync(join(dir, "src.ts"), "const x = 2;\n");
    writeFileSync(join(dir, "README.md"), "v2\n");
    const c2 = commit(dir, "c2");
    expect(classifyStaleness(dir, c1, c2)).toBe("unknown");
  });

  it("classifies binary file changes as unknown", () => {
    writeFileSync(join(dir, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const c1 = commit(dir, "c1");
    writeFileSync(join(dir, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x46]));
    const c2 = commit(dir, "c2");
    expect(classifyStaleness(dir, c1, c2)).toBe("unknown");
  });

  it("short-circuits to unknown at exactly 101 paths (perf guard upper boundary)", () => {
    // Seed c1 with one file so the test starts from a single commit. c2 adds
    // 101 NEW allowlisted (.md) files — without the cap, this would classify
    // as 'cosmetic' (all files match the allowlist). With the cap (>100), it
    // must return 'unknown'.
    writeFileSync(join(dir, "seed.md"), "x\n");
    const c1 = commit(dir, "c1");
    for (let i = 0; i < 101; i++) writeFileSync(join(dir, `doc${i}.md`), "v\n");
    const c2 = commit(dir, "c2");
    expect(classifyStaleness(dir, c1, c2)).toBe("unknown");
  });

  it("does NOT short-circuit at exactly 100 paths (perf guard lower boundary)", () => {
    // 100 allowlisted (.md) changes is at the cap, not over it — must
    // classify normally and return 'cosmetic' since all paths are allowlisted.
    writeFileSync(join(dir, "seed.md"), "x\n");
    const c1 = commit(dir, "c1");
    for (let i = 0; i < 100; i++) writeFileSync(join(dir, `doc${i}.md`), "v\n");
    const c2 = commit(dir, "c2");
    expect(classifyStaleness(dir, c1, c2)).toBe("cosmetic");
  });

  it("classifies non-existent fileCommit as unknown (orphaned by squash)", () => {
    writeFileSync(join(dir, "x.md"), "x\n");
    const c1 = commit(dir, "c1");
    expect(classifyStaleness(dir, "deadbeef", c1)).toBe("unknown");
  });

  it("refuses non-SHA inputs without invoking git (shell-arg guard)", () => {
    writeFileSync(join(dir, "x.md"), "x\n");
    const c1 = commit(dir, "c1");
    // Shell metacharacter in fileCommit — must short-circuit to 'unknown'
    // before constructing the git arg.
    expect(classifyStaleness(dir, "abc;rm -rf /", c1)).toBe("unknown");
    expect(classifyStaleness(dir, "abc & echo pwn", c1)).toBe("unknown");
    expect(classifyStaleness(dir, "", c1)).toBe("unknown");
    expect(classifyStaleness(dir, c1, "abc | whoami")).toBe("unknown");
  });
});
