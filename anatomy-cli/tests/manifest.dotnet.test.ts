import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectDotnet, dotnetFormSuffix, dotnetStack } from "../src/pass1/manifest/dotnet.js";

describe("detectDotnet", () => {
  it("returns null when neither .sln nor .csproj exists", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-net-"));
    expect(detectDotnet(root)).toBeNull();
  });

  it("detects a top-level .csproj", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-net-"));
    writeFileSync(join(root, "App.csproj"), "<Project Sdk=\"Microsoft.NET.Sdk\"></Project>");
    const r = detectDotnet(root);
    expect(r?.kind).toBe("dotnet");
    expect(r?.path).toBe(join(root, "App.csproj"));
    const parsed = r!.parsed as { projPaths: string[]; projContents: string[] };
    expect(parsed.projPaths).toEqual([join(root, "App.csproj")]);
    expect(parsed.projContents[0]).toContain("Microsoft.NET.Sdk");
  });

  it("detects an .sln plus walks one level deep for .csproj", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-net-"));
    writeFileSync(join(root, "App.sln"), "Microsoft Visual Studio Solution File, Format Version 12.00");
    mkdirSync(join(root, "App"));
    writeFileSync(join(root, "App", "App.csproj"), "<Project><PropertyGroup><UseWPF>true</UseWPF></PropertyGroup></Project>");
    const r = detectDotnet(root);
    expect(r?.kind).toBe("dotnet");
    expect(r?.path).toBe(join(root, "App.sln"));
    const parsed = r!.parsed as { projPaths: string[]; projContents: string[] };
    expect(parsed.projPaths.length).toBe(1);
    expect(parsed.projContents[0]).toContain("UseWPF");
  });

  it("detects an .slnx (VS 17.10+ XML solution format) plus walks for .csproj", () => {
    // App-vNext/Polly + jbogard/MediatR shape: only .slnx at root, projects
    // under src/. Pre-fix detectDotnet returned null.
    const root = mkdtempSync(join(tmpdir(), "anat-net-"));
    writeFileSync(join(root, "Polly.slnx"), `<Solution><Project Path="src/Polly.Core/Polly.Core.csproj" /></Solution>`);
    mkdirSync(join(root, "src"));
    mkdirSync(join(root, "src", "Polly.Core"));
    writeFileSync(
      join(root, "src", "Polly.Core", "Polly.Core.csproj"),
      `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>`,
    );
    const r = detectDotnet(root);
    expect(r?.kind).toBe("dotnet");
    expect(r?.path).toBe(join(root, "Polly.slnx"));
    const parsed = r!.parsed as { projPaths: string[]; projContents: string[] };
    expect(parsed.projPaths.length).toBe(1);
    expect(parsed.projContents[0]).toContain("Microsoft.NET.Sdk");
  });

  it("detects an .slnf (solution filter)", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-net-"));
    writeFileSync(join(root, "Partial.slnf"), `{ "solution": { "path": "Full.sln", "projects": [] } }`);
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "App.csproj"), `<Project Sdk="Microsoft.NET.Sdk" />`);
    const r = detectDotnet(root);
    expect(r?.kind).toBe("dotnet");
    expect(r?.path).toBe(join(root, "Partial.slnf"));
  });

  it("excludes bin/, obj/, node_modules/ from csproj search", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-net-"));
    writeFileSync(join(root, "App.sln"), "");
    mkdirSync(join(root, "obj"));
    writeFileSync(join(root, "obj", "Generated.csproj"), "<Project/>");
    mkdirSync(join(root, "bin"));
    writeFileSync(join(root, "bin", "Build.csproj"), "<Project/>");
    const r = detectDotnet(root);
    const parsed = r!.parsed as { projPaths: string[] };
    expect(parsed.projPaths).toEqual([]);
  });
});

