// src/pass1/identity.ts
// Derives identity (stack/form/domain/function + hashes/fingerprint) per spec §4.3.
// Stack from manifest kind (with TS-vs-JS rule for npm). Form from heuristics
// per the §4.3 table, stack-prefixed. Domain and function always placeholders
// in v0.1.

import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { fingerprintFromPillars } from "../canonical.js";
import { readManifest } from "../io.js";
import { debug } from "../log.js";
import { linguistStackFallback } from "./linguist-fallback.js";
import { dotnetFormSuffix, dotnetStack } from "./manifest/dotnet.js";
import { javaFormSuffix, javaStack } from "./manifest/java.js";
import { rubyFormSuffix } from "./manifest/ruby.js";
import { phpFormSuffix } from "./manifest/php.js";
import { swiftFormSuffix } from "./manifest/swift.js";
import { elixirFormSuffix } from "./manifest/elixir.js";
import { zigFormSuffix } from "./manifest/zig.js";
import { dartFormSuffix } from "./manifest/dart.js";
import { haskellFormSuffix } from "./manifest/haskell.js";
import { ocamlFormSuffix } from "./manifest/ocaml.js";
import { clojureFormSuffix } from "./manifest/clojure.js";
import { crystalFormSuffix } from "./manifest/crystal.js";
import { nimFormSuffix } from "./manifest/nim.js";
import { rFormSuffix } from "./manifest/r.js";
import { juliaFormSuffix } from "./manifest/julia.js";
import { erlangFormSuffix } from "./manifest/erlang.js";
import { luaFormSuffix } from "./manifest/lua.js";
import { scalaFormSuffix } from "./manifest/scala.js";
import { perlFormSuffix } from "./manifest/perl.js";
import { denoFormSuffix } from "./manifest/deno.js";
import { solidityFormSuffix } from "./manifest/solidity.js";
import { gleamFormSuffix } from "./manifest/gleam.js";
import { cppFormSuffix } from "./manifest/cpp.js";
import { vFormSuffix } from "./manifest/v.js";
import { terraformFormSuffix } from "./manifest/terraform.js";
import { helmFormSuffix } from "./manifest/helm.js";
import { godotFormSuffix } from "./manifest/godot.js";
import { githubActionFormSuffix } from "./manifest/github-action.js";

import type { DetectedManifest, IdentityFields } from "../types.js";

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? v as Record<string, unknown> : {};
}

function detectNpmStack(parsed: Record<string, unknown>, repoRoot: string): "typescript" | "javascript" {
  if (existsSync(join(repoRoot, "tsconfig.json"))) {
    debug("identity: stack=typescript (tsconfig.json present)");
    return "typescript";
  }
  const deps = { ...asObj(parsed.dependencies), ...asObj(parsed.devDependencies) };
  if (Object.prototype.hasOwnProperty.call(deps, "typescript")) {
    debug("identity: stack=typescript (typescript in deps/devDeps)");
    return "typescript";
  }
  debug("identity: stack=javascript (no tsconfig, no typescript dep)");
  return "javascript";
}

