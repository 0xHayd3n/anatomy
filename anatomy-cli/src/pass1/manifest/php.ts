// src/pass1/manifest/php.ts
// Detects PHP projects via composer.json. Stack: "php". Form heuristic:
// Laravel/Symfony/Slim/CakePHP/Yii in `require` → service; composer.json
// `bin` field → cli-tool; default library.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DetectedManifest } from "../../types.js";

interface PhpParsed {
  parsed: Record<string, unknown>;
}

export function detectPhp(repoRoot: string): DetectedManifest | null {
  const path = join(repoRoot, "composer.json");
  if (!existsSync(path)) return null;
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    // Malformed composer.json — still treat as PHP, but form heuristic
    // can't fire on the require map.
    parsed = {};
  }
  return { kind: "php", path, parsed: { parsed } satisfies PhpParsed };
}

const SERVICE_FRAMEWORKS = new Set([
  "laravel/framework", "symfony/framework-bundle", "symfony/symfony",
  "slim/slim", "cakephp/cakephp", "yiisoft/yii2", "yiisoft/yii",
  "zendframework/zendframework", "laminas/laminas-mvc",
  "phalcon/cphalcon",
]);

export function phpFormSuffix(parsed: unknown): "service" | "cli-tool" | "library" {
  const p = (parsed as PhpParsed | undefined)?.parsed ?? {};
  const requires = (p.require ?? {}) as Record<string, unknown>;
  const requireDev = (p["require-dev"] ?? {}) as Record<string, unknown>;
  for (const dep of Object.keys(requires).concat(Object.keys(requireDev))) {
    if (SERVICE_FRAMEWORKS.has(dep)) return "service";
  }
  if (p.bin !== undefined) return "cli-tool";
  return "library";
}
