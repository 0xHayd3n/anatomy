import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { deriveIdentity } from "../src/pass1/identity.js";
import type { DetectedManifest } from "../src/types.js";

const npm = (parsed: object, root = "/tmp/x"): DetectedManifest => ({
  kind: "npm", path: `${root}/package.json`, parsed,
});

describe("deriveIdentity — stack", () => {
  it("npm with tsconfig.json → typescript", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-id-"));
    writeFileSync(join(root, "tsconfig.json"), "{}");
    const id = deriveIdentity(npm({ name: "x" }, root), root);
    expect(id.stack.id).toBe("typescript");
    expect(id.stack.isPlaceholder).toBe(false);
  });

  it("npm with typescript dep → typescript", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-id-"));
    const id = deriveIdentity(npm({ name: "x", dependencies: { typescript: "^5" } }, root), root);
    expect(id.stack.id).toBe("typescript");
  });

  it("npm without tsconfig and without typescript dep → javascript", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-id-"));
    const id = deriveIdentity(npm({ name: "x" }, root), root);
    expect(id.stack.id).toBe("javascript");
  });

  it("cargo → rust", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-id-"));
    const m: DetectedManifest = { kind: "cargo", path: `${root}/Cargo.toml`, parsed: { package: { name: "x" } } };
    expect(deriveIdentity(m, root).stack.id).toBe("rust");
  });

  it("pyproject → python", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-id-"));
    const m: DetectedManifest = { kind: "pyproject", path: `${root}/pyproject.toml`, parsed: { project: { name: "x" } } };
    expect(deriveIdentity(m, root).stack.id).toBe("python");
  });

  it("go.mod → go", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-id-"));
    const m: DetectedManifest = { kind: "go", path: `${root}/go.mod`, parsed: { module: "x", goVersion: "1.22" } };
    expect(deriveIdentity(m, root).stack.id).toBe("go");
  });

  it("null manifest → todo-stack placeholder", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-id-"));
    const id = deriveIdentity(null, root);
    expect(id.stack.id).toBe("todo-stack");
    expect(id.stack.isPlaceholder).toBe(true);
  });
});

