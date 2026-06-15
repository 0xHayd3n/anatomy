# `anatomy mcp --with-ast-grep` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in `--with-ast-grep` flag to `anatomy mcp` that lazy-loads `@ast-grep/napi` (already an optionalDependency) and exposes a single read-only `ast_grep_search` tool inside anatomy's MCP server. In-process, no subprocess — architecturally distinct from `--with-fff`.

**Architecture:** A third tool-handler module (`anatomy-cli/src/mcp/ast-grep-tools.ts`) sitting next to the existing `section-tools.ts` and `memory-tools.ts`. Loaded only when `--with-ast-grep` is set. Reuses the existing `loadAstGrep()` helper (extracted from `verify-suggest/test-mining.ts` to a new shared module in Phase 0).

**Tech Stack:** Node 22+, TypeScript, vitest, `@ast-grep/napi@^0.42.0` (already an optionalDependency — no install changes).

**Reference:** [`docs/superpowers/specs/2026-06-15-anatomy-mcp-with-ast-grep-design.md`](../specs/2026-06-15-anatomy-mcp-with-ast-grep-design.md).

---

## File Structure

**New files:**

| Path | Responsibility |
|---|---|
| `anatomy-cli/src/ast-grep-loader.ts` | Shared lazy loader for `@ast-grep/napi`. Returns the module or `null`. One module, two consumers (`verify-suggest/test-mining.ts` and `mcp/ast-grep-tools.ts`). |
| `anatomy-cli/src/mcp/ast-grep-tools.ts` | The `ast_grep_search` tool: language inference, file walk with hardcoded default-excludes, pattern execution via napi, result envelope. Exports `astGrepToolDefinitions` + `astGrepToolHandlers` in the same shape as `section-tools.ts` / `memory-tools.ts`. |
| `anatomy-cli/tests/ast-grep-tools.test.ts` | Real napi against tiny fixture repos. Coverage table in Task 11. |

**Modified files:**

| Path | Change |
|---|---|
| `anatomy-cli/src/verify-suggest/test-mining.ts` | Replace the inline `loadAstGrep` function with `import { loadAstGrep } from "../ast-grep-loader.js"`. Phase 0 refactor; behaviour unchanged. |
| `anatomy-cli/src/commands/mcp.ts` | `McpCommandOptions` gets `withAstGrep?: boolean`. New `if (opts.withAstGrep)` block parallel to the existing `withFff` block: probe napi via `loadAstGrep`, hard-fail if null, merge `astGrepToolDefinitions` into `anatomyDefs`, merge handlers, collision check. |
| `anatomy-cli/src/bin.ts` | Add `--with-ast-grep` to the argv parser. Thread through `case "mcp"`. Update HELP block. |
| `anatomy-cli/src/telemetry.ts` | Add `ast_grep_call` variant to the `TelemetryRecord` union. |
| `anatomy-cli/tests/mcp-integration.test.ts` | One new integration test: `--with-ast-grep` round-trips an `ast_grep_search` call via stdio MCP. The existing tool-count regression (`tools.length).toBe(9)`) continues to pin the no-flag path. |

**Not touched** (deliberately): `section-tools.ts`, `memory-tools.ts`, `brief-tool.ts`, `fff-bridge.ts`, every Pass 1 / Pass 2 / render / validate path.

---

## Verification before each commit

Every task that touches code ends with both of these. The plan calls them out per task; do not skip:

```bash
npm --prefix anatomy-cli run test
npm --prefix anatomy-cli run build
```

`test` catches behavioural regressions; `build` catches TypeScript errors the test runner can mask (uncovered branches, type-only changes).

---

## Task 1: Extract `loadAstGrep` to a shared module

**Files:**
- Create: `anatomy-cli/src/ast-grep-loader.ts`
- Modify: `anatomy-cli/src/verify-suggest/test-mining.ts:28-34`

- [ ] **Step 1: Create the new module**

Create `anatomy-cli/src/ast-grep-loader.ts`:

```ts
// src/ast-grep-loader.ts
// Shared lazy loader for @ast-grep/napi. Used by verify-suggest (rule
// verification) and by --with-ast-grep (live MCP search). The module is an
// optionalDependency — postinstall may have failed on exotic platforms, in
// which case this returns null and callers handle it.

export type AstGrepModule = typeof import("@ast-grep/napi");

export async function loadAstGrep(): Promise<AstGrepModule | null> {
  try {
    return await import("@ast-grep/napi");
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Replace the inline loader in `test-mining.ts`**

In `anatomy-cli/src/verify-suggest/test-mining.ts`, delete lines 28-34 (the existing `loadAstGrep` function) and add an import at the top of the file:

```ts
import { loadAstGrep } from "../ast-grep-loader.js";
```

Place the import next to the other imports near the top of the file (after the existing `import type { VerifyCandidate } from "./types.js"`).

- [ ] **Step 3: Build to confirm the refactor compiles**

Run:
```bash
npm --prefix anatomy-cli run build
```

Expected: clean build, no TS errors.

- [ ] **Step 4: Run the verify-suggest tests to confirm behavior is unchanged**

Run:
```bash
npm --prefix anatomy-cli run test -- verify-suggest
```

Expected: every existing verify-suggest test passes identically.

- [ ] **Step 5: Commit**

```bash
git add anatomy-cli/src/ast-grep-loader.ts anatomy-cli/src/verify-suggest/test-mining.ts
git commit -m "refactor(ast-grep): extract loadAstGrep to shared module"
```

---

## Task 2: Add `ast_grep_call` telemetry variant

**Files:**
- Modify: `anatomy-cli/src/telemetry.ts`
- Test: `anatomy-cli/tests/ast-grep-tools.test.ts` (new)

- [ ] **Step 1: Create the test file with a telemetry-type smoke test**

Create `anatomy-cli/tests/ast-grep-tools.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { recordTelemetry } from "../src/telemetry.js";