describe("dotnetFormSuffix", () => {
  it("UseWPF → desktop-app", () => {
    expect(dotnetFormSuffix({ projContents: ["<Project><UseWPF>true</UseWPF></Project>"] })).toBe("desktop-app");
  });

  it("UseWindowsForms → desktop-app", () => {
    expect(dotnetFormSuffix({ projContents: ["<UseWindowsForms>true</UseWindowsForms>"] })).toBe("desktop-app");
  });

  it("OutputType=WinExe → desktop-app", () => {
    expect(dotnetFormSuffix({ projContents: ["<OutputType>WinExe</OutputType>"] })).toBe("desktop-app");
  });

  it("OutputType=Exe alone → cli-tool", () => {
    expect(dotnetFormSuffix({ projContents: ["<OutputType>Exe</OutputType>"] })).toBe("cli-tool");
  });

  it("multi-project: 1× Exe + 5× Library → library (FSharp.Data regression)", () => {
    // FSharp.Data has build/build.fsproj with OutputType=Exe alongside
    // many src/*.fsproj declaring OutputType=Library. The repo is a
    // library; the build helper shouldn't flip the form.
    const projContents = [
      "<OutputType>Exe</OutputType>",
      "<OutputType>Library</OutputType>",
      "<OutputType>Library</OutputType>",
      "<OutputType>Library</OutputType>",
      "<OutputType>Library</OutputType>",
      "<OutputType>Library</OutputType>",
    ];
    expect(dotnetFormSuffix({ projContents })).toBe("library");
  });

  it("multi-project: 3× Exe + 1× Library → cli-tool (Exe dominant)", () => {
    expect(dotnetFormSuffix({ projContents: [
      "<OutputType>Exe</OutputType>",
      "<OutputType>Exe</OutputType>",
      "<OutputType>Exe</OutputType>",
      "<OutputType>Library</OutputType>",
    ]})).toBe("cli-tool");
  });

  it("no signal → library", () => {
    expect(dotnetFormSuffix({ projContents: ["<Project Sdk=\"Microsoft.NET.Sdk\"></Project>"] })).toBe("library");
  });

  it("empty parsed → library", () => {
    expect(dotnetFormSuffix(undefined)).toBe("library");
    expect(dotnetFormSuffix({ projContents: [] })).toBe("library");
  });
});

describe("detectDotnet — language differentiation", () => {
  it(".csproj → csharp", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-net-"));
    writeFileSync(join(root, "App.csproj"), "<Project/>");
    const r = detectDotnet(root);
    expect(dotnetStack(r!.parsed)).toBe("csharp");
  });

  it(".fsproj → fsharp (FSharp.Data regression)", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-net-"));
    writeFileSync(join(root, "App.fsproj"), "<Project/>");
    const r = detectDotnet(root);
    expect(dotnetStack(r!.parsed)).toBe("fsharp");
  });

  it(".vbproj → vbnet", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-net-"));
    writeFileSync(join(root, "App.vbproj"), "<Project/>");
    const r = detectDotnet(root);
    expect(dotnetStack(r!.parsed)).toBe("vbnet");
  });

  it("mixed: csproj + fsproj picks the more numerous (tie → csharp)", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-net-"));
    writeFileSync(join(root, "Lib.csproj"), "<Project/>");
    writeFileSync(join(root, "App.fsproj"), "<Project/>");
    expect(dotnetStack(detectDotnet(root)!.parsed)).toBe("csharp");
  });

  it("mixed: 2× fsproj + 1× csproj picks fsharp", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-net-"));
    writeFileSync(join(root, "Lib.fsproj"), "<Project/>");
    writeFileSync(join(root, "Tests.fsproj"), "<Project/>");
    writeFileSync(join(root, "Build.csproj"), "<Project/>");
    expect(dotnetStack(detectDotnet(root)!.parsed)).toBe("fsharp");
  });

  it("dotnetStack on undefined → csharp default", () => {
    expect(dotnetStack(undefined)).toBe("csharp");
  });
});
