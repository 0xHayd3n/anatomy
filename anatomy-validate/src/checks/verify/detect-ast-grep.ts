// src/checks/verify/detect-ast-grep.ts
// Lazy loader for the optional @ast-grep/napi dependency. ast-grep is shipped
// as platform-specific native binaries via optionalDependencies; on unsupported
// platforms or installations where it failed, the import throws. We catch the
// throw and surface a null, letting the ast_pattern verifier degrade gracefully
// with a verify-ast-grep-unavailable warning instead of failing validation.

type AstGrepModule = typeof import("@ast-grep/napi");

let cached: AstGrepModule | null | undefined;

/** Returns the @ast-grep/napi module, or null if the package is unavailable
 *  (not installed, or native binary missing for this platform). Caches the
 *  outcome — at most one import attempt per process. */
export async function getAstGrep(): Promise<AstGrepModule | null> {
  if (cached !== undefined) return cached;
  try {
    cached = await import("@ast-grep/napi");
  } catch {
    cached = null;
  }
  return cached;
}

/** Test-only: clear the cache so a follow-up call retries the import. */
export function _resetAstGrepCache(): void {
  cached = undefined;
}
