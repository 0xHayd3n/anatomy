// src/pass1/manifest/swift.ts
// Detects Swift projects via Package.swift (SwiftPM). Stack: "swift". Form
// heuristic: `.executable(...)` or `.executableTarget(...)` in the manifest
// → cli-tool; else library. Plain string match on the manifest's Swift
// source — no Swift parser dependency.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { DetectedManifest } from "../../types.js";

const MAX_MANIFEST_BYTES = 256 * 1024;

interface SwiftParsed {
  content: string;
}

export function detectSwift(repoRoot: string): DetectedManifest | null {
  const path = join(repoRoot, "Package.swift");
  if (!existsSync(path)) return null;
  let content = "";
  try {
    const st = statSync(path);
    if (st.isFile() && st.size <= MAX_MANIFEST_BYTES) {
      content = readFileSync(path, "utf8");
    }
  } catch {}
  return { kind: "swift", path, parsed: { content } satisfies SwiftParsed };
}

export function swiftFormSuffix(parsed: unknown): "cli-tool" | "library" {
  const c = (parsed as SwiftParsed | undefined)?.content ?? "";
  // Look at the products: [...] block specifically — `.executableTarget(...)`
  // declarations elsewhere are often examples or build tools (e.g.
  // swift-argument-parser ships .library() as its product but multiple
  // .executableTarget() examples). The package's *product* is what the
  // user installs, so that's what determines form.
  const productsMatch = c.match(/products\s*:\s*\[([\s\S]*?)\]/);
  if (productsMatch) {
    const products = productsMatch[1];
    const hasLibrary = /\.library\s*\(/.test(products);
    const hasExecutable = /\.executable\s*\(/.test(products);
    if (hasExecutable && !hasLibrary) return "cli-tool";
    if (hasLibrary) return "library";
  }
  // No products: block — fall back to declarative target inspection.
  if (/\.executable(?:Target)?\s*\(/.test(c) && !/\.library\s*\(/.test(c)) return "cli-tool";
  return "library";
}
