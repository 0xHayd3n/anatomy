// src/checks/verify/types.ts
// Discriminated-union type for the [[rules]].verify field, mirroring the
// $defs.verify shape in spec/0.12/schema.json. The schema validator enforces
// shape at parse time; this type lets TS narrow inside the verifier.

export type VerifyConfig =
  | { kind: "glob_exists"; path: string; should_not?: boolean }
  | { kind: "glob_only"; match: string; container: string }
  | {
      kind: "ast_pattern";
      lang: "ts" | "tsx" | "js" | "jsx" | "py" | "rs" | "go" | "java";
      pattern: string;
      expect_in?: string;
      forbid_in?: string;
    }
  | {
      kind: "semgrep";
      lang: "py" | "go" | "java" | "rb" | "c" | "cpp" | "rs" | "ts" | "tsx" | "js" | "jsx";
      pattern: string;
      expect_in?: string;
      forbid_in?: string;
    }
  | {
      kind: "semgrep";
      rule_file: string;
      expect_in?: string;
      forbid_in?: string;
    };

export type GlobExistsConfig = Extract<VerifyConfig, { kind: "glob_exists" }>;
export type GlobOnlyConfig = Extract<VerifyConfig, { kind: "glob_only" }>;
export type AstPatternConfig = Extract<VerifyConfig, { kind: "ast_pattern" }>;
export type SemgrepPatternConfig = Extract<VerifyConfig, { kind: "semgrep"; pattern: string }>;
export type SemgrepRuleFileConfig = Extract<VerifyConfig, { kind: "semgrep"; rule_file: string }>;
