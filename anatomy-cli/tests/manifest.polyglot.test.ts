import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectManifest } from "../src/pass1/manifest/index.js";

describe("detectManifest polyglot rules", () => {
  it("llama.cpp shape: CMakeLists.txt + sidecar pyproject (-scripts) → cpp", () => {
    // llama.cpp ships a pyproject.toml whose project.name = "llama-cpp-scripts"
    // for helper Python conversion scripts. The real project is C++ (CMake).
    // Pre-fix, detectManifest returned pyproject because python comes before
    // cpp in detect order and the sidecar wasn't demoted.
    const root = mkdtempSync(join(tmpdir(), "anat-poly-"));
    writeFileSync(
      join(root, "pyproject.toml"),
      `[project]\nname = "llama-cpp-scripts"\nversion = "0.0.0"\n`,
    );
    writeFileSync(
      join(root, "CMakeLists.txt"),
      `cmake_minimum_required(VERSION 3.14)\nproject(llama LANGUAGES C CXX)\n`,
    );
    expect(detectManifest(root)?.kind).toBe("cpp");
  });

  it("phoenix-html shape: mix.exs + npm with main field → elixir", () => {
    // Pre-fix: Phoenix.HTML's package.json (which ships JS assets for the
    // Elixir library) won over mix.exs because npm fired first. The
    // Elixir-side mix.exs is the primary manifest.
    const root = mkdtempSync(join(tmpdir(), "anat-poly-"));
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "phoenix_html", main: "./priv/static/phoenix_html.js" }),
    );
    writeFileSync(join(root, "mix.exs"), 'defmodule PhoenixHtml.MixProject do\nend');
    expect(detectManifest(root)?.kind).toBe("elixir");
  });

  it("mkdocs-material shape: pyproject.toml [project].name + real package.json → python", () => {
    // Dual-published packages (mkdocs-material on both PyPI and npm) had
    // package.json win because the .py-vs-.ts root file count couldn't
    // tip the balance. Now [project].name is a stronger signal for python.
    const root = mkdtempSync(join(tmpdir(), "anat-poly-"));
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "mkdocs-material", main: "./material/templates/mkdocs.html" }),
    );
    writeFileSync(
      join(root, "pyproject.toml"),
      `[project]\nname = "mkdocs-material"\nversion = "9.0"\n`,
    );
    expect(detectManifest(root)?.kind).toBe("pyproject");
  });

  it("preferPython falls back to file count when pyproject has no [project]", () => {
    // Older Python repos using setup.py with a near-empty pyproject.toml
    // still need the .py-vs-.ts heuristic.
    const root = mkdtempSync(join(tmpdir(), "anat-poly-"));
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "x", main: "./index.js" }));
    writeFileSync(join(root, "pyproject.toml"), `[build-system]\nrequires = ["setuptools"]\n`);
    writeFileSync(join(root, "main.py"), "");
    writeFileSync(join(root, "core.py"), "");
    expect(detectManifest(root)?.kind).toBe("pyproject");
  });
});