describe("deriveIdentity — form", () => {
  it("npm with bin → <stack>-cli-tool", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-id-"));
    const id = deriveIdentity(npm({ name: "x", bin: "./cli.js" }, root), root);
    expect(id.form.id).toBe("javascript-cli-tool");
  });

  it("npm with main only → <stack>-library", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-id-"));
    writeFileSync(join(root, "tsconfig.json"), "{}");
    const id = deriveIdentity(npm({ name: "x", main: "./index.js" }, root), root);
    expect(id.form.id).toBe("typescript-library");
  });

  it("cargo with [[bin]] → rust-cli-tool", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-id-"));
    const m: DetectedManifest = { kind: "cargo", path: "", parsed: { package: { name: "x" }, bin: [{ name: "x" }] } };
    expect(deriveIdentity(m, root).form.id).toBe("rust-cli-tool");
  });

  it("cargo without [[bin]] → rust-library", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-id-"));
    const m: DetectedManifest = { kind: "cargo", path: "", parsed: { package: { name: "x" } } };
    expect(deriveIdentity(m, root).form.id).toBe("rust-library");
  });

  it("null manifest → todo-form placeholder", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-id-"));
    const id = deriveIdentity(null, root);
    expect(id.form.id).toBe("todo-form");
    expect(id.form.isPlaceholder).toBe(true);
  });

  it("cargo workspace with [[bin]]-declaring member → rust-cli-tool", () => {
    // deno-style: root Cargo.toml is workspace-only; cli/Cargo.toml has [[bin]].
    const root = mkdtempSync(join(tmpdir(), "anat-id-ws-"));
    mkdirSync(join(root, "cli"), { recursive: true });
    writeFileSync(
      join(root, "Cargo.toml"),
      `[workspace]\nmembers = ["cli"]\n`,
    );
    writeFileSync(
      join(root, "cli", "Cargo.toml"),
      `[package]\nname = "deno"\nversion = "0.0.0"\n[[bin]]\nname = "deno"\npath = "main.rs"\n`,
    );
    const m: DetectedManifest = {
      kind: "cargo", path: join(root, "Cargo.toml"),
      parsed: { workspace: { members: ["cli"] } },
      isPrimary: true,
    };
    expect(deriveIdentity(m, root).form.id).toBe("rust-cli-tool");
  });

  it("cargo workspace with only [lib]-declaring members → rust-library", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-id-ws-"));
    mkdirSync(join(root, "core"), { recursive: true });
    writeFileSync(join(root, "Cargo.toml"), `[workspace]\nmembers = ["core"]\n`);
    writeFileSync(
      join(root, "core", "Cargo.toml"),
      `[package]\nname = "core"\nversion = "0.0.0"\n[lib]\npath = "src/lib.rs"\n`,
    );
    const m: DetectedManifest = {
      kind: "cargo", path: join(root, "Cargo.toml"),
      parsed: { workspace: { members: ["core"] } },
      isPrimary: true,
    };
    expect(deriveIdentity(m, root).form.id).toBe("rust-library");
  });

  it("cargo workspace with glob members (members = ['crates/*']) → todo-form", () => {
    // Bevy/Actix-web shape: workspace uses glob patterns for members. We
    // don't expand globs, so existsSync misses them and the function
    // returns null. Demote-to-placeholder is the correct outcome for
    // under-determined input.
    const root = mkdtempSync(join(tmpdir(), "anat-id-ws-"));
    mkdirSync(join(root, "crates", "real"), { recursive: true });
    writeFileSync(join(root, "Cargo.toml"), `[workspace]\nmembers = ["crates/*"]\n`);
    writeFileSync(
      join(root, "crates", "real", "Cargo.toml"),
      `[package]\nname = "real"\nversion = "0.0.0"\n[[bin]]\nname = "real"\npath = "main.rs"\n`,
    );
    const m: DetectedManifest = {
      kind: "cargo", path: join(root, "Cargo.toml"),
      parsed: { workspace: { members: ["crates/*"] } },
      isPrimary: true,
    };
    const id = deriveIdentity(m, root);
    expect(id.form.id).toBe("todo-form");
    expect(id.form.isPlaceholder).toBe(true);
  });

  it("cargo workspace with no informative members → todo-form", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-id-ws-"));
    mkdirSync(join(root, "noop"), { recursive: true });
    writeFileSync(join(root, "Cargo.toml"), `[workspace]\nmembers = ["noop"]\n`);
    writeFileSync(
      join(root, "noop", "Cargo.toml"),
      `[package]\nname = "noop"\nversion = "0.0.0"\n`,
    );
    const m: DetectedManifest = {
      kind: "cargo", path: join(root, "Cargo.toml"),
      parsed: { workspace: { members: ["noop"] } },
      isPrimary: true,
    };
    const id = deriveIdentity(m, root);
    expect(id.form.id).toBe("todo-form");
    expect(id.form.isPlaceholder).toBe(true);
  });

  it("cargo workspace with name-matching member: lib member wins over bin member (tokio shape)", () => {
    // tokio's workspace has tokio (library) plus auxiliary crates with [[bin]].
    // Without name-match preference, the bin would be picked, classifying
    // tokio as cli-tool. With name-match, the tokio crate's [lib] wins.
    const root = mkdtempSync(join(tmpdir(), "anat-id-tokio-"));
    const repoBasename = basename(root);
    mkdirSync(join(root, "main"), { recursive: true });
    mkdirSync(join(root, "examples"), { recursive: true });
    writeFileSync(join(root, "Cargo.toml"), `[workspace]\nmembers = ["main", "examples"]\n`);
    writeFileSync(
      join(root, "main", "Cargo.toml"),
      `[package]\nname = "${repoBasename}"\nversion = "0.0.0"\n[lib]\npath = "src/lib.rs"\n`,
    );
    writeFileSync(
      join(root, "examples", "Cargo.toml"),
      `[package]\nname = "examples"\nversion = "0.0.0"\n[[bin]]\nname = "ex"\npath = "main.rs"\n`,
    );
    const m: DetectedManifest = {
      kind: "cargo", path: join(root, "Cargo.toml"),
      parsed: { workspace: { members: ["main", "examples"] } },
      isPrimary: true,
    };
    expect(deriveIdentity(m, root).form.id).toBe("rust-library");
  });

  it("cargo workspace with Rust GUI dep (gpui) → rust-desktop-app (zed shape)", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-id-zed-"));
    const repoBasename = basename(root);
    mkdirSync(join(root, "crates", "main"), { recursive: true });
    writeFileSync(join(root, "Cargo.toml"), `[workspace]\nmembers = ["crates/main"]\n`);
    writeFileSync(
      join(root, "crates", "main", "Cargo.toml"),
      `[package]\nname = "${repoBasename}"\nversion = "0.0.0"\n[[bin]]\nname = "${repoBasename}"\npath = "main.rs"\n[dependencies]\ngpui = "1.0"\n`,
    );
    const m: DetectedManifest = {
      kind: "cargo", path: join(root, "Cargo.toml"),
      parsed: { workspace: { members: ["crates/main"] } },
      isPrimary: true,
    };
    expect(deriveIdentity(m, root).form.id).toBe("rust-desktop-app");
  });

  it("cargo workspace without GUI dep stays as cli-tool (regression guard)", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-id-cli-"));
    const repoBasename = basename(root);
    mkdirSync(join(root, "crates", "main"), { recursive: true });
    writeFileSync(join(root, "Cargo.toml"), `[workspace]\nmembers = ["crates/main"]\n`);
    writeFileSync(
      join(root, "crates", "main", "Cargo.toml"),
      `[package]\nname = "${repoBasename}"\nversion = "0.0.0"\n[[bin]]\nname = "${repoBasename}"\npath = "main.rs"\n[dependencies]\nclap = "4"\n`,
    );
    const m: DetectedManifest = {
      kind: "cargo", path: join(root, "Cargo.toml"),
      parsed: { workspace: { members: ["crates/main"] } },
      isPrimary: true,
    };
    expect(deriveIdentity(m, root).form.id).toBe("rust-cli-tool");
  });

  it("cargo workspace with winit + glutin → rust-desktop-app (alacritty shape)", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-id-alacritty-"));
    const repoBasename = basename(root);
    mkdirSync(join(root, "main"), { recursive: true });
    writeFileSync(join(root, "Cargo.toml"), `[workspace]\nmembers = ["main"]\n`);
    writeFileSync(
      join(root, "main", "Cargo.toml"),
      `[package]\nname = "${repoBasename}"\nversion = "0.0.0"\n[dependencies]\nwinit = "0.30"\nglutin = "0.32"\n`,
    );
    const m: DetectedManifest = {
      kind: "cargo", path: join(root, "Cargo.toml"),
      parsed: { workspace: { members: ["main"] } },
      isPrimary: true,
    };
    expect(deriveIdentity(m, root).form.id).toBe("rust-desktop-app");
  });

  it("cargo workspace with gtk4 dep → rust-desktop-app", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-id-gtk-"));
    const repoBasename = basename(root);
    mkdirSync(join(root, "main"), { recursive: true });
    writeFileSync(join(root, "Cargo.toml"), `[workspace]\nmembers = ["main"]\n`);
    writeFileSync(
      join(root, "main", "Cargo.toml"),
      `[package]\nname = "${repoBasename}"\nversion = "0.0.0"\n[dependencies]\ngtk4 = "0.9"\n`,
    );
    const m: DetectedManifest = {
      kind: "cargo", path: join(root, "Cargo.toml"),
      parsed: { workspace: { members: ["main"] } },
      isPrimary: true,
    };
    expect(deriveIdentity(m, root).form.id).toBe("rust-desktop-app");
  });

  it("cargo workspace with exclude only + implicit src/main.rs → rust-cli-tool (rustlings shape)", () => {
    // rustlings has [workspace] exclude = [...] (no members) plus [package]
    // and implicit src/main.rs. Pre-fix returned todo-form because the
    // workspace branch fired, members was undefined, and the result was null.
    const root = mkdtempSync(join(tmpdir(), "anat-id-rustlings-"));
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "main.rs"), "fn main() {}");
    writeFileSync(
      join(root, "Cargo.toml"),
      `[workspace]\nexclude = ["dev"]\n\n[package]\nname = "rustlings"\nversion = "0.0.0"\n`,
    );
    const m: DetectedManifest = {
      kind: "cargo", path: join(root, "Cargo.toml"),
      parsed: { workspace: { exclude: ["dev"] }, package: { name: "rustlings", version: "0.0.0" } },
      isPrimary: true,
    };
    expect(deriveIdentity(m, root).form.id).toBe("rust-cli-tool");
  });

  it("cargo single-crate with implicit src/lib.rs → rust-library", () => {
    // No workspace, no top-level [[bin]] or [lib] — but src/lib.rs exists,
    // making the crate a library by Cargo convention.
    const root = mkdtempSync(join(tmpdir(), "anat-id-implicit-lib-"));
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "lib.rs"), "// lib");
    writeFileSync(
      join(root, "Cargo.toml"),
      `[package]\nname = "mylib"\nversion = "0.0.0"\n`,
    );
    const m: DetectedManifest = {
      kind: "cargo", path: join(root, "Cargo.toml"),
      parsed: { package: { name: "mylib", version: "0.0.0" } },
      isPrimary: true,
    };
    expect(deriveIdentity(m, root).form.id).toBe("rust-library");
  });

  it("npm scripts.start alone does NOT flip form to service", () => {
    // axios shape: scripts.start exists, no Dockerfile, no deploy/, no
    // server-framework dep. Pre-fix, scripts.start was a moderate signal
    // and (with Docker on CI repos) tipped to service for libraries.
    const root = mkdtempSync(join(tmpdir(), "anat-id-"));
    writeFileSync(join(root, "tsconfig.json"), "{}");
    const id = deriveIdentity(
      npm({ name: "axios", main: "./index.js", scripts: { start: "node examples/server.js" } }, root),
      root,
    );
    expect(id.form.id).not.toBe("typescript-service");
    expect(id.form.id).toBe("typescript-library");
  });
});

