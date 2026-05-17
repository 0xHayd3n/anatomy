import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPass2Config } from "../src/pass2/providers/config.js";
import { isPass2Provider, resolveProviderExport, loadThirdPartyProvider } from "../src/pass2/providers/loader.js";
import { listProviders, getProvider, selectProvider, _resetThirdPartyCache } from "../src/pass2/providers/index.js";

const ENV_KEYS = [
  "ANATOMY_PASS2_PROVIDERS", "ANATOMY_PASS2_PROVIDER",
  "OPENAI_API_KEY", "ANTHROPIC_API_KEY",
] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  _resetThirdPartyCache();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  _resetThirdPartyCache();
  vi.restoreAllMocks();
});

// ── readPass2Config ──────────────────────────────────────────────────────────

describe("readPass2Config", () => {
  it("returns null when no .anatomy-cli.toml and no env var", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-cfg-"));
    try {
      expect(readPass2Config(root)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("ANATOMY_PASS2_PROVIDERS env var wins over file", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-cfg-"));
    try {
      writeFileSync(join(root, ".anatomy-cli.toml"), `[pass2]\nproviders = ["from-file"]\n`);
      process.env.ANATOMY_PASS2_PROVIDERS = "from-env-1, from-env-2";
      const cfg = readPass2Config(root);
      expect(cfg?.providers).toEqual(["from-env-1", "from-env-2"]);
      expect(cfg?.defaultProvider).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("env var with empty string falls through to file lookup", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-cfg-"));
    try {
      writeFileSync(join(root, ".anatomy-cli.toml"), `[pass2]\nproviders = ["from-file"]\n`);
      process.env.ANATOMY_PASS2_PROVIDERS = "";
      const cfg = readPass2Config(root);
      expect(cfg?.providers).toEqual(["from-file"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("parses [pass2] table with providers + default", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-cfg-"));
    try {
      writeFileSync(join(root, ".anatomy-cli.toml"), `
[pass2]
providers = ["anatomy-pass2-gemini", "@org/my-provider"]
default = "anatomy-pass2-gemini"
`);
      const cfg = readPass2Config(root);
      expect(cfg?.providers).toEqual(["anatomy-pass2-gemini", "@org/my-provider"]);
      expect(cfg?.defaultProvider).toBe("anatomy-pass2-gemini");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns null when [pass2] section is absent or empty", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-cfg-"));
    try {
      writeFileSync(join(root, ".anatomy-cli.toml"), `[other]\nfield = "value"\n`);
      expect(readPass2Config(root)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("filters non-string entries from providers array", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-cfg-"));
    try {
      writeFileSync(join(root, ".anatomy-cli.toml"), `
[pass2]
providers = ["valid", 42, "also-valid"]
`);
      const cfg = readPass2Config(root);
      expect(cfg?.providers).toEqual(["valid", "also-valid"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("non-string default field is ignored (treated as undefined)", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-cfg-"));
    try {
      writeFileSync(join(root, ".anatomy-cli.toml"), `
[pass2]
providers = ["x"]
default = 42
`);
      const cfg = readPass2Config(root);
      expect(cfg?.defaultProvider).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("malformed TOML logs to stderr and returns null", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-cfg-"));
    try {
      writeFileSync(join(root, ".anatomy-cli.toml"), `[pass2\nproviders = ["x"]`);
      const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      expect(readPass2Config(root)).toBeNull();
      expect(stderr).toHaveBeenCalledWith(expect.stringMatching(/malformed/));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("config with only `default` (no providers list) is still meaningful — set a built-in as default", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-cfg-"));
    try {
      writeFileSync(join(root, ".anatomy-cli.toml"), `[pass2]\ndefault = "anthropic-http"\n`);
      const cfg = readPass2Config(root);
      expect(cfg?.providers).toEqual([]);
      expect(cfg?.defaultProvider).toBe("anthropic-http");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ── isPass2Provider ──────────────────────────────────────────────────────────

describe("isPass2Provider type-guard", () => {
  it("accepts a valid provider object", () => {
    const valid = {
      name: "test",
      description: "test desc",
      available: async () => true,
      generate: async () => "{}",
    };
    expect(isPass2Provider(valid)).toBe(true);
  });

  it("rejects null / undefined / primitives", () => {
    expect(isPass2Provider(null)).toBe(false);
    expect(isPass2Provider(undefined)).toBe(false);
    expect(isPass2Provider("string")).toBe(false);
    expect(isPass2Provider(42)).toBe(false);
  });

  it("rejects when name is missing or empty", () => {
    expect(isPass2Provider({ description: "x", available: () => true, generate: () => "" })).toBe(false);
    expect(isPass2Provider({ name: "", description: "x", available: () => true, generate: () => "" })).toBe(false);
  });

  it("rejects when available/generate is not a function", () => {
    expect(isPass2Provider({ name: "x", description: "x", available: "yes", generate: () => "" })).toBe(false);
    expect(isPass2Provider({ name: "x", description: "x", available: () => true, generate: "no" })).toBe(false);
  });
});

// ── resolveProviderExport ────────────────────────────────────────────────────

describe("resolveProviderExport", () => {
  it("returns the default export when valid", () => {
    const provider = {
      name: "p", description: "d",
      available: async () => true, generate: async () => "",
    };
    expect(resolveProviderExport({ default: provider })).toBe(provider);
  });

  it("falls back to the module itself when there's no default and the module IS a provider", () => {
    const provider = {
      name: "p", description: "d",
      available: async () => true, generate: async () => "",
    };
    expect(resolveProviderExport(provider)).toBe(provider);
  });

  it("returns null when neither default nor module is a valid provider", () => {
    expect(resolveProviderExport({ default: { not: "a provider" } })).toBeNull();
    expect(resolveProviderExport({ random: "object" })).toBeNull();
    expect(resolveProviderExport(null)).toBeNull();
  });
});

// ── loadThirdPartyProvider ──────────────────────────────────────────────────

describe("loadThirdPartyProvider", () => {
  it("returns null + writes stderr when the package doesn't exist", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const result = await loadThirdPartyProvider("definitely-not-a-real-package-12345");
    expect(result).toBeNull();
    expect(stderr).toHaveBeenCalledWith(expect.stringMatching(/failed to load.*definitely-not-a-real-package/));
  });
});

// ── Integration: third-party provider via env var ───────────────────────────

describe("listProviders with ANATOMY_PASS2_PROVIDERS env var", () => {
  it("logs a warning for unloadable packages but still returns built-ins", async () => {
    process.env.ANATOMY_PASS2_PROVIDERS = "nope-not-real-pkg";
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const all = await listProviders();
    const names = all.map(p => p.name);
    // Built-ins still present; the failed third-party load doesn't break the registry.
    expect(names).toContain("claude-cli");
    expect(names).toContain("anthropic-http");
    expect(names).toContain("openai-http");
    expect(stderr).toHaveBeenCalledWith(expect.stringMatching(/failed to load/));
  });

  it("dedupes against built-in names — listing 'claude-cli' as a third-party doesn't load anything", async () => {
    process.env.ANATOMY_PASS2_PROVIDERS = "claude-cli";
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const all = await listProviders();
    // No load attempted; no warning emitted.
    expect(stderr).not.toHaveBeenCalled();
    expect(all.map(p => p.name)).toEqual(["claude-cli", "anthropic-http", "openai-http"]);
  });
});

describe("selectProvider with config-level default", () => {
  it("config.default (e.g. anthropic-http) wins over auto-detect when no --provider / env var", async () => {
    const root = mkdtempSync(join(tmpdir(), "anat-cfg-"));
    const origCwd = process.cwd();
    try {
      writeFileSync(join(root, ".anatomy-cli.toml"), `[pass2]\ndefault = "anthropic-http"\n`);
      process.chdir(root);
      // anthropic-http requires ANTHROPIC_API_KEY for available() to return
      // true, but selectProvider with explicit `default` doesn't gate on
      // available() — it returns the named provider unconditionally so the
      // user's choice wins over availability heuristics.
      const p = await selectProvider();
      expect(p.name).toBe("anthropic-http");
    } finally {
      process.chdir(origCwd);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("explicit --provider arg still wins over config default", async () => {
    const root = mkdtempSync(join(tmpdir(), "anat-cfg-"));
    const origCwd = process.cwd();
    try {
      writeFileSync(join(root, ".anatomy-cli.toml"), `[pass2]\ndefault = "anthropic-http"\n`);
      process.chdir(root);
      const p = await selectProvider("openai-http");
      expect(p.name).toBe("openai-http");
    } finally {
      process.chdir(origCwd);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("ANATOMY_PASS2_PROVIDER env var wins over config default", async () => {
    const root = mkdtempSync(join(tmpdir(), "anat-cfg-"));
    const origCwd = process.cwd();
    try {
      writeFileSync(join(root, ".anatomy-cli.toml"), `[pass2]\ndefault = "anthropic-http"\n`);
      process.chdir(root);
      process.env.ANATOMY_PASS2_PROVIDER = "openai-http";
      const p = await selectProvider();
      expect(p.name).toBe("openai-http");
    } finally {
      process.chdir(origCwd);
      rmSync(root, { recursive: true, force: true });
    }
  });
});