function deriveStack(manifest: DetectedManifest | null, repoRoot: string): { id: string; isPlaceholder: boolean } {
  // Null/stub-only branches consult the linguist fallback before falling
  // back to todo-stack. The fallback is opt-in via ANATOMY_LINGUIST_FALLBACK=1
  // — without the flag it returns null and behavior is unchanged.
  // Stub manifests (tooling sidecars like a ruff-config pyproject.toml or a
  // lint-only package.json) carry no primary-stack signal. Other Pass 1
  // derivers (tagline, description) may still use the stub for useful
  // fields, but stack must be a placeholder unless linguist fills it.
  if (!manifest || manifest.isPrimary === false) {
    const fallback = linguistStackFallback(repoRoot);
    if (fallback) return { id: fallback, isPlaceholder: false };
    return { id: "todo-stack", isPlaceholder: true };
  }
  switch (manifest.kind) {
    case "npm":      return { id: detectNpmStack(asObj(manifest.parsed), repoRoot), isPlaceholder: false };
    case "cargo":    return { id: "rust", isPlaceholder: false };
    case "pyproject": return { id: "python", isPlaceholder: false };
    case "go":       return { id: "go", isPlaceholder: false };
    case "dotnet":   return { id: dotnetStack(manifest.parsed), isPlaceholder: false };
    case "java":     return { id: javaStack(manifest.parsed), isPlaceholder: false };
    case "ruby":     return { id: "ruby", isPlaceholder: false };
    case "php":      return { id: "php", isPlaceholder: false };
    case "swift":    return { id: "swift", isPlaceholder: false };
    case "elixir":   return { id: "elixir", isPlaceholder: false };
    case "zig":      return { id: "zig", isPlaceholder: false };
    case "dart":     return { id: "dart", isPlaceholder: false };
    case "haskell":  return { id: "haskell", isPlaceholder: false };
    case "ocaml":    return { id: "ocaml", isPlaceholder: false };
    case "clojure":  return { id: "clojure", isPlaceholder: false };
    case "crystal":  return { id: "crystal", isPlaceholder: false };
    case "nim":      return { id: "nim", isPlaceholder: false };
    case "r":        return { id: "r", isPlaceholder: false };
    case "julia":    return { id: "julia", isPlaceholder: false };
    case "erlang":   return { id: "erlang", isPlaceholder: false };
    case "lua":      return { id: "lua", isPlaceholder: false };
    case "scala":    return { id: "scala", isPlaceholder: false };
    case "perl":     return { id: "perl", isPlaceholder: false };
    case "deno":     return { id: "typescript", isPlaceholder: false };
    case "solidity": return { id: "solidity", isPlaceholder: false };
    case "gleam":    return { id: "gleam", isPlaceholder: false };
    case "cpp":      return { id: "cpp", isPlaceholder: false };
    case "v":        return { id: "v", isPlaceholder: false };
    case "terraform": return { id: "terraform", isPlaceholder: false };
    case "helm":     return { id: "helm", isPlaceholder: false };
    case "godot":    return { id: "godot", isPlaceholder: false };
    case "github-action": return { id: "github-action", isPlaceholder: false };
  }
}

// Electron/Tauri *build-tool* deps (only desktop apps install these). The
// `electron` runtime and `@tauri-apps/api` deps are weaker signals — Tauri
// plugins (e.g., tauri-plugin-stronghold) install @tauri-apps/api as a
// runtime dep but are themselves libraries. They're handled separately:
// detected only when paired with a script that runs the binary.
const NPM_DESKTOP_BUILD_TOOLING = [
  "electron-builder", "electron-vite", "@electron/rebuild", "electron-rebuild",
  "electron-forge", "@tauri-apps/cli",
];

// Weak desktop signals: libraries that desktop apps depend on. Presence in
// deps alone doesn't make a project a desktop-app — see scripts check.
const NPM_DESKTOP_RUNTIME_DEPS = ["electron", "@tauri-apps/api"];

// Server frameworks whose presence signals service-shape.
const NPM_SERVER_FRAMEWORKS = new Set([
  "express", "fastify", "hono", "@hono/node-server", "koa",
  "@nestjs/core", "polka", "tinyhttp", "h3",
]);

// Rust GUI library deps that signal desktop-app shape. Presence in any
// workspace member's [dependencies] flips the form. Mirrors the npm-side
// hasNpmDesktopSignal but operates on Cargo.toml structure.
const RUST_DESKTOP_LIBS = new Set([
  "gpui",       // zed
  "eframe",     // egui-based apps
  "egui",
  "iced",
  "slint",
  "dioxus",
  "druid",
  "tauri",
  "tauri-bundler",
  "fltk",
  "cushy",
  // 12th-sweep additions: low-level windowing + GTK4 family + SDL2.
  // winit is the universal Rust windowing primitive; glutin is its OpenGL
  // companion (alacritty uses both for direct OpenGL terminal rendering).
  // gtk4 / gtk4-rs are the canonical modern GTK bindings; relm4 is the
  // GTK-based reactive framework; vizia is the declarative GUI framework.
  // sdl2 is a heavily-used cross-platform windowing/rendering crate.
  // Bare `gtk` (GTK2-era) excluded — could appear as FFI binding in
  // non-GUI libs. wgpu also excluded — has compute/headless uses.
  "winit",
  "glutin",
  "gtk4",
  "gtk4-rs",
  "relm4",
  "vizia",
  "sdl2",
]);

