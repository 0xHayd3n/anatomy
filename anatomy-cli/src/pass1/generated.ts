import { execSync } from "node:child_process";

export function deriveCommit(repoPath: string): string | undefined {
  try {
    return execSync("git rev-parse --short HEAD", {
      cwd: repoPath,
      stdio: "pipe",
      encoding: "utf8",
    }).trim();
  } catch {
    return undefined;
  }
}