describe("deriveIdentity — domain/function", () => {
  it("always emits placeholders", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-id-"));
    const id = deriveIdentity(npm({ name: "x" }, root), root);
    expect(id.domain.id).toBe("todo-domain");
    expect(id.function.id).toBe("todo-function");
    expect(id.domain.isPlaceholder).toBe(true);
    expect(id.function.isPlaceholder).toBe(true);
  });
});

describe("deriveIdentity — fingerprint", () => {
  it("fingerprint is 20-char lowercase alphanumeric", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-id-"));
    const id = deriveIdentity(npm({ name: "x" }, root), root);
    expect(id.fingerprint).toMatch(/^[a-z0-9]{20}$/);
  });
});

describe("deriveIdentity — service form detection", () => {
  it("npm with Dockerfile + start script → typescript-service", () => {
    // Dockerfile (1 moderate) + scripts.start (1 moderate) = 2 → service.
    // Pre-bin≠main-fix this also worked via bin≠main; that signal was
    // dropped because it false-positives on real CLI tools (web-ext).
    const root = mkdtempSync(join(tmpdir(), "anat-id-"));
    writeFileSync(join(root, "tsconfig.json"), "{}");
    writeFileSync(join(root, "Dockerfile"), "FROM node:22\n");
    const id = deriveIdentity(
      npm({ name: "x", scripts: { start: "node dist/server.js" } }, root),
      root,
    );
    expect(id.form.id).toBe("typescript-service");
  });

  it("npm with docker-compose.yml ALONE → typescript-library (Dockerfile demoted to moderate)", () => {
    // Pre-2026-05-09-bug-fix: docker-compose.yml alone flipped any stack to
    // service. F# Data, gettext etc. were misclassified for shipping a
    // dev-environment Dockerfile. Now Dockerfile-family is one moderate
    // signal; needs ≥1 other (start script, server framework, etc.) to
    // tip to service.
    const root = mkdtempSync(join(tmpdir(), "anat-id-"));
    writeFileSync(join(root, "tsconfig.json"), "{}");
    writeFileSync(join(root, "docker-compose.yml"), "services:\n");
    const id = deriveIdentity(npm({ name: "x" }, root), root);
    expect(id.form.id).toBe("typescript-library");
  });

  it("npm with docker-compose.yml + start script → typescript-service (2 moderate signals)", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-id-"));
    writeFileSync(join(root, "tsconfig.json"), "{}");
    writeFileSync(join(root, "docker-compose.yml"), "services:\n");
    const id = deriveIdentity(
      npm({ name: "x", scripts: { start: "node dist/server.js" } }, root),
      root,
    );
    expect(id.form.id).toBe("typescript-service");
  });

  it("npm with deploy/ + start script → typescript-service", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-id-"));
    writeFileSync(join(root, "tsconfig.json"), "{}");
    mkdirSync(join(root, "deploy"));
    const id = deriveIdentity(
      npm({ name: "x", bin: "./cli.js", scripts: { start: "node dist/index.js" } }, root),
      root,
    );
    expect(id.form.id).toBe("typescript-service");
  });

  it("npm with deploy/ + bin≠main → typescript-cli-tool (bin≠main signal dropped, has bin)", () => {
    // Pre-bin≠main-fix this returned typescript-service via deploy/ +
    // bin≠main = 2 moderates. The bin≠main signal was dropped because
    // it false-positives on real CLI tools that ship lib + cli (web-ext
    // shape: main: index.js + bin: bin/web-ext.js). Now deploy/ alone
    // is 1 moderate; with bin set, the result is cli-tool.
    const root = mkdtempSync(join(tmpdir(), "anat-id-"));
    writeFileSync(join(root, "tsconfig.json"), "{}");
    mkdirSync(join(root, "deploy"));
    const id = deriveIdentity(
      npm({ name: "x", bin: "./launcher.mjs", main: "./dist/index.js" }, root),
      root,
    );
    expect(id.form.id).toBe("typescript-cli-tool");
  });

  it("web-ext-shape: bin + main + scripts.start → cli-tool (regression)", () => {
    // mozilla/web-ext: real CLI tool with main: index.js (lib export) +
    // bin: bin/web-ext.js (CLI launcher) + scripts.start: "node scripts/develop"
    // (its dev-loop runner, not a server). Pre-fix this got 2 moderate
    // signals (start + bin≠main) → service. Now: 1 (start) → cli-tool.
    const root = mkdtempSync(join(tmpdir(), "anat-id-"));
    const id = deriveIdentity(
      npm({
        name: "web-ext", main: "index.js",
        bin: { "web-ext": "bin/web-ext.js" },
        scripts: { start: "node scripts/develop", build: "node scripts/build" },
      }, root),
      root,
    );
    expect(id.form.id).toBe("javascript-cli-tool");
  });

  it("tauri-plugin-shape: @tauri-apps/api dep + library exports → library (regression)", () => {
    // tauri-plugin-stronghold: library that integrates with Tauri's plugin
    // API. Has @tauri-apps/api as runtime dep, `module`/`browser`/`exports`
    // for library shape, no `main` pointing at a process entry. Pre-fix
    // hasNpmDesktopSignal returned true on the dep alone → desktop-app.
    // Now requires either a build-tooling dep or a `main` pointing at
    // a main-process path; this plugin has neither.
    const root = mkdtempSync(join(tmpdir(), "anat-id-"));
    const id = deriveIdentity(
      npm({
        name: "tauri-plugin-stronghold-api",
        type: "module",
        module: "dist-js/index.mjs",
        exports: { import: "./dist-js/index.mjs" },
        dependencies: { "@tauri-apps/api": "1.6.0" },
      }, root),
      root,
    );
    expect(id.form.id).toBe("javascript-library");
  });

  it("npm with deploy/ alone (one moderate signal) → typescript-cli-tool", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-id-"));
    writeFileSync(join(root, "tsconfig.json"), "{}");
    mkdirSync(join(root, "deploy"));
    const id = deriveIdentity(npm({ name: "x", bin: "./cli.js" }, root), root);
    expect(id.form.id).toBe("typescript-cli-tool");
  });

  it("npm with bin≠main alone (one moderate signal) → typescript-cli-tool", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-id-"));
    writeFileSync(join(root, "tsconfig.json"), "{}");
    const id = deriveIdentity(
      npm({ name: "x", bin: "./launcher.mjs", main: "./dist/index.js" }, root),
      root,
    );
    expect(id.form.id).toBe("typescript-cli-tool");
  });

  it("npm with bin only, no service signals → typescript-cli-tool (regression)", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-id-"));
    writeFileSync(join(root, "tsconfig.json"), "{}");
    const id = deriveIdentity(npm({ name: "x", bin: "./cli.js" }, root), root);
    expect(id.form.id).toBe("typescript-cli-tool");
  });

  it("npm with no bin, no service signals → typescript-library (regression)", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-id-"));
    writeFileSync(join(root, "tsconfig.json"), "{}");
    const id = deriveIdentity(npm({ name: "x", main: "./dist/index.js" }, root), root);
    expect(id.form.id).toBe("typescript-library");
  });

  it("Cargo with Dockerfile alone → rust-library (Dockerfile demoted; cargo has no service-framework heuristic yet)", () => {
    // Pre-2026-05-09-bug-fix this returned rust-service. The new policy is
    // that Dockerfile is one moderate signal across all stacks; cargo
    // doesn't yet have stack-specific service signals (axum/actix/tokio
    // etc.) wired up, so a cargo project with only Dockerfile stays
    // library. Real Rust services typically declare a server framework
    // dep that future detection can consume.
    const root = mkdtempSync(join(tmpdir(), "anat-id-"));
    writeFileSync(join(root, "Dockerfile"), "FROM rust:1.80\n");
    const m: DetectedManifest = { kind: "cargo", path: "", parsed: { package: { name: "x" } } };
    expect(deriveIdentity(m, root).form.id).toBe("rust-library");
  });
});