function cargoDepsContainAny(parsed: Record<string, unknown>, set: Set<string>): boolean {
  // Only scan [dependencies] — NOT [dev-dependencies]. Rust GUI libs (gpui,
  // eframe, iced) are runtime deps in real desktop apps; presence in dev-
  // deps signals integration tests, not a desktop-app shape (e.g., a Tauri
  // plugin library that integration-tests against the tauri runtime would
  // otherwise be misclassified as desktop-app). The npm-side equivalent
  // combines deps + devDeps because npm's GUI markers are BUILD TOOLS
  // (electron-builder, electron-vite) which legitimately live in devDeps;
  // Rust's GUI markers are runtime so the npm reasoning doesn't carry over.
  const deps = asObj(parsed.dependencies);
  for (const k of Object.keys(deps)) {
    if (set.has(k)) return true;
  }
  return false;
}

function hasCargoDesktopSignal(parsed: Record<string, unknown>, repoRoot: string): boolean {
  // Check root Cargo.toml deps directly (single-crate or workspace+package shapes).
  if (cargoDepsContainAny(parsed, RUST_DESKTOP_LIBS)) return true;
  // Check each workspace member's deps.
  const workspace = asObj(parsed.workspace);
  const members = workspace.members;
  if (!Array.isArray(members)) return false;
  for (const member of members) {
    if (typeof member !== "string") continue;
    const memberPath = join(repoRoot, member, "Cargo.toml");
    if (!existsSync(memberPath)) continue;
    try {
      const memberParsed = parseToml(readManifest(memberPath));
      if (cargoDepsContainAny(asObj(memberParsed), RUST_DESKTOP_LIBS)) return true;
    } catch {}
  }
  return false;
}

function hasNpmDesktopSignal(parsed: Record<string, unknown>): boolean {
  const deps = { ...asObj(parsed.dependencies), ...asObj(parsed.devDependencies) };

  // Strong: any build-tool dep (only installed by actual desktop apps).
  for (const pkg of NPM_DESKTOP_BUILD_TOOLING) {
    if (Object.prototype.hasOwnProperty.call(deps, pkg)) return true;
  }

  // Script values that invoke electron/tauri binaries directly (e.g. `electron .`,
  // `electron-vite dev`, `tauri dev`). Match as a whole word at start of script
  // or after a script connector to avoid matching `electronic-something`.
  const scripts = asObj(parsed.scripts);
  for (const v of Object.values(scripts)) {
    if (typeof v !== "string") continue;
    if (/(?:^|[\s&|])(?:electron(?:-vite|-builder)?|tauri)(?:\s|$)/.test(v)) return true;
  }

  // Weak: runtime deps (electron, @tauri-apps/api) — but ONLY count when
  // ALSO paired with a `main` field pointing to a main-process-shaped path
  // (main.js, electron/, dist/main/, etc.). Tauri plugins ship @tauri-apps/
  // api as a runtime dep but use `module`/`browser`/`exports` fields for
  // library export — they have no `main` pointing at a process entry.
  const hasRuntimeDep = NPM_DESKTOP_RUNTIME_DEPS.some(p =>
    Object.prototype.hasOwnProperty.call(deps, p));
  if (hasRuntimeDep) {
    const main = parsed.main;
    if (typeof main === "string" && /(?:^|\/)(?:main|electron)(?:\/|\.|$)/i.test(main)) {
      return true;
    }
  }
  return false;
}