describe("ast_grep_call telemetry shape", () => {
  it("accepts an ast_grep_call record", () => {
    expect(() =>
      recordTelemetry({
        kind: "ast_grep_call",
        ts: new Date().toISOString(),
        tool: "ast_grep_search",
        lang: "ts",
        files_scanned: 12,
        matches: 3,
        truncated: false,
        duration_ms: 47,
        outcome: "ok",
      })
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Extend the TelemetryRecord union**

In `anatomy-cli/src/telemetry.ts`, append a new union member after the existing `fff_call` member (which is currently the last one). The closing `;` should be moved off the previous member's closing `}` onto the new one's.

```ts
  | {
      kind: "ast_grep_call";
      ts: string;
      tool: "ast_grep_search";
      lang: string;
      files_scanned: number;
      matches: number;
      truncated: boolean;
      duration_ms: number;
      outcome: "ok" | "missing_pattern" | "missing_lang_or_file_path" | "pattern_parse_failed" | "error";
    };
```

- [ ] **Step 3: Build and run the new test**

Run:
```bash
npm --prefix anatomy-cli run build
npm --prefix anatomy-cli run test -- ast-grep-tools
```

Expected: both succeed.

- [ ] **Step 4: Commit**

```bash
git add anatomy-cli/src/telemetry.ts anatomy-cli/tests/ast-grep-tools.test.ts
git commit -m "feat(telemetry): add ast_grep_call record variant"
```

---

## Task 3: Scaffold `ast-grep-tools.ts` with tool definition

**Files:**
- Create: `anatomy-cli/src/mcp/ast-grep-tools.ts`
- Modify: `anatomy-cli/tests/ast-grep-tools.test.ts`

- [ ] **Step 1: Add a failing test for the tool definition shape**

Append to `anatomy-cli/tests/ast-grep-tools.test.ts`:

```ts
import { astGrepToolDefinitions, astGrepToolHandlers } from "../src/mcp/ast-grep-tools.js";

describe("ast-grep-tools scaffold", () => {
  it("exports a single ast_grep_search tool definition", () => {
    expect(astGrepToolDefinitions).toHaveLength(1);
    expect(astGrepToolDefinitions[0].name).toBe("ast_grep_search");
    expect(typeof astGrepToolDefinitions[0].description).toBe("string");
    const schema = astGrepToolDefinitions[0].inputSchema as {
      type: string;
      required?: string[];
      properties: Record<string, { type: string }>;
    };
    expect(schema.type).toBe("object");
    expect(schema.required).toEqual(["pattern"]);
    expect(Object.keys(schema.properties).sort()).toEqual(
      ["file_path", "lang", "max_results", "pattern"]
    );
  });

  it("exports a handler under the same name", () => {
    expect(astGrepToolHandlers).toHaveProperty("ast_grep_search");
    expect(typeof astGrepToolHandlers.ast_grep_search).toBe("function");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
npm --prefix anatomy-cli run test -- ast-grep-tools
```

Expected: FAIL with `Cannot find module '../src/mcp/ast-grep-tools.js'`.

- [ ] **Step 3: Create the scaffold module**

Create `anatomy-cli/src/mcp/ast-grep-tools.ts`:

```ts
// src/mcp/ast-grep-tools.ts
// In-process MCP tool: ast_grep_search. Loaded when `anatomy mcp` is invoked
// with --with-ast-grep. See docs/superpowers/specs/2026-06-15-anatomy-mcp-with-ast-grep-design.md.

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: unknown;
}

export interface ToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

export const astGrepToolDefinitions: ToolDefinition[] = [
  {
    name: "ast_grep_search",
    description:
      "Structural code search via ast-grep. Find by AST shape, not text. " +
      "Pattern syntax: https://ast-grep.github.io/guide/pattern-syntax.html. " +
      "Pass `pattern` plus EITHER `lang` (explicit) OR `file_path` (glob — lang inferred from extension).",
    inputSchema: {
      type: "object",
      required: ["pattern"],
      properties: {
        pattern: {
          type: "string",
          description:
            "ast-grep pattern (e.g. `spawnSync($X, $$$)`). Metavariables `$X` capture single nodes; `$$$` captures rests.",
        },
        lang: {
          type: "string",
          description:
            "Language id (ts, tsx, js, jsx, py, rs, go, java, c, cpp, rb, php, swift, kotlin, scala, lua, html, css, yaml, json, bash). Optional if file_path is provided.",
        },
        file_path: {
          type: "string",
          description:
            "Glob to scope the search (e.g. `src/**/*.ts`). When provided, `lang` is inferred from the extension. Without it the walk uses the language's default extensions under cwd.",
        },
        max_results: {
          type: "number",
          description: "Cap on returned matches. Default 50. Hard ceiling 500.",
        },
      },
    },
  },
];

export const astGrepToolHandlers: Record<string, ToolHandler> = {
  ast_grep_search: async (_args: Record<string, unknown>): Promise<ToolResult> => {
    // Filled in by subsequent tasks.
    return {
      content: [{ type: "text", text: JSON.stringify({ error: "not_implemented" }) }],
      isError: true,
    };
  },
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
npm --prefix anatomy-cli run test -- ast-grep-tools
npm --prefix anatomy-cli run build
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add anatomy-cli/src/mcp/ast-grep-tools.ts anatomy-cli/tests/ast-grep-tools.test.ts
git commit -m "feat(mcp): scaffold ast_grep_search tool definition"
```

---

## Task 4: Language inference + extension table

**Files:**
- Modify: `anatomy-cli/src/mcp/ast-grep-tools.ts`
- Modify: `anatomy-cli/tests/ast-grep-tools.test.ts`

- [ ] **Step 1: Add failing tests for inferLang + defaultExtensionsFor**

Append to `anatomy-cli/tests/ast-grep-tools.test.ts`:

```ts
import { _internal } from "../src/mcp/ast-grep-tools.js";

describe("inferLang", () => {
  it("returns the lang for a known extension", () => {
    expect(_internal.inferLang("src/foo.ts")).toBe("ts");
    expect(_internal.inferLang("src/foo.tsx")).toBe("tsx");
    expect(_internal.inferLang("src/foo.js")).toBe("js");
    expect(_internal.inferLang("src/foo.mjs")).toBe("js");
    expect(_internal.inferLang("src/foo.cjs")).toBe("js");
    expect(_internal.inferLang("src/foo.jsx")).toBe("jsx");
    expect(_internal.inferLang("src/foo.py")).toBe("py");
    expect(_internal.inferLang("src/foo.rs")).toBe("rs");
    expect(_internal.inferLang("src/foo.go")).toBe("go");
    expect(_internal.inferLang("src/foo.java")).toBe("java");
    expect(_internal.inferLang("src/foo.cpp")).toBe("cpp");
    expect(_internal.inferLang("src/foo.hpp")).toBe("cpp");
  });

  it("returns null for an unknown extension", () => {
    expect(_internal.inferLang("src/foo.xyz")).toBeNull();
    expect(_internal.inferLang("README")).toBeNull();
    expect(_internal.inferLang("")).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(_internal.inferLang(undefined)).toBeNull();
  });

  it("handles globs by extracting the trailing extension", () => {
    expect(_internal.inferLang("src/**/*.ts")).toBe("ts");
    expect(_internal.inferLang("src/**/*.{ts,tsx}")).toBe("ts");
  });
});

describe("defaultExtensionsFor", () => {
  it("returns the canonical extension list for a known lang", () => {
    expect(_internal.defaultExtensionsFor("ts")).toEqual([".ts"]);
    expect(_internal.defaultExtensionsFor("js")).toEqual([".js", ".mjs", ".cjs"]);
    expect(_internal.defaultExtensionsFor("cpp")).toEqual([".cpp", ".cc", ".cxx", ".hpp", ".hh"]);
  });

  it("returns null for an unknown lang", () => {
    expect(_internal.defaultExtensionsFor("erlang")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
npm --prefix anatomy-cli run test -- ast-grep-tools
```

Expected: FAIL with `_internal` undefined / properties missing.

- [ ] **Step 3: Implement the language table + helpers**

Edit `anatomy-cli/src/mcp/ast-grep-tools.ts`. Add the following code BEFORE the existing `export const astGrepToolDefinitions` declaration:

```ts
// Canonical language ↔ extension table. Single source of truth for both
// inferLang (extension → lang) and defaultExtensionsFor (lang → extensions).
// Languages not listed here cannot be inferred; the agent must pass `lang`
// explicitly and provide a `file_path` glob (since we can't build a default
// walk for an unknown lang).
const LANG_TABLE: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["ts", [".ts"]],
  ["tsx", [".tsx"]],
  ["js", [".js", ".mjs", ".cjs"]],
  ["jsx", [".jsx"]],
  ["py", [".py"]],
  ["rs", [".rs"]],
  ["go", [".go"]],
  ["java", [".java"]],
  ["c", [".c", ".h"]],
  ["cpp", [".cpp", ".cc", ".cxx", ".hpp", ".hh"]],
  ["rb", [".rb"]],
  ["php", [".php"]],
  ["swift", [".swift"]],
  ["kotlin", [".kt", ".kts"]],
  ["scala", [".scala"]],
  ["lua", [".lua"]],
  ["html", [".html", ".htm"]],
  ["css", [".css"]],
  ["yaml", [".yml", ".yaml"]],
  ["json", [".json"]],
  ["bash", [".sh", ".bash"]],
];

const EXT_TO_LANG: ReadonlyMap<string, string> = new Map(
  LANG_TABLE.flatMap(([lang, exts]) => exts.map((ext) => [ext, lang] as [string, string])),
);

const LANG_TO_EXTS: ReadonlyMap<string, readonly string[]> = new Map(LANG_TABLE);

function inferLang(filePath: string | undefined): string | null {
  if (!filePath) return null;
  // Handle the `{ts,tsx}` brace form by taking the first comma-split.
  const matchBrace = filePath.match(/\.\{([^}]+)\}$/);
  if (matchBrace) {
    const firstExt = matchBrace[1].split(",")[0]?.trim();
    if (firstExt) return EXT_TO_LANG.get("." + firstExt) ?? null;
  }
  const dot = filePath.lastIndexOf(".");
  if (dot === -1) return null;
  const ext = filePath.slice(dot).toLowerCase();
  return EXT_TO_LANG.get(ext) ?? null;
}

function defaultExtensionsFor(lang: string): readonly string[] | null {
  return LANG_TO_EXTS.get(lang) ?? null;
}

/** Exposed for testing only. Do NOT import from outside this package. */
export const _internal = { inferLang, defaultExtensionsFor, LANG_TABLE };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
npm --prefix anatomy-cli run test -- ast-grep-tools
npm --prefix anatomy-cli run build
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add anatomy-cli/src/mcp/ast-grep-tools.ts anatomy-cli/tests/ast-grep-tools.test.ts
git commit -m "feat(mcp): language↔extension table + inferLang for ast_grep_search"
```

---

## Task 5: File walk with default-exclude list

**Files:**
- Modify: `anatomy-cli/src/mcp/ast-grep-tools.ts`
- Modify: `anatomy-cli/tests/ast-grep-tools.test.ts`

- [ ] **Step 1: Add failing tests for the file walk**

Append to `anatomy-cli/tests/ast-grep-tools.test.ts`:

```ts
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("walkFiles", () => {
  function setupRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), "astgrep-walk-"));
    writeFileSync(join(dir, "a.ts"), "// a");
    writeFileSync(join(dir, "b.ts"), "// b");
    writeFileSync(join(dir, "c.py"), "# c");
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "d.ts"), "// d");
    // Default-excluded directories — must NOT appear in the walk.
    mkdirSync(join(dir, "node_modules"));
    writeFileSync(join(dir, "node_modules", "should-skip.ts"), "// skip");
    mkdirSync(join(dir, "dist"));
    writeFileSync(join(dir, "dist", "also-skip.ts"), "// skip");
    return dir;
  }

  it("walks default extensions for a lang when no glob is given", async () => {
    const dir = setupRepo();
    const found: string[] = [];
    for await (const f of _internal.walkFiles({ cwd: dir, lang: "ts", maxFiles: 100 })) {
      found.push(f);
    }
    // Should include a.ts, b.ts, src/d.ts. NOT node_modules/should-skip.ts or dist/also-skip.ts.
    expect(found.sort()).toEqual(["a.ts", "b.ts", "src/d.ts"].map((p) => p.replace(/\//g, /\\/.test(found[0] ?? "") ? "\\" : "/")));
  });

  it("walks an explicit glob when provided", async () => {
    const dir = setupRepo();
    const found: string[] = [];
    for await (const f of _internal.walkFiles({ cwd: dir, lang: "ts", globPattern: "src/**/*.ts", maxFiles: 100 })) {
      found.push(f);
    }
    expect(found).toEqual(["src/d.ts".replace(/\//g, /\\/.test(found[0] ?? "") ? "\\" : "/")]);
  });

  it("respects the default-exclude list even when an explicit glob would match", async () => {
    const dir = setupRepo();
    const found: string[] = [];
    for await (const f of _internal.walkFiles({ cwd: dir, lang: "ts", globPattern: "**/*.ts", maxFiles: 100 })) {
      found.push(f);
    }
    // Should not include anything under node_modules or dist.
    expect(found.find((f) => f.includes("node_modules"))).toBeUndefined();
    expect(found.find((f) => f.includes("dist"))).toBeUndefined();
  });

  it("caps the walk at maxFiles", async () => {
    const dir = mkdtempSync(join(tmpdir(), "astgrep-cap-"));
    for (let i = 0; i < 10; i++) writeFileSync(join(dir, `f${i}.ts`), "// x");
    const found: string[] = [];
    for await (const f of _internal.walkFiles({ cwd: dir, lang: "ts", maxFiles: 3 })) {
      found.push(f);
    }
    expect(found).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
npm --prefix anatomy-cli run test -- ast-grep-tools
```

Expected: FAIL with `_internal.walkFiles is not a function`.

- [ ] **Step 3: Implement `walkFiles` with the default-exclude list**

Edit `anatomy-cli/src/mcp/ast-grep-tools.ts`. Add an import for the glob function at the top of the file (after the existing imports section, which currently doesn't exist — add it as the first non-comment block):

```ts
import { glob } from "node:fs/promises";
```

Then add the `walkFiles` implementation AFTER the `defaultExtensionsFor` function:

```ts
const DEFAULT_EXCLUDES: readonly string[] = [
  "node_modules",
  "dist",
  "build",
  "out",
  "target",
  ".git",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".cache",
  "coverage",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
  "env",
  ".tox",
  ".pytest_cache",
];

const PATH_SEP_RE = /[\\/]/;

/** Returns true if any path segment is in DEFAULT_EXCLUDES. */
function isExcluded(relPath: string): boolean {
  for (const segment of relPath.split(PATH_SEP_RE)) {
    if (DEFAULT_EXCLUDES.includes(segment)) return true;
  }
  return false;
}

interface WalkOptions {
  cwd: string;
  lang: string;
  globPattern?: string;
  maxFiles: number;
}

/** Yields repo-relative file paths matching the glob (or the lang's default
 *  extensions if no glob is given), skipping any path under DEFAULT_EXCLUDES.
 *  Stops after `maxFiles`. Files are yielded in the order Node's fs.glob
 *  produces them — no extra sorting. */
async function* walkFiles(opts: WalkOptions): AsyncIterable<string> {
  let pattern = opts.globPattern;
  if (!pattern) {
    const exts = defaultExtensionsFor(opts.lang);
    if (!exts || exts.length === 0) return; // unknown lang → empty walk
    // Build a brace expansion of extensions: **/*.{ts,tsx} etc.
    const stripped = exts.map((e) => e.startsWith(".") ? e.slice(1) : e);
    pattern = `**/*.${stripped.length === 1 ? stripped[0] : "{" + stripped.join(",") + "}"}`;
  }
  let count = 0;
  for await (const entry of glob(pattern, { cwd: opts.cwd })) {
    const rel = entry as string;
    if (isExcluded(rel)) continue;
    yield rel;
    count++;
    if (count >= opts.maxFiles) return;
  }
}
```

Then update the `_internal` export at the bottom of the file:

```ts
/** Exposed for testing only. Do NOT import from outside this package. */
export const _internal = { inferLang, defaultExtensionsFor, LANG_TABLE, walkFiles };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
npm --prefix anatomy-cli run test -- ast-grep-tools
npm --prefix anatomy-cli run build
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add anatomy-cli/src/mcp/ast-grep-tools.ts anatomy-cli/tests/ast-grep-tools.test.ts
git commit -m "feat(mcp): file walk with default-exclude list for ast_grep_search"
```

---

## Task 6: Pattern execution against a fixture (real napi)

**Files:**
- Modify: `anatomy-cli/src/mcp/ast-grep-tools.ts`
- Modify: `anatomy-cli/tests/ast-grep-tools.test.ts`

- [ ] **Step 1: Add a failing end-to-end test against a real fixture**

Append to `anatomy-cli/tests/ast-grep-tools.test.ts`:

```ts
import { astGrepToolHandlers as handlers } from "../src/mcp/ast-grep-tools.js";

describe("ast_grep_search — end-to-end", () => {
  function setupTsRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), "astgrep-e2e-"));
    writeFileSync(
      join(dir, "a.ts"),
      "console.log('first');\nconsole.log('second');\nconsole.error('third');\n",
    );
    writeFileSync(join(dir, "b.ts"), "function f() { return 42; }\n");
    return dir;
  }

  it("finds matches with captures and returns the inferred language", async () => {
    const dir = setupTsRepo();
    const oldCwd = process.cwd();
    try {
      process.chdir(dir);
      const r = await handlers.ast_grep_search({
        pattern: "console.log($X)",
        file_path: "*.ts",
      });
      const data = JSON.parse(r.content[0].text);
      expect(r.isError).toBeFalsy();
      expect(data.language).toBe("ts");
      expect(data.matches).toHaveLength(2);
      expect(data.matches[0]).toMatchObject({
        file: expect.stringMatching(/a\.ts$/),
        line: expect.any(Number),
        column: expect.any(Number),
        text: expect.stringContaining("console.log"),
      });
      expect(data.matches[0].captures).toMatchObject({ X: "'first'" });
      expect(data.files_scanned).toBe(2);
      expect(data.truncated).toBe(false);
    } finally {
      process.chdir(oldCwd);
    }
  });

  it("returns empty matches and no error when nothing matches", async () => {
    const dir = setupTsRepo();
    const oldCwd = process.cwd();
    try {
      process.chdir(dir);
      const r = await handlers.ast_grep_search({
        pattern: "unrelated_function_call_that_doesnt_exist($X)",
        file_path: "*.ts",
      });
      const data = JSON.parse(r.content[0].text);
      expect(r.isError).toBeFalsy();
      expect(data.matches).toEqual([]);
      expect(data.files_scanned).toBeGreaterThan(0);
    } finally {
      process.chdir(oldCwd);
    }
  });

  it("respects max_results and sets truncated", async () => {
    const dir = mkdtempSync(join(tmpdir(), "astgrep-trunc-"));
    let body = "";
    for (let i = 0; i < 10; i++) body += `console.log(${i});\n`;
    writeFileSync(join(dir, "many.ts"), body);
    const oldCwd = process.cwd();
    try {
      process.chdir(dir);
      const r = await handlers.ast_grep_search({
        pattern: "console.log($X)",
        file_path: "*.ts",
        max_results: 3,
      });
      const data = JSON.parse(r.content[0].text);
      expect(data.matches).toHaveLength(3);
      expect(data.truncated).toBe(true);
    } finally {
      process.chdir(oldCwd);
    }
  });
});
```

- [ ] **Step 2: Run to verify the tests fail (handler still returns "not_implemented")**

Run:
```bash
npm --prefix anatomy-cli run test -- ast-grep-tools
```

Expected: FAIL with assertion errors about the response shape.

- [ ] **Step 3: Implement the handler**

Edit `anatomy-cli/src/mcp/ast-grep-tools.ts`. Add an import at the top (after the `glob` import):

```ts
import { readFile } from "node:fs/promises";
import { loadAstGrep, type AstGrepModule } from "../ast-grep-loader.js";
```

Replace the placeholder `ast_grep_search` handler with the real implementation. The whole handlers export should now be:

```ts
const MAX_RESULTS_DEFAULT = 50;
const MAX_RESULTS_CEILING = 500;
const MAX_TEXT_LEN = 500;

interface SearchInput {
  pattern: string;
  lang?: string;
  file_path?: string;
  max_results?: number;
}

interface Match {
  file: string;
  line: number;
  column: number;
  text: string;
  captures: Record<string, string>;
}

interface SearchResult {
  matches: Match[];
  files_scanned: number;
  truncated: boolean;
  language: string;
}

function errorEnvelope(error: string, extra: Record<string, unknown> = {}): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ error, ...extra }) }],
    isError: true,
  };
}

