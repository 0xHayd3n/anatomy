import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export function extractLocalSpecifiers(source: string): string[] {
  const found: string[] = [];
  // `from './foo'` — covers named, default, namespace, type imports and re-exports
  for (const m of source.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) found.push(m[1]);
  // `import './side-effect'` — bare side-effect imports; \b (not ^) catches mid-line occurrences
  for (const m of source.matchAll(/\bimport\s+['"](\.[^'"]+)['"]/g)) found.push(m[1]);
  return [...new Set(found)];
}

const RESOLVE_EXTS = [".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js"];

export function resolveSpecifier(
  repoRoot: string,
  fromFileRel: string,
  specifier: string
): string | null {
  const fromDir = dirname(join(repoRoot, fromFileRel));
  const base = join(fromDir, specifier);

  // Specifier already has a .js/.jsx extension — try as-is, then swap to .ts/.tsx.
  // (.ts/.tsx specifiers are not swapped; if they don't exist on disk, fall through.)
  if (/\.jsx?$/.test(specifier)) {
    if (existsSync(base)) return base;
    const tsSwap = base.replace(/\.js$/, ".ts").replace(/\.jsx$/, ".tsx");
    if (existsSync(tsSwap)) return tsSwap;
  }

  // Try path as-is before appending extensions (handles .ts/.tsx extension specifiers)
  if (existsSync(base)) return base;

  // No resolvable extension — try appending each candidate in priority order
  for (const ext of RESOLVE_EXTS) {
    const candidate = base + ext;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}
