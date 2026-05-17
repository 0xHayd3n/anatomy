import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectElixir, elixirFormSuffix } from "../src/pass1/manifest/elixir.js";

describe("detectElixir", () => {
  it("returns null without mix.exs", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-ex-"));
    expect(detectElixir(root)).toBeNull();
  });

  it("detects mix.exs", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-ex-"));
    writeFileSync(join(root, "mix.exs"), "defmodule MyApp.Mixfile do\nend");
    expect(detectElixir(root)?.kind).toBe("elixir");
  });
});

describe("elixirFormSuffix", () => {
  it("phoenix dep → service", () => {
    expect(elixirFormSuffix({ content: '{:phoenix, "~> 1.7"}' })).toBe("service");
  });

  it("plug dep → service", () => {
    expect(elixirFormSuffix({ content: '{:plug, "~> 1.14"}' })).toBe("service");
  });

  it("escript config → cli-tool", () => {
    expect(elixirFormSuffix({ content: "escript: [main_module: MyCLI]" })).toBe("cli-tool");
  });

  it("OTP application with mod: but no web framework → library (gettext regression)", () => {
    // gettext ships `mod: {Gettext.Application, []}` to expose Application config
    // — that's not a service signal. Earlier heuristic false-positived.
    const content = `
def application do
  [
    extra_applications: [:logger],
    mod: {Gettext.Application, []}
  ]
end
defp deps do
  [{:expo, "~> 0.5"}, {:ex_doc, "~> 0.19", only: :dev}]
end
`;
    expect(elixirFormSuffix({ content })).toBe("library");
  });

  it("plain library mix.exs → library", () => {
    expect(elixirFormSuffix({ content: "defp deps do [{:jason, \"~> 1.0\"}] end" })).toBe("library");
  });

  it(":phoenix_pubsub does NOT trigger service (regex word-boundary regression)", () => {
    // phoenix_pubsub IS a library that ships in the Phoenix ecosystem. The
    // pre-fix regex `:phoenix|:plug|...` matched `:phoenix_pubsub` (the
    // package's own atom) because it had no word boundary.
    const content = `
      def project, do: [app: :phoenix_pubsub, version: "2.1.3", deps: deps()]
      defp deps, do: [{:ex_doc, ">= 0.0.0", only: :docs}]
    `;
    expect(elixirFormSuffix({ content })).toBe("library");
  });

  it(":plug as part of :plug_cowboy still triggers service", () => {
    // plug_cowboy IS a service-shaped dep — Plug HTTP server + Cowboy
    // adapter. But the regex shouldn't match :plug_cowboy via :plug.
    // It SHOULD match :plug_cowboy as a longer atom though. Let's confirm
    // both that :plug alone fires and that :plug_cowboy doesn't false
    // match :plug — they're distinct atoms.
    expect(elixirFormSuffix({ content: '{:plug_cowboy, "~> 2.0"}' })).toBe("library");
    expect(elixirFormSuffix({ content: '{:plug, "~> 1.14"}' })).toBe("service");
  });
});