function okEnvelope(data: SearchResult): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
    isError: false,
  };
}

function truncateText(s: string): string {
  return s.length > MAX_TEXT_LEN ? s.slice(0, MAX_TEXT_LEN) + "…" : s;
}

/** Pull the language-keyed parser off the napi module. The shape is
 *  loose because napi exposes one property per language (e.g., sg.ts,
 *  sg.python). Returns null when the language isn't supported by this
 *  napi build. */
function getLangParser(sg: AstGrepModule, lang: string): { parse: (s: string) => { root(): { findAll: (rule: { rule: { pattern: string } }) => unknown[] } } } | null {
  const sgModule = sg as unknown as Record<string, unknown>;
  // ast-grep uses "python" as the property name even though the lang id is "py".
  const propName = lang === "py" ? "python" : lang;
  const parser = sgModule[propName];
  if (!parser || typeof parser !== "object") return null;
  const obj = parser as { parse?: unknown };
  if (typeof obj.parse !== "function") return null;
  return parser as ReturnType<typeof getLangParser>;
}

async function runSearch(input: SearchInput): Promise<ToolResult> {
  if (typeof input.pattern !== "string" || input.pattern.length === 0) {
    return errorEnvelope("missing_pattern");
  }
  let lang = input.lang;
  if (!lang) {
    lang = inferLang(input.file_path) ?? undefined;
    if (!lang) {
      return errorEnvelope("missing_lang_or_file_path", {
        hint: "Pass `lang` explicitly (ts/py/rs/...) or a `file_path` glob whose extension is known.",
        supported_langs: LANG_TABLE.map(([l]) => l),
      });
    }
  }

  const sg = await loadAstGrep();
  if (!sg) {
    return errorEnvelope("ast_grep_unavailable", {
      hint: "Reinstall with `npm install --save-optional @ast-grep/napi` or omit --with-ast-grep.",
    });
  }

  const parser = getLangParser(sg, lang);
  if (!parser) {
    return errorEnvelope("unsupported_lang", { lang });
  }

  const maxResults = Math.min(
    Math.max(1, Math.floor(input.max_results ?? MAX_RESULTS_DEFAULT)),
    MAX_RESULTS_CEILING,
  );
  const maxFiles = Number(process.env.ANATOMY_AST_GREP_MAX_FILES ?? "5000") || 5000;

  const t0 = Date.now();
  const matches: Match[] = [];
  let files_scanned = 0;
  let truncated = false;

  for await (const rel of walkFiles({
    cwd: process.cwd(),
    lang,
    globPattern: input.file_path,
    maxFiles,
  })) {
    let source: string;
    try {
      source = await readFile(`${process.cwd()}/${rel}`, "utf8");
    } catch {
      continue; // unreadable file → skip silently, do NOT count in files_scanned
    }
    files_scanned++;
    let found: Array<{ text(): string; range(): { start: { line: number; column: number } }; getMatch(name: string): { text(): string } | null }>;
    try {
      const parsed = parser.parse(source);
      found = parsed.root().findAll({ rule: { pattern: input.pattern } }) as typeof found;
    } catch (e) {
      return errorEnvelope("pattern_parse_failed", {
        language: lang,
        detail: e instanceof Error ? e.message : String(e),
      });
    }
    for (const node of found) {
      const range = node.range();
      const captureNames = (input.pattern.match(/\$[A-Z][A-Z0-9_]*/g) ?? []).map((s) => s.slice(1));
      const captures: Record<string, string> = {};
      for (const name of captureNames) {
        const cap = node.getMatch(name);
        if (cap) captures[name] = truncateText(cap.text());
      }
      matches.push({
        file: rel,
        line: range.start.line + 1,
        column: range.start.column + 1,
        text: truncateText(node.text()),
        captures,
      });
      if (matches.length >= maxResults) {
        truncated = true;
        break;
      }
    }
    if (truncated) break;
  }

  void t0; // duration_ms is recorded by the caller in mcp.ts; this handler stays pure-functional.

  return okEnvelope({ matches, files_scanned, truncated, language: lang });
}

