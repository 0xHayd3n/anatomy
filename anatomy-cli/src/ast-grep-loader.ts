// src/ast-grep-loader.ts
// Shared lazy loader for @ast-grep/napi. Used by verify-suggest (rule
// verification) and by --with-ast-grep (live MCP search). The module is an
// optionalDependency — postinstall may have failed on exotic platforms, in
// which case this returns null and callers handle it.

export type AstGrepModule = typeof import("@ast-grep/napi");

export async function loadAstGrep(): Promise<AstGrepModule | null> {
  try {
    return await import("@ast-grep/napi");
  } catch {
    return null;
  }
}
