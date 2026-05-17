import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectPython } from "../src/pass1/manifest/python.js";

describe("detectPython", () => {
  it("returns null when no pyproject.toml exists", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-py-"));
    expect(detectPython(root)).toBeNull();
  });

  it("returns DetectedManifest when pyproject.toml exists", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-py-"));
    writeFileSync(join(root, "pyproject.toml"), `[project]\nname = "x"\nversion = "1.0.0"\n`);
    const result = detectPython(root);
    expect(result?.kind).toBe("pyproject");
    expect(result?.path).toBe(join(root, "pyproject.toml"));
    const project = (result?.parsed as { project: { name: string } }).project;
    expect(project.name).toBe("x");
  });

  it("loose-Python fallback: 2+ .py files at root with no manifest → kind=pyproject", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-py-"));
    writeFileSync(join(root, "fetch_data.py"), "print('hello')");
    writeFileSync(join(root, "transform.py"), "print('hi')");
    const result = detectPython(root);
    expect(result?.kind).toBe("pyproject");
    expect(result?.path).toBe(root);
  });

  it("loose-Python fallback does not fire on a single .py file", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-py-"));
    writeFileSync(join(root, "one.py"), "");
    expect(detectPython(root)).toBeNull();
  });

  it("loose-Python fallback ignores hidden .py files (e.g. .pyenv)", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-py-"));
    writeFileSync(join(root, ".hidden.py"), "");
    writeFileSync(join(root, "real.py"), "");
    // Only one non-hidden .py file → below threshold of 2.
    expect(detectPython(root)).toBeNull();
  });

  it("marks pyproject as non-primary when project.name has sidecar suffix", () => {
    for (const name of ["foo-scripts", "foo-tools", "foo-helpers", "foo-utils", "foo-bindings", "foo-build"]) {
      const root = mkdtempSync(join(tmpdir(), "anat-py-sidecar-"));
      writeFileSync(join(root, "pyproject.toml"), `[project]\nname = "${name}"\nversion = "0.0.0"\n`);
      const result = detectPython(root);
      expect(result?.kind).toBe("pyproject");
      expect(result?.isPrimary).toBe(false);
    }
  });

  it("keeps pyproject primary for non-sidecar project names", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-py-"));
    writeFileSync(join(root, "pyproject.toml"), `[project]\nname = "real-project"\nversion = "1.0.0"\n`);
    const result = detectPython(root);
    expect(result?.isPrimary).not.toBe(false);
  });
});