export const astGrepToolHandlers: Record<string, ToolHandler> = {
  ast_grep_search: (args) => runSearch(args as unknown as SearchInput),
};
```

Also delete the old placeholder `astGrepToolHandlers` export from earlier in the file.

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
npm --prefix anatomy-cli run test -- ast-grep-tools
npm --prefix anatomy-cli run build
```

Expected: every existing test still passes; the three new e2e tests pass.

- [ ] **Step 5: Commit**

```bash
git add anatomy-cli/src/mcp/ast-grep-tools.ts anatomy-cli/tests/ast-grep-tools.test.ts
git commit -m "feat(mcp): ast_grep_search runs real napi patterns with captures"
```

---

## Task 7: Error paths — missing pattern, missing lang/file_path, pattern parse failure

**Files:**
- Modify: `anatomy-cli/tests/ast-grep-tools.test.ts`

- [ ] **Step 1: Add failing tests for the documented error paths**

Append to `anatomy-cli/tests/ast-grep-tools.test.ts`:

```ts
describe("ast_grep_search — error paths", () => {
  it("returns missing_pattern when pattern is missing", async () => {
    const r = await handlers.ast_grep_search({});
    expect(r.isError).toBe(true);
    const data = JSON.parse(r.content[0].text);
    expect(data.error).toBe("missing_pattern");
  });

  it("returns missing_pattern when pattern is an empty string", async () => {
    const r = await handlers.ast_grep_search({ pattern: "" });
    expect(r.isError).toBe(true);
    const data = JSON.parse(r.content[0].text);
    expect(data.error).toBe("missing_pattern");
  });

  it("returns missing_lang_or_file_path when neither is set", async () => {
    const r = await handlers.ast_grep_search({ pattern: "$X" });
    expect(r.isError).toBe(true);
    const data = JSON.parse(r.content[0].text);
    expect(data.error).toBe("missing_lang_or_file_path");
    expect(data.supported_langs).toEqual(expect.arrayContaining(["ts", "py", "rs"]));
  });

  it("returns missing_lang_or_file_path when file_path has unknown extension", async () => {
    const r = await handlers.ast_grep_search({
      pattern: "$X",
      file_path: "src/**/*.xyz",
    });
    expect(r.isError).toBe(true);
    const data = JSON.parse(r.content[0].text);
    expect(data.error).toBe("missing_lang_or_file_path");
  });

  it("returns pattern_parse_failed for an unparseable pattern", async () => {
    const dir = mkdtempSync(join(tmpdir(), "astgrep-bad-"));
    writeFileSync(join(dir, "a.ts"), "const x = 1;\n");
    const oldCwd = process.cwd();
    try {
      process.chdir(dir);
      // Deliberately malformed: stray unbalanced quote inside a pattern.
      const r = await handlers.ast_grep_search({
        pattern: "console.log('unterminated",
        file_path: "*.ts",
      });
      const data = JSON.parse(r.content[0].text);
      expect(r.isError).toBe(true);
      expect(data.error).toBe("pattern_parse_failed");
      expect(data.language).toBe("ts");
      expect(typeof data.detail).toBe("string");
    } finally {
      process.chdir(oldCwd);
    }
  });
});
```

