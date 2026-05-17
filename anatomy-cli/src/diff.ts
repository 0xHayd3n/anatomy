// src/diff.ts
// Minimal line-by-line unified diff. Sufficient for surfacing render
// drift to a human reader in --check mode and the on-ramp prompt.
// Not a full unified diff (no hunk headers, no context lines) — but
// the +/- format reads naturally and is easy to scan.

export function unifiedDiff(a: string, b: string, label: string): string {
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const out: string[] = [`--- on-disk ${label}`, `+++ fresh render`];
  const max = Math.max(aLines.length, bLines.length);
  for (let i = 0; i < max; i++) {
    if (aLines[i] !== bLines[i]) {
      if (aLines[i] !== undefined) out.push(`-${aLines[i]}`);
      if (bLines[i] !== undefined) out.push(`+${bLines[i]}`);
    }
  }
  return out.join("\n");
}
