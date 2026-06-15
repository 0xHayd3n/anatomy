// src/ast-grep-loader.ts
// Shared lazy loader for @ast-grep/napi. Used by verify-suggest (rule
// verification) and by --with-ast-grep (live MCP search). The module is an
// optionalDependency — postinstall may have failed on exotic platforms, in
// which case this returns null and callers handle it.
//
// ANATOMY_AST_GREP_DISABLE=1 forces a null return — used by tests to simulate
// the missing-napi case on a system where it's actually installed.

export type AstGrepModule = typeof import("@ast-grep/napi");

export async function loadAstGrep(): Promise<AstGrepModule | null> {
  const disable = process.env.ANATOMY_AST_GREP_DISABLE;
  if (disable && disable !== "0" && disable.toLowerCase() !== "false") {
    return null;
  }
  try {
    return await import("@ast-grep/napi");
  } catch {
    return null;
  }
}