- [ ] **Step 2: Run the tests**

Run:
```bash
npm --prefix anatomy-cli run test -- ast-grep-tools
```

Expected: every test passes (the handler from Task 6 already implements all these error paths). If any fails, fix the handler in `ast-grep-tools.ts` to match the documented contract.

- [ ] **Step 3: Build**

Run:
```bash
npm --prefix anatomy-cli run build
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add anatomy-cli/tests/ast-grep-tools.test.ts
git commit -m "test(mcp): cover ast_grep_search error paths"
```

---

## Task 8: Wire `--with-ast-grep` into `mcpCommand`

**Files:**
- Modify: `anatomy-cli/src/commands/mcp.ts`
- Modify: `anatomy-cli/src/bin.ts`
- Modify: `anatomy-cli/tests/mcp-integration.test.ts`

- [ ] **Step 1: Add a failing integration test for the hard-fail-on-missing-napi path**

This test simulates "napi is missing" by setting an env var that forces the loader to skip the real import. Implement that env-var honoring in the loader first, in the same task.

First, modify `anatomy-cli/src/ast-grep-loader.ts`:

```ts
// src/ast-grep-loader.ts
// Shared lazy loader for @ast-grep/napi. Used by verify-suggest (rule
// verification) and by --with-ast-grep (live MCP search). The module is an
// optionalDependency — postinstall may have failed on exotic platforms, in
// which case this returns null and callers handle it.
//
// ANATOMY_AST_GREP_DISABLE=1 forces a null return — used by tests to simulate
// the missing-napi case on a system where it's actually installed.

export type AstGrepModule = typeof import("@ast-grep/napi");

export async function loadAstGrep(): Promise<AstGrepModule | null> {
  const disable = process.env.ANATOMY_AST_GREP_DISABLE;
  if (disable && disable !== "0" && disable.toLowerCase() !== "false") {
    return null;
  }
  try {
    return await import("@ast-grep/napi");
  } catch {
    return null;
  }
}
```

Then append to `anatomy-cli/tests/mcp-integration.test.ts`:

```ts
describe("anatomy mcp --with-ast-grep", () => {
  it("hard-fails with actionable error when @ast-grep/napi is unavailable", () => {
    const repoDir = mkdtempSync(join(tmpdir(), "anat-mcp-ast-"));
    execSync("git init", { cwd: repoDir, stdio: "ignore", shell: true });
    writeFileSync(join(repoDir, ".anatomy"), ANATOMY);

    let stderr = "";
    let exitCode = 0;
    try {
      execSync(`node "${BIN}" mcp --with-ast-grep`, {
        cwd: repoDir,
        env: {
          ...process.env,
          ANATOMY_AST_GREP_DISABLE: "1",
          ANATOMY_TELEMETRY_DISABLE: "1",
        },
        stdio: ["pipe", "pipe", "pipe"],
        shell: true,
      });
    } catch (e) {
      const err = e as { status?: number; stderr?: Buffer };
      exitCode = err.status ?? 0;
      stderr = err.stderr?.toString() ?? "";
    }
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/@ast-grep\/napi not available/i);
  });

  it("merges ast_grep_search into the tools list when enabled", async () => {
    const repoDir = mkdtempSync(join(tmpdir(), "anat-mcp-ast-on-"));
    execSync("git init", { cwd: repoDir, stdio: "ignore", shell: true });
    writeFileSync(join(repoDir, ".anatomy"), ANATOMY);

    const [resp] = await spawnAndCall(repoDir, [
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
    ]);
    // 9 anatomy-native tools — this call goes through the existing spawnAndCall
    // helper which does NOT pass --with-ast-grep. The 10-tool case is exercised
    // below by spawnAstGrep().
    expect((resp as { result: { tools: unknown[] } }).result.tools.length).toBe(9);

    const [respWith] = await spawnAstGrep(repoDir, [
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
    ]);
    const tools = (respWith as { result: { tools: Array<{ name: string }> } }).result.tools.map(
      (t) => t.name,
    );
    expect(tools).toContain("ast_grep_search");
    expect(tools).toHaveLength(10);
  });
});

async function spawnAstGrep(repoDir: string, requests: JsonRpcRequest[]): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", [BIN, "mcp", "--with-ast-grep"], {
      cwd: repoDir,
      stdio: ["pipe", "pipe", "pipe"],
      shell: true,
      env: { ...process.env, ANATOMY_TELEMETRY_DISABLE: "1" },
    });
    let buffer = "";
    const responses: unknown[] = [];
    proc.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) {
          try { responses.push(JSON.parse(line)); } catch {}
        }
        if (responses.length === requests.length) proc.stdin.end();
      }
    });
    proc.on("close", () => resolve(responses));
    proc.on("error", reject);
    setTimeout(() => { proc.kill(); reject(new Error("timeout")); }, 10_000);
    for (const req of requests) proc.stdin.write(JSON.stringify(req) + "\n");
  });
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
npm --prefix anatomy-cli run build
npm --prefix anatomy-cli run test -- mcp-integration
```