function hasNpmServerFramework(parsed: Record<string, unknown>): boolean {
  const deps = asObj(parsed.dependencies);
  for (const k of Object.keys(deps)) {
    if (NPM_SERVER_FRAMEWORKS.has(k)) return true;
  }
  return false;
}

function hasNodeServerStart(parsed: Record<string, unknown>): boolean {
  const start = asObj(parsed.scripts).start;
  if (typeof start !== "string") return false;
  const trimmed = start.trim();
  // Don't double-count Electron/Tauri starts as server starts — those are
  // already detected by the desktop-app path.
  if (/^(electron|tauri)\b/.test(trimmed)) return false;
  // `node X.js`, `tsx server.ts`, `bun start.ts`, `deno run X.ts` style.
  return /^(?:node|tsx|bun|deno\s+run)\s+\S+\.(?:js|cjs|mjs|ts|mts|cts)\s*$/.test(trimmed);
}

function hasDockerSignal(repoRoot: string): boolean {
  return (
    existsSync(join(repoRoot, "Dockerfile")) ||
    existsSync(join(repoRoot, "docker-compose.yml")) ||
    existsSync(join(repoRoot, "docker-compose.yaml")) ||
    existsSync(join(repoRoot, "cog.yaml"))
  );
}

/** Walk a Cargo workspace's members to determine whether the workspace
 *  exposes a binary (cli-tool), only libraries (library), or nothing
 *  informative (null → todo-form). Used when the root Cargo.toml is
 *  workspace-only with no top-level [[bin]] or [lib]. The deno repo was
 *  the motivating case — workspace root, cli/Cargo.toml declares [[bin]].
 *
 *  Note: glob patterns in `members` (e.g. crates-star, used by Bevy,
 *  Actix-web, many large workspaces) are not expanded. existsSync against
 *  the literal glob path is false, so the function returns null and the
 *  caller falls through to todo-form. That's consistent with the demote-
 *  to-placeholder philosophy — an under-determined glob workspace is a
 *  reasonable placeholder case — but a future refinement could glob-
 *  expand members for richer detection. */
function cargoWorkspaceFormSuffix(parsed: Record<string, unknown>, repoRoot: string): "cli-tool" | "library" | null {
  const workspace = asObj(parsed.workspace);
  const members = workspace.members;
  if (!Array.isArray(members)) return null;
  const repoBasename = basename(repoRoot);

  // First pass: prefer the member whose package.name matches the repo dir
  // basename. That member is canonically the "main" crate of the project;
  // its nature (lib vs bin) reflects the project's primary intent.
  // Without this, tokio's workspace (tokio library + auxiliary crates with
  // [[bin]] examples) misclassifies as cli-tool because the walker hits a
  // bin first.
  for (const member of members) {
    if (typeof member !== "string") continue;
    const memberPath = join(repoRoot, member, "Cargo.toml");
    if (!existsSync(memberPath)) continue;
    let memberParsed: unknown;
    try {
      memberParsed = parseToml(readManifest(memberPath));
    } catch {
      continue;
    }
    const m = asObj(memberParsed);
    const pkg = asObj(m.package);
    if (pkg.name !== repoBasename) continue;
    // Found the canonically-named member; use ITS nature.
    if (Array.isArray(m.bin) && m.bin.length > 0) return "cli-tool";
    if (m.lib !== undefined) return "library";
    // Named member is uninformative; fall through to the broader walk below.
    break;
  }

  // Second pass: original walk — first [[bin]] wins, else any [lib] → library.
  let sawLib = false;
  for (const member of members) {
    if (typeof member !== "string") continue;
    const memberPath = join(repoRoot, member, "Cargo.toml");
    if (!existsSync(memberPath)) continue;
    let memberParsed: unknown;
    try {
      memberParsed = parseToml(readManifest(memberPath));
    } catch {
      continue;
    }
    const m = asObj(memberParsed);
    if (Array.isArray(m.bin) && m.bin.length > 0) return "cli-tool";
    if (m.lib !== undefined) sawLib = true;
  }
  return sawLib ? "library" : null;
}

