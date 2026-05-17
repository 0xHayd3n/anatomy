import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectJava, javaFormSuffix } from "../src/pass1/manifest/java.js";

describe("detectJava", () => {
  it("returns null when no manifest exists", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-java-"));
    expect(detectJava(root)).toBeNull();
  });

  it("detects pom.xml as maven", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-java-"));
    writeFileSync(join(root, "pom.xml"), "<project><modelVersion>4.0.0</modelVersion></project>");
    const r = detectJava(root);
    expect(r?.kind).toBe("java");
    expect((r?.parsed as { buildSystem: string }).buildSystem).toBe("maven");
  });

  it("detects build.gradle.kts as gradle", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-java-"));
    writeFileSync(join(root, "build.gradle.kts"), "plugins { kotlin(\"jvm\") }");
    const r = detectJava(root);
    expect((r?.parsed as { buildSystem: string }).buildSystem).toBe("gradle");
  });

  it("prefers pom.xml over build.gradle when both present", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-java-"));
    writeFileSync(join(root, "pom.xml"), "<project/>");
    writeFileSync(join(root, "build.gradle"), "");
    expect((detectJava(root)?.parsed as { buildSystem: string }).buildSystem).toBe("maven");
  });
});

describe("javaFormSuffix", () => {
  it("Spring Boot starter parent → service", () => {
    expect(javaFormSuffix({ buildSystem: "maven", content: "<artifactId>spring-boot-starter-parent</artifactId>" })).toBe("service");
  });

  it("WAR packaging → service", () => {
    expect(javaFormSuffix({ buildSystem: "maven", content: "<packaging>war</packaging>" })).toBe("service");
  });

  it("Quarkus dep → service", () => {
    expect(javaFormSuffix({ buildSystem: "maven", content: "<groupId>io.quarkus</groupId>" })).toBe("service");
  });

  it("Gradle application plugin → cli-tool", () => {
    expect(javaFormSuffix({ buildSystem: "gradle", content: 'apply plugin: "application"' })).toBe("cli-tool");
    expect(javaFormSuffix({ buildSystem: "gradle", content: 'id("application")' })).toBe("cli-tool");
  });

  it("mainClass declared → cli-tool", () => {
    expect(javaFormSuffix({ buildSystem: "maven", content: "<mainClass>com.x.Main</mainClass>" })).toBe("cli-tool");
  });

  it("plain pom with no signals → library", () => {
    expect(javaFormSuffix({ buildSystem: "maven", content: "<project><artifactId>my-lib</artifactId></project>" })).toBe("library");
  });
});

describe("detectJava — Kotlin differentiation", () => {
  it("build.gradle.kts with kotlin(\"jvm\") → language=kotlin", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-java-"));
    writeFileSync(join(root, "build.gradle.kts"), 'plugins { kotlin("jvm") version "2.0.0" }');
    const r = detectJava(root);
    expect((r?.parsed as { language: string }).language).toBe("kotlin");
  });

  it("build.gradle.kts with kotlin(\"multiplatform\") → kotlin", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-java-"));
    writeFileSync(join(root, "build.gradle.kts"), 'plugins { kotlin("multiplatform") }');
    const r = detectJava(root);
    expect((r?.parsed as { language: string }).language).toBe("kotlin");
  });

  it("build.gradle with apply plugin: 'kotlin' → kotlin", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-java-"));
    writeFileSync(join(root, "build.gradle"), 'apply plugin: "kotlin"');
    const r = detectJava(root);
    expect((r?.parsed as { language: string }).language).toBe("kotlin");
  });

  it("build.gradle.kts with id(\"org.jetbrains.kotlin.jvm\") → kotlin", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-java-"));
    writeFileSync(join(root, "build.gradle.kts"), 'plugins { id("org.jetbrains.kotlin.jvm") version "2.0" }');
    const r = detectJava(root);
    expect((r?.parsed as { language: string }).language).toBe("kotlin");
  });

  it("plain Java pom.xml → language=java", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-java-"));
    writeFileSync(join(root, "pom.xml"), "<project><modelVersion>4.0.0</modelVersion></project>");
    const r = detectJava(root);
    expect((r?.parsed as { language: string }).language).toBe("java");
  });

  it("plain Groovy build.gradle (no kotlin plugin) → java", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-java-"));
    writeFileSync(join(root, "build.gradle"), 'apply plugin: "java"');
    const r = detectJava(root);
    expect((r?.parsed as { language: string }).language).toBe("java");
  });
});
