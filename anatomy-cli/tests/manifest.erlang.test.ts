import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectErlang, erlangFormSuffix } from "../src/pass1/manifest/erlang.js";

describe("detectErlang", () => {
  it("returns null without rebar.config or *.app.src", () => {
    expect(detectErlang(mkdtempSync(join(tmpdir(), "anat-erl-")))).toBeNull();
  });

  it("detects rebar.config", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-erl-"));
    writeFileSync(join(root, "rebar.config"), "{deps, []}.\n");
    expect(detectErlang(root)?.kind).toBe("erlang");
  });

  it("detects bare src/*.app.src", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-erl-"));
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "myapp.app.src"), "{application, myapp, []}.");
    expect(detectErlang(root)?.kind).toBe("erlang");
  });

  it("detects otp_build script (erlang/otp shape)", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-erl-otp-"));
    writeFileSync(join(root, "otp_build"), "#!/bin/sh\n# OTP build driver");
    expect(detectErlang(root)?.kind).toBe("erlang");
  });

  it("detects loose .erl files at root (≥2)", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-erl-loose-"));
    writeFileSync(join(root, "main.erl"), "-module(main).\n");
    writeFileSync(join(root, "util.erl"), "-module(util).\n");
    expect(detectErlang(root)?.kind).toBe("erlang");
  });

  it("does NOT trigger on a single .erl file at root", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-erl-single-"));
    writeFileSync(join(root, "lonely.erl"), "-module(lonely).\n");
    expect(detectErlang(root)).toBeNull();
  });

  it("detects loose .erl files in src/ (≥2)", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-erl-src-"));
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "main.erl"), "-module(main).\n");
    writeFileSync(join(root, "src", "util.erl"), "-module(util).\n");
    expect(detectErlang(root)?.kind).toBe("erlang");
  });

  it("counts loose .erl files across root + src/ combined (1 each = trigger)", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-erl-split-"));
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "main.erl"), "-module(main).\n");
    writeFileSync(join(root, "src", "util.erl"), "-module(util).\n");
    expect(detectErlang(root)?.kind).toBe("erlang");
  });

  it("ignores hidden .erl files (e.g. .foo.erl)", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-erl-hidden-"));
    writeFileSync(join(root, ".hidden.erl"), "-module(hidden).\n");
    writeFileSync(join(root, "real.erl"), "-module(real).\n");
    // Only one non-hidden .erl file → below threshold of 2.
    expect(detectErlang(root)).toBeNull();
  });

  it("ignores a directory named otp_build (must be a file)", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-erl-otpdir-"));
    mkdirSync(join(root, "otp_build"));  // directory, not script
    expect(detectErlang(root)).toBeNull();
  });
});

describe("erlangFormSuffix", () => {
  it("cowboy dep → service", () => {
    expect(erlangFormSuffix({ rebarConfigContent: "{deps, [{cowboy, \"2.10.0\"}]}.", hasAppSrc: false })).toBe("service");
  });

  it("escript_name → cli-tool (rebar3-shape)", () => {
    expect(erlangFormSuffix({ rebarConfigContent: "{escript_name, rebar3}.", hasAppSrc: false })).toBe("cli-tool");
  });

  it("plain → library", () => {
    expect(erlangFormSuffix({ rebarConfigContent: "{deps, []}.", hasAppSrc: true })).toBe("library");
  });
});