function deriveFormSuffix(manifest: DetectedManifest, repoRoot: string): "cli-tool" | "library" | "service" | "desktop-app" | null {
  // NOTE: Dockerfile/docker-compose/cog.yaml were a top-level "→ service for
  // any manifest type" override prior to commit-this-fix. That false-flagged
  // libraries that ship a Dockerfile only for dev/docs containers (F# Data,
  // gettext, mdBook etc.). They're now demoted to one moderate signal that
  // contributes to the npm service-counter; for non-npm stacks they no
  // longer flip form on their own. Real service repos in non-npm stacks
  // are detected via stack-specific framework heuristics (Spring Boot,
  // Phoenix, Laravel, Rails, etc.).

  const p = asObj(manifest.parsed);
  switch (manifest.kind) {
    case "npm": {
      // Desktop-app detection: high-precision dep / tooling / script signals.
      // Takes precedence over the moderate-signal service path because
      // Electron apps often have `scripts.start = "electron ."` which would
      // otherwise count as a service moderate-signal.
      if (hasNpmDesktopSignal(p)) return "desktop-app";

      // Moderate service signals: 2+ → service
      let moderate = 0;
      const deployDir = join(repoRoot, "deploy");
      if (existsSync(deployDir) && statSync(deployDir).isDirectory()) moderate++;
      // Dockerfile/docker-compose now contributes one moderate signal here
      // (was a strong signal that auto-flipped any stack to service).
      if (hasDockerSignal(repoRoot)) moderate++;
      // scripts.start was previously a moderate service signal but is too
      // generic — almost every npm package has one. Combined with a Docker-
      // for-CI signal, libraries like axios were flipped to service. Real
      // services are detected by server-framework dep + node-server-shape
      // start script (which IS specific) — see hasNodeServerStart below.
      // bin≠main was previously a moderate signal here, intended to catch
      // service-launcher shapes like `main: dist/server.js + bin: bin/launch.mjs`.
      // It also fired on real CLI tools that ship lib + cli (web-ext: main:
      // index.js + bin: bin/web-ext.js), which misclassified them as service
      // when paired with any other moderate signal. The shape is genuinely
      // ambiguous from manifest fields alone, so the signal was dropped.
      // Real services are identified by server-framework deps and
      // node-server-start scripts; libraries-with-CLI like web-ext now
      // correctly classify as cli-tool.

      // Server framework dep (express, fastify, hono, koa, nest, etc.)
      if (hasNpmServerFramework(p)) moderate++;
      // `start` script shaped like a node-runtime server entry
      if (hasNodeServerStart(p)) moderate++;

      if (moderate >= 2) return "service";
      return p.bin !== undefined ? "cli-tool" : "library";
    }
    case "cargo": {
      // Desktop-app detection runs first (highest precedence) — a workspace
      // with gpui/eframe/iced/etc. deps is a desktop app even if it also
      // declares [[bin]] for the launcher.
      if (hasCargoDesktopSignal(p, repoRoot)) return "desktop-app";
      // Top-level [[bin]] wins.
      if (Array.isArray(p.bin) && p.bin.length > 0) return "cli-tool";
      // Top-level [lib] declaration → library.
      if (p.lib !== undefined) return "library";
      // Workspace handling — only when workspace declares `members`.
      // Workspaces with only `exclude` or no members at all (rustlings
      // shape) skip this branch and fall through to implicit-form
      // detection below.
      if (p.workspace !== undefined && Array.isArray(asObj(p.workspace).members)) {
        const ws = cargoWorkspaceFormSuffix(p, repoRoot);
        if (ws !== null) return ws;
        // Workspace declared members but they were uninformative
        // (e.g. only globs we can't expand, or members with no [[bin]]/
        // [lib]). Try implicit-form fallback at workspace root; if
        // neither implicit file exists, return null (todo-form).
        if (existsSync(join(repoRoot, "src", "main.rs"))) return "cli-tool";
        if (existsSync(join(repoRoot, "src", "lib.rs"))) return "library";
        return null;
      }
      // No workspace OR workspace without `members` declared (rustlings:
      // [workspace] exclude = [...] only). Use implicit form: src/main.rs
      // implies a binary crate (Cargo convention — no explicit [[bin]]
      // needed); src/lib.rs implies a library crate.
      if (existsSync(join(repoRoot, "src", "main.rs"))) return "cli-tool";
      if (existsSync(join(repoRoot, "src", "lib.rs"))) return "library";
      return "library";
    }
    case "pyproject": {
      const project = asObj(p.project);
      const scripts = asObj(project.scripts);
      return Object.keys(scripts).length > 0 ? "cli-tool" : "library";
    }
    case "go": {
      const cmdDir = join(repoRoot, "cmd");
      if (!existsSync(cmdDir)) return "library";
      try {
        for (const ent of readdirSync(cmdDir, { withFileTypes: true })) {
          if (ent.isDirectory() && existsSync(join(cmdDir, ent.name, "main.go"))) return "cli-tool";
        }
      } catch {}
      return "library";
    }
    case "dotnet": return dotnetFormSuffix(manifest.parsed);
    case "java":   return javaFormSuffix(manifest.parsed);
    case "ruby":   return rubyFormSuffix(manifest.parsed);
    case "php":    return phpFormSuffix(manifest.parsed);
    case "swift":  return swiftFormSuffix(manifest.parsed);
    case "elixir": return elixirFormSuffix(manifest.parsed);
    case "zig":    return zigFormSuffix(manifest.parsed);
    case "dart":   return dartFormSuffix(manifest.parsed);
    case "haskell":return haskellFormSuffix(manifest.parsed);
    case "ocaml":  return ocamlFormSuffix(manifest.parsed);
    case "clojure":return clojureFormSuffix(manifest.parsed);
    case "crystal":return crystalFormSuffix(manifest.parsed);
    case "nim":    return nimFormSuffix(manifest.parsed);
    case "r":      return rFormSuffix(manifest.parsed);
    case "julia":  return juliaFormSuffix(manifest.parsed);
    case "erlang": return erlangFormSuffix(manifest.parsed);
    case "lua":    return luaFormSuffix(manifest.parsed);
    case "scala":  return scalaFormSuffix(manifest.parsed);
    case "perl":   return perlFormSuffix(manifest.parsed);
    case "deno":   return denoFormSuffix(manifest.parsed);
    case "solidity": return solidityFormSuffix(manifest.parsed);
    case "gleam":  return gleamFormSuffix(manifest.parsed);
    case "cpp":    return cppFormSuffix(manifest.parsed);
    case "v":      return vFormSuffix(manifest.parsed);
    case "terraform": return terraformFormSuffix(manifest.parsed);
    case "helm":   return helmFormSuffix(manifest.parsed);
    case "godot":  return godotFormSuffix(manifest.parsed);
    case "github-action": return githubActionFormSuffix(manifest.parsed);
  }
}

function makePillar(id: string, isPlaceholder: boolean) {
  return { id, isPlaceholder };
}

export function deriveIdentity(manifest: DetectedManifest | null, repoRoot: string): IdentityFields {
  const stack = deriveStack(manifest, repoRoot);
  const stackPillar = makePillar(stack.id, stack.isPlaceholder);
  // Form derivation requires a primary manifest — a stub doesn't tell us
  // whether the project is a library/cli/service/desktop-app. Falls to
  // todo-form just like a missing-manifest case.
  const formSuffix = manifest && manifest.isPrimary !== false ? deriveFormSuffix(manifest, repoRoot) : null;
  const form = formSuffix !== null
    ? makePillar(`${stack.id}-${formSuffix}`, false)
    : makePillar("todo-form", true);
  debug(`identity: form=${form.id} (${form.isPlaceholder ? "placeholder" : "derived"})`);
  const domain = makePillar("todo-domain", true);
  const fn = makePillar("todo-function", true);
  return {
    stack: stackPillar,
    form,
    domain,
    function: fn,
    fingerprint: fingerprintFromPillars(stackPillar.id, form.id, domain.id, fn.id),
  };
}