describe("deriveIdentity — desktop-app form detection", () => {
  it("npm with electron in devDependencies → typescript-desktop-app", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-id-"));
    writeFileSync(join(root, "tsconfig.json"), "{}");
    const id = deriveIdentity(
      npm({ name: "x", main: "./dist/main.js", devDependencies: { electron: "^33", typescript: "^5" } }, root),
      root,
    );
    expect(id.form.id).toBe("typescript-desktop-app");
  });

  it("npm with electron-vite + electron tooling scripts → desktop-app", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-id-"));
    writeFileSync(join(root, "tsconfig.json"), "{}");
    const id = deriveIdentity(
      npm({
        name: "x",
        main: "./out/main/index.js",
        scripts: { dev: "electron-vite dev", build: "electron-vite build" },
        devDependencies: { "electron-vite": "^2", typescript: "^5" },
      }, root),
      root,
    );
    expect(id.form.id).toBe("typescript-desktop-app");
  });

  it("npm with @tauri-apps/cli devDep → desktop-app", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-id-"));
    const id = deriveIdentity(
      npm({ name: "x", main: "./dist/index.js", devDependencies: { "@tauri-apps/cli": "^1" } }, root),
      root,
    );
    expect(id.form.id).toBe("javascript-desktop-app");
  });

  it("npm with `start: electron .` and electron in deps → desktop-app (not service)", () => {
    // Sentinel-shaped: scripts.start would normally count as a service moderate
    // signal. The desktop-app check fires first because electron is in deps.
    const root = mkdtempSync(join(tmpdir(), "anat-id-"));
    const id = deriveIdentity(
      npm({
        name: "x",
        main: "main.js",
        scripts: { start: "electron .", dev: "electron . --dev" },
        devDependencies: { electron: "^41" },
      }, root),
      root,
    );
    expect(id.form.id).toBe("javascript-desktop-app");
  });

  it("npm with electron in deps does NOT match `electronic-foo`-style false positives", () => {
    // Make sure the regex anchor is robust — a dep named `electronic-music`
    // (hypothetical) should not trip the desktop-app path, while a script
    // value containing `electronic` should also not match.
    const root = mkdtempSync(join(tmpdir(), "anat-id-"));
    writeFileSync(join(root, "tsconfig.json"), "{}");
    const id = deriveIdentity(
      npm({
        name: "x",
        main: "./dist/index.js",
        scripts: { dev: "electronic-thing build" },
        dependencies: { "electronic-music": "^1" },
      }, root),
      root,
    );
    expect(id.form.id).toBe("typescript-library");
  });
});