Expected: FAIL because `--with-ast-grep` is treated as an unknown flag by the parser, so exit code is 1 with `unknown flag` rather than `@ast-grep/napi not available`.

- [ ] **Step 3: Wire the flag in `bin.ts`**

In `anatomy-cli/src/bin.ts`, add a new parseArgs case next to the existing `--with-fff` line (search for `if (a === "--with-fff")` to find the location):

```ts
    if (a === "--with-ast-grep") { flags.withAstGrep = true; i++; continue; }
```

Update the `mcp` case in the dispatch switch (search for `case "mcp":`):

```ts
    case "mcp":
      return mcpCommand({
        withFff: !!flags.withFff,
        withAstGrep: !!flags.withAstGrep,
      });
```

Update the HELP block — replace the existing `mcp [--with-fff]` entry with:

```
  mcp [--with-fff] [--with-ast-grep]        Start an MCP stdio server exposing anatomy's tools.
                                            --with-fff: also proxy fff's tools (ffgrep, fffind) via
                                            a child fff-mcp subprocess. Hard-fails if no fff
                                            binary is on PATH. See ANATOMY_FFF_* env vars.
                                            --with-ast-grep: also expose ast_grep_search for
                                            structural code search via @ast-grep/napi (in-process).
                                            Hard-fails if the optional dep failed to install.
                                            ANATOMY_AST_GREP_MAX_FILES (default 5000) caps the
                                            file walk per call.
```

- [ ] **Step 4: Wire the flag in `mcp.ts`**

In `anatomy-cli/src/commands/mcp.ts`, update the `McpCommandOptions` interface:

```ts
export interface McpCommandOptions {
  withFff?: boolean;
  withAstGrep?: boolean;
}
```

After the existing `if (opts.withFff)` block (which ends around line 128 today; if line numbers have drifted use the closing `}` that matches `if (opts.withFff)`), add the parallel `if (opts.withAstGrep)` block:

```ts
  if (opts.withAstGrep) {
    const { loadAstGrep } = await import("../ast-grep-loader.js");
    const napi = await loadAstGrep();
    if (!napi) {
      process.stderr.write(
        "error: @ast-grep/napi not available; reinstall with " +
        "'npm install --save-optional @ast-grep/napi' or omit --with-ast-grep\n",
      );
      return 1;
    }
    if (!recordTelemetry) {
      ({ recordTelemetry } = await import("../telemetry.js"));
    }
    const { astGrepToolDefinitions, astGrepToolHandlers } = await import("../mcp/ast-grep-tools.js");
    // Collision check against the names already in the dispatch map.
    for (const def of astGrepToolDefinitions) {
      if (def.name in anatomyHandlers) {
        process.stderr.write(`error: ast-grep tool name collision: ${def.name}\n`);
        return 1;
      }
      if (fffDefs.some((d) => d.name === def.name)) {
        process.stderr.write(`error: ast-grep tool name collision with fff bridge: ${def.name}\n`);
        return 1;
      }
    }
    anatomyDefs.push(...astGrepToolDefinitions);
    Object.assign(anatomyHandlers, astGrepToolHandlers);
  }
```

Then wrap each `anatomyHandlers[name]` call so it records telemetry when the call resolves to an ast_grep tool. The simplest seam: leave the dispatch loop unchanged for *anatomy-native* tools, but route `ast_grep_search` through a wrapped handler that records telemetry. Replace the existing local dispatch path with this version:

```ts
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const handler = (
      anatomyHandlers as Record<string, (a: Record<string, unknown>) => Promise<unknown>>
    )[name];
    if (handler) {
      // ast-grep handlers get a telemetry wrapper; built-in section/memory
      // handlers already self-instrument inside section-tools.ts.
      if (opts.withAstGrep && name === "ast_grep_search" && recordTelemetry) {
        const t0 = Date.now();
        const result = await handler(args ?? {}) as { content: Array<{ text: string }>; isError?: boolean };
        const text = result.content[0]?.text ?? "{}";
        let parsed: { matches?: unknown[]; truncated?: boolean; language?: string; error?: string };
        try { parsed = JSON.parse(text); } catch { parsed = {}; }
        const outcome: "ok" | "missing_pattern" | "missing_lang_or_file_path" | "pattern_parse_failed" | "error" =
          !result.isError ? "ok"
          : parsed.error === "missing_pattern" ? "missing_pattern"
          : parsed.error === "missing_lang_or_file_path" ? "missing_lang_or_file_path"
          : parsed.error === "pattern_parse_failed" ? "pattern_parse_failed"
          : "error";
        recordTelemetry({
          kind: "ast_grep_call",
          ts: new Date().toISOString(),
          tool: "ast_grep_search",
          lang: typeof parsed.language === "string" ? parsed.language : "",
          files_scanned: 0, // populated below if present
          matches: Array.isArray(parsed.matches) ? parsed.matches.length : 0,
          truncated: !!parsed.truncated,
          duration_ms: Date.now() - t0,
          outcome,
        });
        return result;
      }
      const result = await handler(args ?? {});
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        isError: typeof result === "object" && result !== null && "error" in result,
      };
    }
    // fff branch unchanged below this point.
    if (fffBridge && fffDefs.some((d) => d.name === name)) {
      // ... existing fff dispatch code, unchanged
```

Important: the ast_grep handler already returns an MCP-shaped envelope (`{ content, isError }`), unlike `section-tools` handlers which return a domain object that gets wrapped by the dispatch loop. The wrapped branch must return `result` directly without re-stringifying. The non-ast-grep branch keeps its existing wrapping.

Also: read `files_scanned` from the parsed result properly. Update the telemetry block:

```ts
        const filesScanned = typeof (parsed as { files_scanned?: unknown }).files_scanned === "number"
          ? (parsed as { files_scanned: number }).files_scanned
          : 0;
        recordTelemetry({
          kind: "ast_grep_call",
          ts: new Date().toISOString(),
          tool: "ast_grep_search",
          lang: typeof parsed.language === "string" ? parsed.language : "",
          files_scanned: filesScanned,
          matches: Array.isArray(parsed.matches) ? parsed.matches.length : 0,
          truncated: !!parsed.truncated,
          duration_ms: Date.now() - t0,
          outcome,
        });
```

- [ ] **Step 5: Run the integration tests**

Run:
```bash
npm --prefix anatomy-cli run build
npm --prefix anatomy-cli run test -- mcp-integration
```

Expected: every existing test passes, plus the two new tests:
- `hard-fails with actionable error when @ast-grep/napi is unavailable` passes
- `merges ast_grep_search into the tools list when enabled` passes
- The regression `tools.length).toBe(9)` for no-flag path still passes

- [ ] **Step 6: Run the full anatomy-cli suite**

Run:
```bash
npm --prefix anatomy-cli run test
```

Expected: all green (with the same known-flaky brief-tool tests behaving the same as before).

- [ ] **Step 7: Commit**

```bash
git add anatomy-cli/src/commands/mcp.ts anatomy-cli/src/bin.ts anatomy-cli/src/ast-grep-loader.ts anatomy-cli/tests/mcp-integration.test.ts
git commit -m "feat(mcp): --with-ast-grep flag exposes ast_grep_search in-process"
```

---

## Task 9: End-to-end stdio round-trip test

**Files:**
- Modify: `anatomy-cli/tests/mcp-integration.test.ts`

- [ ] **Step 1: Add the failing round-trip test**

Append to the `describe("anatomy mcp --with-ast-grep", ...)` block in `anatomy-cli/tests/mcp-integration.test.ts`:

