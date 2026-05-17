import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse as parseToml } from "smol-toml";
import { renderAgentsMd } from "../src/render/agents-md.js";
import { parsedToPass1Result } from "../src/render/parse-anatomy.js";
import { runPass1 } from "../src/pass1/index.js";
import type { Pass1Result } from "../src/types.js";

const PINNED = "2026-05-13T14:00:00.000Z";

beforeEach(() => { process.env.ANATOMY_GENERATED_AT = PINNED; });
afterEach(() => { delete process.env.ANATOMY_GENERATED_AT; });

function minimalAnatomy(): Pass1Result {
  const root = mkdtempSync(join(tmpdir(), "anat-rmd-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({
    name: "my-tiny-lib",
    description: "A tiny utility library.",
    scripts: { build: "tsc", test: "vitest" },
    engines: { node: ">=20" },
  }));
  mkdirSync(join(root, "src"));
  return runPass1(root);
}

describe("renderAgentsMd", () => {
  it("emits the title from identity pillars", () => {
    const r = minimalAnatomy();
    const md = renderAgentsMd(r, {});
    // pillars from runPass1 on a plain package.json: javascript / javascript-library
    // / todo-domain / todo-function. We assert the title's general shape.
    expect(md).toMatch(/^# \S+ \S+ · \S+ · \S+/m);
  });

  it("emits the header banner with commit pin + DO NOT EDIT", () => {
    const r = minimalAnatomy();
    r.commit = "abc123f";
    const md = renderAgentsMd(r, {});
    expect(md).toMatch(/Regenerated from `\.anatomy` at commit `abc123f`/);
    expect(md).toMatch(/DO NOT EDIT/);
  });

  it("emits a staleness hint pointing at the commit", () => {
    const r = minimalAnatomy();
    r.commit = "abc123f";
    const md = renderAgentsMd(r, {});
    expect(md).toMatch(/If your HEAD ≠ `abc123f`, this file may be stale/);
  });

  it("emits the footer with fingerprint + links", () => {
    const r = minimalAnatomy();
    const md = renderAgentsMd(r, {});
    expect(md).toMatch(/Fingerprint: `[a-z0-9]{20}`/);
    expect(md).toContain("[`.anatomy`](.anatomy)");
    expect(md).toContain("[`.anatomy-memory`](.anatomy-memory)");
  });

  it("emits commands as a fenced shell block", () => {
    const r = minimalAnatomy();
    const md = renderAgentsMd(r, {});
    expect(md).toMatch(/## Commands/);
    expect(md).toMatch(/```sh/);
    expect(md).toMatch(/# build\ntsc/);
    expect(md).toMatch(/# test\nvitest/);
  });

  it("emits rules section with *Why:* subline", () => {
    const r = minimalAnatomy();
    r.rules = [{ rule: "Test rule", why: "Test reason", isPlaceholder: false }];
    const md = renderAgentsMd(r, {});
    expect(md).toMatch(/## Rules/);
    expect(md).toMatch(/- Test rule\n {2}\*Why:\* Test reason/);
  });

  it("emits flows section", () => {
    const r = minimalAnatomy();
    r.flows = [{ name: "build-pipeline", summary: "Pass 1 then Pass 2 then render" }];
    const md = renderAgentsMd(r, {});
    expect(md).toMatch(/## Flows/);
    expect(md).toMatch(/- \*\*build-pipeline\*\* — Pass 1 then Pass 2 then render/);
  });

  it("emits decisions section", () => {
    const r = minimalAnatomy();
    r.decisions = [{ topic: "use-tdd", reason: "TDD catches regressions earlier" }];
    const md = renderAgentsMd(r, {});
    expect(md).toMatch(/## Key decisions/);
    expect(md).toMatch(/- \*\*use-tdd\*\* — TDD catches regressions earlier/);
  });

  it("omits empty optional sections", () => {
    // minimalAnatomy has no rules/flows/decisions populated by default.
    const r = minimalAnatomy();
    const md = renderAgentsMd(r, {});
    expect(md).not.toMatch(/## Rules/);
    expect(md).not.toMatch(/## Flows/);
    expect(md).not.toMatch(/## Key decisions/);
  });
});

describe("agents-md fixtures", () => {
  const FIXTURES_DIR = resolve(import.meta.dirname, "..", "..", "fixtures", "agents-md");
  const fixtures = existsSync(FIXTURES_DIR)
    ? readdirSync(FIXTURES_DIR).filter(d => existsSync(join(FIXTURES_DIR, d, "anatomy")))
    : [];

  for (const name of fixtures) {
    it(`renders ${name} matching expected-AGENTS.md`, () => {
      const anatomyRaw = readFileSync(join(FIXTURES_DIR, name, "anatomy"), "utf8");
      const expected = readFileSync(join(FIXTURES_DIR, name, "expected-AGENTS.md"), "utf8");
      const parsed = parseToml(anatomyRaw);
      const pass1 = parsedToPass1Result(parsed);

      // If the fixture has a paired anatomy-memory, copy it into a tmp dir
      // so the renderer's repoRoot lookup finds it.
      let opts: { repoRoot?: string } = {};
      const memSrc = join(FIXTURES_DIR, name, "anatomy-memory");
      let cleanup: string | undefined;
      if (existsSync(memSrc)) {
        const tmp = mkdtempSync(join(tmpdir(), "agents-md-fix-"));
        writeFileSync(join(tmp, ".anatomy-memory"), readFileSync(memSrc, "utf8"));
        opts = { repoRoot: tmp };
        cleanup = tmp;
      }

      try {
        const actual = renderAgentsMd(pass1, opts);
        expect(actual).toBe(expected);
      } finally {
        if (cleanup) {
          // Best-effort cleanup; the OS will purge tmp eventually.
          try { rmSync(cleanup, { recursive: true, force: true }); } catch { /* ignore */ }
        }
      }
    });
  }
});