describe("deriveIdentity — .NET (csproj/sln)", () => {
  it("detects WPF csproj → csharp-desktop-app", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-id-net-"));
    writeFileSync(join(root, "App.sln"), "Microsoft Visual Studio Solution File");
    writeFileSync(join(root, "App.csproj"), `<Project Sdk="Microsoft.NET.Sdk.WindowsDesktop">
  <PropertyGroup>
    <OutputType>WinExe</OutputType>
    <UseWPF>true</UseWPF>
  </PropertyGroup>
</Project>`);
    const m: DetectedManifest = { kind: "dotnet", path: join(root, "App.sln"), parsed: {
      slnPath: join(root, "App.sln"),
      projPaths: [join(root, "App.csproj")],
      projContents: [require("node:fs").readFileSync(join(root, "App.csproj"), "utf8")],
    }};
    const id = deriveIdentity(m, root);
    expect(id.stack.id).toBe("csharp");
    expect(id.form.id).toBe("csharp-desktop-app");
  });

  it("detects WindowsForms csproj → csharp-desktop-app", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-id-net-"));
    const csproj = `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><UseWindowsForms>true</UseWindowsForms></PropertyGroup></Project>`;
    const m: DetectedManifest = { kind: "dotnet", path: "x", parsed: { projPaths: [], projContents: [csproj] } };
    expect(deriveIdentity(m, root).form.id).toBe("csharp-desktop-app");
  });

  it("detects OutputType=Exe csproj → csharp-cli-tool", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-id-net-"));
    const csproj = `<Project><PropertyGroup><OutputType>Exe</OutputType></PropertyGroup></Project>`;
    const m: DetectedManifest = { kind: "dotnet", path: "x", parsed: { projPaths: [], projContents: [csproj] } };
    expect(deriveIdentity(m, root).form.id).toBe("csharp-cli-tool");
  });

  it("library default when csproj has no OutputType / WPF / WinForms", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-id-net-"));
    const csproj = `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>`;
    const m: DetectedManifest = { kind: "dotnet", path: "x", parsed: { projPaths: [], projContents: [csproj] } };
    expect(deriveIdentity(m, root).form.id).toBe("csharp-library");
  });
});