```ts
  it("ast_grep_search round-trips through MCP and returns matches", async () => {
    const repoDir = mkdtempSync(join(tmpdir(), "anat-mcp-ast-roundtrip-"));
    execSync("git init", { cwd: repoDir, stdio: "ignore", shell: true });
    writeFileSync(join(repoDir, ".anatomy"), ANATOMY);
    writeFileSync(
      join(repoDir, "a.ts"),
      "console.log('alpha');\nconsole.log('beta');\nconsole.error('gamma');\n",
    );

    const [resp] = await spawnAstGrep(repoDir, [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "ast_grep_search",
          arguments: { pattern: "console.log($X)", file_path: "*.ts" },
        },
      },
    ]);
    const text = (resp as { result: { content: Array<{ text: string }> } }).result.content[0].text;
    const data = JSON.parse(text);
    expect(data.matches).toHaveLength(2);
    expect(data.language).toBe("ts");
    expect(data.matches[0].captures.X).toBe("'alpha'");
  });
```

- [ ] **Step 2: Run the test**

Run:
```bash
npm --prefix anatomy-cli run build
npm --prefix anatomy-cli run test -- mcp-integration
```

Expected: every test passes including the new round-trip.

- [ ] **Step 3: Commit**

```bash
git add anatomy-cli/tests/mcp-integration.test.ts
git commit -m "test(mcp): end-to-end stdio round-trip for ast_grep_search"
```

---

## Task 10: Document `--with-ast-grep` in `anatomy-cli/README.md`

**Files:**
- Modify: `anatomy-cli/README.md`

- [ ] **Step 1: Locate the `--with-fff` section**

Run:
```bash
grep -n "anatomy mcp --with-fff" anatomy-cli/README.md | head -3
```

Identify the section heading and the closing line of the `--with-fff` block.

- [ ] **Step 2: Append a sibling `--with-ast-grep` subsection immediately after the `--with-fff` block**

Place the following at the natural insertion point (right after the closing line of the `--with-fff` section):

```markdown
- **`anatomy mcp --with-ast-grep`** — opt-in flag that exposes
  `ast_grep_search` inside anatomy's MCP namespace via the existing
  `@ast-grep/napi` optional dependency. Unlike `--with-fff`, this is **not a
  bridge** — there's no subprocess, no IPC. The napi module loads in the
  same Node process as anatomy's MCP server.

  - **What it adds.** A single read-only `ast_grep_search` tool that takes
    a `pattern` (ast-grep pattern syntax) plus either an explicit `lang` or
    a `file_path` glob (lang inferred from extension). Returns matches with
    `{ file, line, column, text, captures }`. Find by AST shape — *"every
    `CallExpression` whose callee is `spawnSync`"* — instead of by text.
  - **Hard fail on missing napi.** If `@ast-grep/napi` failed to install
    (the optionalDep can fail on exotic platforms), `anatomy mcp
    --with-ast-grep` exits 1 with an actionable error.
  - **Default-exclude list.** The walk skips `node_modules`, `dist`,
    `build`, `target`, `.git`, and similar non-source dirs by default —
    without this, the tool would be unusable on any real repo. Pass an
    explicit `file_path` to scope further.

  | Env | Purpose | Default |
  |---|---|---|
  | `ANATOMY_AST_GREP_MAX_FILES` | Cap on files the walk reads per call. | `5000` |

  Composes with `--with-fff`: `anatomy mcp --with-fff --with-ast-grep`
  exposes both. Without the flag, the napi probe never runs and anatomy
  mcp behaves byte-identically to v1.1.0.
```

- [ ] **Step 3: Commit**

```bash
git add anatomy-cli/README.md
git commit -m "docs(cli): document anatomy mcp --with-ast-grep"
```

---

## Task 11: Document `--with-ast-grep` in the root `README.md`

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Locate the existing `--with-fff` section in the root README**

Run:
```bash
grep -n "Pairing with fff" README.md
```

That section is the right insertion point. The new `--with-ast-grep` section goes immediately after the closing line of the "Pairing with fff" block.

- [ ] **Step 2: Add the `anatomy mcp --with-ast-grep` line to the Quick start block**

In `README.md`, find the block:

```bash
anatomy mcp --with-fff    # additionally proxy fff's fast file-search tools (see below)
```

and add a sibling line directly after:

```bash
anatomy mcp --with-ast-grep   # additionally expose ast_grep_search (structural code search)
```

(Or, if you want to be cleaner, combine: `anatomy mcp --with-fff --with-ast-grep`.)

- [ ] **Step 3: Append the new section**

After the closing `</...>` of the existing "Pairing with fff for fast in-session search" section, insert this new section:

```markdown
### Pairing with ast-grep for structural code search

`anatomy mcp --with-ast-grep` adds a single read-only `ast_grep_search` tool
to anatomy's MCP namespace, backed by the `@ast-grep/napi` optional
dependency (already declared in `anatomy-cli`'s `package.json`). Unlike
`--with-fff`, there is **no subprocess and no bridge** — the napi module
loads in the same Node process as anatomy's MCP server. The tool answers
the verb that fff and ripgrep cannot: *find by AST shape*, not text.

```bash
anatomy mcp --with-ast-grep
# composes with --with-fff:
anatomy mcp --with-fff --with-ast-grep
```

| Env | Purpose | Default |
|---|---|---|
| `ANATOMY_AST_GREP_MAX_FILES` | Cap on files the walk reads per call. | `5000` |

The default-exclude list (`node_modules`, `dist`, `build`, `target`,
`.git`, and similar non-source dirs) is hardcoded — without it the tool
would be unusable on any real repo. Pass an explicit `file_path` glob to
scope a search further. Without `--with-ast-grep`, the behaviour of
`anatomy mcp` is byte-identical to v1.1.0 — no napi probe runs.

**Why pair it?** anatomy answers *"what should I know about this repo?"*
(curated rules, decisions, lived memory). fff answers *"where is X
textually?"*. ast-grep answers *"where is X **structurally**?"* — the
agent can search for *"every `CallExpression` whose callee is `spawnSync`
and whose options object lacks `shell: true`"*, a query the other two
cannot.

**Failure semantics.** If `@ast-grep/napi` failed to install (the
optionalDep can fail on exotic platforms), `anatomy mcp --with-ast-grep`
hard-fails at startup with an actionable error. There's no subprocess
crash recovery to worry about — the tool either loaded or it didn't.
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document anatomy mcp --with-ast-grep in root README"
```

---

## Task 12: Bump CLI version + CHANGELOG

**Files:**
- Modify: `anatomy-cli/package.json`
- Modify: `anatomy-cli/package-lock.json`
- Modify: `anatomy-cli/CHANGELOG.md`

- [ ] **Step 1: Bump the version in `package.json`**

Edit `anatomy-cli/package.json`:

```json
"version": "1.2.0",
```

(was `1.1.0`). Also update the `description` field to mention the new flag — find the current description and replace `9 tools across section + memory access; --with-fff opt-in flag proxies the fff-mcp file-search server's tools into the same MCP namespace` with `9 tools across section + memory access; --with-fff opt-in flag proxies fff-mcp's tools, --with-ast-grep opt-in flag exposes structural code search via @ast-grep/napi in-process`.

- [ ] **Step 2: Regenerate the lockfile**

Run:
```bash
npm --prefix anatomy-cli install --package-lock-only --no-audit --no-fund
```

Expected: lockfile updated to `1.2.0`.

- [ ] **Step 3: Add the 1.2.0 entry to the CHANGELOG**

Edit `anatomy-cli/CHANGELOG.md`. Insert the following block ABOVE the existing `## [1.1.0]` entry:

