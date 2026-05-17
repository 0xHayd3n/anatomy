// src/checks/verify/detect-semgrep.ts
// Cached one-shot detection of the `semgrep` binary on PATH. Used by both
// semgrep-pattern-verifier and semgrep-rule-file-verifier to decide whether
// to invoke Semgrep or emit verify-semgrep-unavailable.
//
// shell:true is required for .cmd shim resolution on Windows — npm/pip-installed
// CLIs don't resolve as plain executables on Windows without it.

import { spawnSync } from "node:child_process";

export interface SemgrepDetection {
  available: boolean;
  version?: string;
}

let cached: SemgrepDetection | undefined;

export function getSemgrep(): SemgrepDetection {
  if (cached !== undefined) return cached;

  try {
    const result = spawnSync("semgrep", ["--version"], {
      shell: true,
      encoding: "buffer",
      timeout: 10_000,
    });

    if (result.status === 0 && !result.error) {
      const version = result.stdout.toString("utf8").trim();
      cached = { available: true, version };
    } else {
      cached = { available: false };
    }
  } catch {
    cached = { available: false };
  }

  return cached;
}

/** Test-only: reset the module-level cache so each test sees a clean state. */
export function _resetSemgrepCache(): void {
  cached = undefined;
}