describe("deriveIdentity — service form via server frameworks + node-server start", () => {
  it("npm with express dep + start `node server.js` → service (Verbifex shape)", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-id-"));
    const id = deriveIdentity(
      npm({
        name: "x",
        main: "server.js",
        scripts: { start: "node server.js" },
        dependencies: { express: "^4" },
      }, root),
      root,
    );
    // moderate signals: scripts.start (1) + express in deps (1) + node-server start (1) = 3
    expect(id.form.id).toBe("javascript-service");
  });

  it("npm with fastify dep + start `tsx server.ts` → service", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-id-"));
    writeFileSync(join(root, "tsconfig.json"), "{}");
    const id = deriveIdentity(
      npm({
        name: "x",
        main: "dist/server.js",
        scripts: { start: "tsx src/server.ts" },
        dependencies: { fastify: "^4" },
      }, root),
      root,
    );
    expect(id.form.id).toBe("typescript-service");
  });

  it("npm with hono dep alone (one moderate, no start script) → library (regression)", () => {
    // hono in deps = 1 moderate signal but nothing else; should stay library.
    const root = mkdtempSync(join(tmpdir(), "anat-id-"));
    const id = deriveIdentity(
      npm({ name: "x", main: "./index.js", dependencies: { hono: "^4" } }, root),
      root,
    );
    expect(id.form.id).toBe("javascript-library");
  });

  it("npm with bin + express dep + node-server start → service (cursorinline shape)", () => {
    // CLI that runs a server — counts as service because of the multiple
    // server moderate signals. Form preserves the existing cursorinline result.
    const root = mkdtempSync(join(tmpdir(), "anat-id-"));
    const id = deriveIdentity(
      npm({
        name: "x",
        main: "./src/server.js",
        bin: { "x": "./bin/cli.js" },
        scripts: { start: "node bin/cli.js" },
        dependencies: { express: "^4" },
      }, root),
      root,
    );
    expect(id.form.id).toBe("javascript-service");
  });

  it("npm with non-server start script (e.g. `webpack serve`) does NOT count as node-server", () => {
    // Sanity check: only literal node/tsx/bun/deno start scripts trigger
    // the node-server moderate signal.
    const root = mkdtempSync(join(tmpdir(), "anat-id-"));
    const id = deriveIdentity(
      npm({
        name: "x",
        main: "./dist/index.js",
        scripts: { start: "webpack serve --mode development" },
      }, root),
      root,
    );
    // Only `scripts.start exists` moderate signal fires (1) → not service → library
    expect(id.form.id).toBe("javascript-library");
  });
});
