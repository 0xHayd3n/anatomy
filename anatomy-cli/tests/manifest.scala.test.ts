import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectScala, scalaFormSuffix } from "../src/pass1/manifest/scala.js";

describe("detectScala", () => {
  it("returns null without build.sbt", () => {
    expect(detectScala(mkdtempSync(join(tmpdir(), "anat-sc-")))).toBeNull();
  });

  it("detects build.sbt", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-sc-"));
    writeFileSync(join(root, "build.sbt"), 'name := "myproject"\nversion := "0.1.0"');
    expect(detectScala(root)?.kind).toBe("scala");
  });
});

describe("scalaFormSuffix", () => {
  it("akka-http → service", () => {
    expect(scalaFormSuffix({ content: 'libraryDependencies += "com.typesafe.akka" %% "akka-http" % "10.5.0"' })).toBe("service");
  });

  it("http4s → service", () => {
    expect(scalaFormSuffix({ content: 'libraryDependencies += "org.http4s" %% "http4s-blaze-server" % "0.23"' })).toBe("service");
  });

  it("plain library → library", () => {
    expect(scalaFormSuffix({ content: 'libraryDependencies += "org.scalatest" %% "scalatest" % "3.2.17"' })).toBe("library");
  });
});
