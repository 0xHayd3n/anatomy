import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectClojure, clojureFormSuffix } from "../src/pass1/manifest/clojure.js";

describe("detectClojure", () => {
  it("returns null without project.clj or deps.edn", () => {
    expect(detectClojure(mkdtempSync(join(tmpdir(), "anat-clj-")))).toBeNull();
  });

  it("detects project.clj", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-clj-"));
    writeFileSync(join(root, "project.clj"), '(defproject myapp "1.0.0" :dependencies [[org.clojure/clojure "1.11.1"]])');
    expect(detectClojure(root)?.kind).toBe("clojure");
  });

  it("detects deps.edn alone", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-clj-"));
    writeFileSync(join(root, "deps.edn"), '{:deps {org.clojure/clojure {:mvn/version "1.11.1"}}}');
    expect(detectClojure(root)?.kind).toBe("clojure");
  });
});

describe("clojureFormSuffix", () => {
  it("compojure dep → service", () => {
    expect(clojureFormSuffix({ projectClj: '(defproject myapp "1" :dependencies [[compojure "1.7"]])' })).toBe("service");
  });

  it("ring/ring-core dep → service", () => {
    expect(clojureFormSuffix({ projectClj: '(defproject myapp "1" :dependencies [[ring/ring-core "1.15"]])' })).toBe("service");
  });

  it("self-name disqualifier: defproject compojure → library (not service)", () => {
    // compojure IS the routing library, not a service that uses it.
    // Same class of false-positive as phoenix_pubsub before its
    // word-boundary fix.
    const proj = '(defproject compojure "1.7.2" :dependencies [[ring/ring-core "1.15.1"]])';
    expect(clojureFormSuffix({ projectClj: proj })).toBe("library");
  });

  it(":main key → cli-tool", () => {
    expect(clojureFormSuffix({ projectClj: '(defproject mycli "1" :main mycli.core)' })).toBe("cli-tool");
  });

  it("plain → library", () => {
    expect(clojureFormSuffix({ projectClj: '(defproject mylib "1" :dependencies [[org.clojure/clojure "1.11"]])' })).toBe("library");
  });
});
