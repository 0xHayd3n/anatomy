// src/pass1/manifest/scala.ts
// Detects Scala projects via build.sbt. Stack: "scala". Form heuristic:
// akka-http / play / http4s / cask / zio-http dep → service; default
// library. build.sbt is Scala source — plain text match.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { DetectedManifest } from "../../types.js";

const MAX_MANIFEST_BYTES = 256 * 1024;

interface ScalaParsed {
  content: string;
}

export function detectScala(repoRoot: string): DetectedManifest | null {
  const path = join(repoRoot, "build.sbt");
  if (!existsSync(path)) return null;
  let content = "";
  try {
    const st = statSync(path);
    if (st.isFile() && st.size <= MAX_MANIFEST_BYTES) {
      content = readFileSync(path, "utf8");
    }
  } catch {}
  return { kind: "scala", path, parsed: { content } satisfies ScalaParsed };
}

export function scalaFormSuffix(parsed: unknown): "service" | "library" {
  const c = (parsed as ScalaParsed | undefined)?.content ?? "";
  if (/\b(?:akka-http|play|http4s|cask|zio-http|finagle)\b/.test(c)) return "service";
  return "library";
}