```markdown
## [1.2.0] — 2026-06-15

### Added

- **`anatomy mcp --with-ast-grep`: in-process structural-search extension.**
  Second optional MCP extension on `anatomy mcp`, sibling to `--with-fff`
  but architecturally distinct. Lazy-loads the existing `@ast-grep/napi`
  optional dependency and exposes a single read-only `ast_grep_search`
  tool inside anatomy's own MCP server — no subprocess, no IPC. The agent
  can now find by AST shape (e.g. *"every `CallExpression` whose callee
  is `spawnSync`"*), a verb that text-grep and fff structurally cannot
  answer.
  - **Tool surface.** Single `ast_grep_search` with inputs `pattern`
    (required, ast-grep syntax), `lang` (optional — inferred from
    `file_path` extension when absent), `file_path` (optional glob),
    `max_results` (default 50, hard ceiling 500). Returns
    `{ matches, files_scanned, truncated, language }`. Each match has
    `{ file, line, column, text, captures }`. Captures are populated
    from `$X`-style metavariables in the pattern.
  - **Composes with `--with-fff`.** Both flags can be set together:
    `anatomy mcp --with-fff --with-ast-grep` exposes the full union
    (12 tools: 9 anatomy-native + 2 fff + 1 ast-grep).
  - **Hard fail at startup** if `@ast-grep/napi` is unavailable (the
    optional dependency can fail to install on exotic platforms).
    Without the flag, no napi probe runs and behaviour is byte-identical
    to v1.1.0.
  - **Default-exclude list** for the file walk (hardcoded):
    `node_modules`, `dist`, `build`, `out`, `target`, `.git`, `.next`,
    `.nuxt`, `.svelte-kit`, `.turbo`, `.cache`, `coverage`, `vendor`,
    `__pycache__`, `.venv`, `venv`, `env`, `.tox`, `.pytest_cache`.
    `ANATOMY_AST_GREP_MAX_FILES` (default `5000`) caps the walk's file
    count per call.
  - **Telemetry.** New `ast_grep_call` variant on the existing
    `~/.anatomy/telemetry.jsonl` stream. No lifecycle events (there's
    no subprocess to enter `degraded`).

### Refactor

- **`loadAstGrep` extracted** from `verify-suggest/test-mining.ts` to a
  new shared `anatomy-cli/src/ast-grep-loader.ts` so both verify-suggest
  and the new ast-grep tool share one napi probe. Behaviour-preserving;
  no test changes required.

### Notes

- No new runtime dependencies. `@ast-grep/napi` was already an
  `optionalDependency` for the `kind = "ast_pattern"` rule-verify clause.
  This release adds a second consumer of that dependency without
  changing the install footprint.
```

- [ ] **Step 4: Build and test**

Run:
```bash
npm --prefix anatomy-cli run build
npm --prefix anatomy-cli run test
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add anatomy-cli/package.json anatomy-cli/package-lock.json anatomy-cli/CHANGELOG.md
git commit -m "chore(release): @anatomytool/cli 1.2.0"
```

---

## Task 13: Final regression + sanity check

**Files:** None changed (verification only).

- [ ] **Step 1: Run the full anatomy-cli test suite**

Run:
```bash
npm --prefix anatomy-cli run test
npm --prefix anatomy-cli run build
```

Expected: every test green, build clean.

- [ ] **Step 2: Run the repo-root validate gate**

Run:
```bash
npm run validate
```

Expected: PASS. This is the content-integrity gate CI enforces.

- [ ] **Step 3: Sanity check — `anatomy mcp` with no flag still has 9 tools**

```bash
npm --prefix anatomy-cli run build
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node anatomy-cli/dist/bin.js mcp 2>/dev/null | head -1 | node -e "let c=''; process.stdin.on('data',d=>c+=d).on('end',()=>{const j=JSON.parse(c); console.log('tool_count=', j.result.tools.length)})"
```

Expected: `tool_count= 9`.

- [ ] **Step 4: Sanity check — `anatomy mcp --with-ast-grep` exposes 10 tools**

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node anatomy-cli/dist/bin.js mcp --with-ast-grep 2>/dev/null | head -1 | node -e "let c=''; process.stdin.on('data',d=>c+=d).on('end',()=>{const j=JSON.parse(c); console.log('tool_count=', j.result.tools.length); console.log('names=', j.result.tools.map(t=>t.name).join(','))})"
```

Expected: `tool_count= 10`, `names=` includes `ast_grep_search`.

- [ ] **Step 5: Sanity check — `anatomy mcp --with-ast-grep` hard-fails when napi is disabled**

```bash
ANATOMY_AST_GREP_DISABLE=1 node anatomy-cli/dist/bin.js mcp --with-ast-grep
echo "exit=$?"
```

Expected: stderr contains `@ast-grep/napi not available`, exit code 1.

- [ ] **Step 6: No commit required — verification only.**

---

## Self-review checklist (planner: confirm before handing off)

- [x] **Spec coverage:**
  - Goal 1 (single read-only tool) → Tasks 3, 6, 7
  - Goal 2 (zero install footprint) → Phase 0 / Task 1 keeps the napi import lazy and shared
  - Goal 3 (composes with --with-fff) → Task 8's flag plumbing + collision check
  - Goal 4 (byte-identical no-flag path) → Tests in Task 8 step 5 pin the tool count
  - Goal 5 (hard-fail visibly on missing napi) → Task 8's integration test
  - Decision 1 (in-process via napi) → Task 8's mcp.ts wiring uses `await import` then in-process handler
  - Decision 2 (single tool) → Task 3
  - Decision 3 (--with-ast-grep flag) → Task 8 bin.ts wiring
  - Decision 4 (hard fail) → Task 8 integration test
  - Decision 5 (hybrid lang) → Task 4 inferLang + Task 7 missing_lang_or_file_path
  - Decision 6 (no bridge generalization) → Architecture in plan header: third tool-handler module, not a bridge
  - Architecture / Components / Data flow / Error handling / Configuration / Testing / Telemetry → all reflected in tasks
  - Non-goals (rewrite, scan, cross-link, polyglot) → not implemented (correct per spec)
- [x] **Placeholder scan:** No "TBD"/"TODO"/"add error handling" — every step shows the actual code.
- [x] **Type consistency:** `astGrepToolDefinitions`/`astGrepToolHandlers`/`SearchInput`/`SearchResult`/`Match`/`ToolResult`/`ToolHandler`/`_internal`/`inferLang`/`defaultExtensionsFor`/`walkFiles`/`runSearch`/`getLangParser` — names stable across Tasks 3-7. Telemetry record matches Task 2 type exactly. The `McpCommandOptions` shape in Task 8 matches the existing mcp.ts shape.
- [x] **The hardcoded default-excludes match the spec table verbatim.**

---

## Execution notes

- **Sequential, not parallel.** Tasks 3-7 all mutate the same two files (`ast-grep-tools.ts` + its test) with cumulative state. Subagent-driven execution would force re-reading the bridge file 5 times unnecessarily. Recommend `superpowers:executing-plans` (inline with checkpoints) — same call we made for the fff bridge plan.
- **Commit hygiene.** Each task lands one focused commit. We're going directly to `main` per the repo's branch policy.
- **No worktree.** Same as the fff plan: per CLAUDE.md, do not create a worktree unless explicitly asked. Work proceeds on `main`.
- **CI is authoritative.** Local full-suite flakiness on `mcp-brief-tool.test.ts` is a known issue (see memory `project_public_snapshot_divergence` cont.7 and the timeout fix on `2026-06-15`). If a flaky test failure surfaces during this plan, re-run that one file in isolation to confirm it's infrastructure, not content.
- **After all 13 tasks merge on dev:** the rollout sequence is the same as for `--with-fff` — port to the curated `origin/main` snapshot via fresh branch + FF-push, watch real CI, then `npm publish 1.2.0`.
