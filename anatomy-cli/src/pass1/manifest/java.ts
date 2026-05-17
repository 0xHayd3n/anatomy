// src/pass1/manifest/java.ts
// Detects Java/Kotlin/Groovy/Scala projects via pom.xml (Maven) or
// build.gradle{,.kts} (Gradle). Stack differentiation: a build script that
// applies the Kotlin Gradle plugin → "kotlin"; otherwise "java". (Scala
// has its own detector via build.sbt; Groovy projects via Maven/Gradle
// stay "java" until/unless we add language-specific detection there too.)
// Form heuristic: Spring Boot / WAR packaging → service; jar with a main
// class → cli-tool; else library. Plain string match on the raw manifest
// content; no XML parser dependency.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { DetectedManifest } from "../../types.js";

const MAX_MANIFEST_BYTES = 256 * 1024;

export type JavaLanguage = "java" | "kotlin";

interface JavaParsed {
  /** "maven" or "gradle" — which manifest fired */
  buildSystem: "maven" | "gradle";
  /** Raw text contents of the matched manifest (truncated at 256KB) */
  content: string;
  /** Detected language — Kotlin when the build script applies the Kotlin
   *  Gradle plugin, otherwise Java. */
  language: JavaLanguage;
}

/** Detect Kotlin via Gradle plugin invocation. Matches:
 *  - kotlin("jvm") or kotlin("multiplatform") (Kotlin DSL)
 *  - id("org.jetbrains.kotlin.jvm") / id("org.jetbrains.kotlin.multiplatform")
 *  - apply plugin: "kotlin" / "kotlin-android" / "kotlin-multiplatform"
 *  - alias(libs.plugins.kotlin) / alias(libs.plugins.serialization) — the
 *    common version-catalog convention; weak signal but useful when
 *    combined with file extension (.kts).
 *  Maven Kotlin support is rare; defer until a real test case shows up. */
function detectKotlinPlugin(buildSystem: "maven" | "gradle", content: string, ext: ".kts" | ""): boolean {
  if (buildSystem !== "gradle") return false;
  if (/kotlin\s*\(\s*["'](?:jvm|multiplatform|js|android)["']\s*\)/.test(content)) return true;
  if (/id\s*\(?\s*["']org\.jetbrains\.kotlin/.test(content)) return true;
  if (/apply\s+plugin\s*:\s*["']kotlin(?:-android|-multiplatform)?["']/.test(content)) return true;
  // Version-catalog alias is weak alone; require .kts extension to count
  // as evidence of a Kotlin-DSL project.
  if (ext === ".kts" && /alias\s*\(\s*libs\.plugins\.(?:kotlin|serialization|android-library)/.test(content)) return true;
  return false;
}

function readCapped(path: string): string | null {
  try {
    const st = statSync(path);
    if (!st.isFile() || st.size > MAX_MANIFEST_BYTES) return null;
    return readFileSync(path, "utf8");
  } catch { return null; }
}

export function detectJava(repoRoot: string): DetectedManifest | null {
  const pom = join(repoRoot, "pom.xml");
  if (existsSync(pom)) {
    const content = readCapped(pom) ?? "";
    return {
      kind: "java",
      path: pom,
      parsed: { buildSystem: "maven", content, language: "java" } satisfies JavaParsed,
    };
  }
  for (const name of ["build.gradle.kts", "build.gradle"]) {
    const p = join(repoRoot, name);
    if (existsSync(p)) {
      const content = readCapped(p) ?? "";
      const ext = name.endsWith(".kts") ? ".kts" : "";
      const language: JavaLanguage = detectKotlinPlugin("gradle", content, ext) ? "kotlin" : "java";
      return {
        kind: "java",
        path: p,
        parsed: { buildSystem: "gradle", content, language } satisfies JavaParsed,
      };
    }
  }
  return null;
}

/** Stack id for a JavaParsed — java or kotlin. */
export function javaStack(parsed: unknown): "java" | "kotlin" {
  return (parsed as JavaParsed | undefined)?.language ?? "java";
}

export function javaFormSuffix(parsed: unknown): "service" | "cli-tool" | "library" {
  const p = parsed as JavaParsed | undefined;
  const c = p?.content ?? "";
  // Spring Boot / Quarkus / Micronaut / WAR packaging are service-shaped.
  if (/spring-boot-starter|spring-boot-maven-plugin|spring-boot-gradle-plugin/i.test(c)) return "service";
  if (/<packaging>\s*war\s*<\/packaging>/i.test(c)) return "service";
  if (/io\.quarkus|io\.micronaut|org\.apache\.tomcat/i.test(c)) return "service";
  // Gradle application plugin or Maven shade with mainClass → cli-tool.
  if (/(?:apply\s+plugin\s*:\s*['"]application['"]|id\s*\(\s*['"]application['"])/i.test(c)) return "cli-tool";
  if (/<mainClass>/i.test(c)) return "cli-tool";
  return "library";
}
