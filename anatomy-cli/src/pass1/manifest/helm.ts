// src/pass1/manifest/helm.ts
// Detects Helm charts via Chart.yaml at repo root. Stack: "helm". Form:
// "library" (a chart is a reusable Kubernetes deployment definition;
// closest existing slug to "module"). Multi-chart repositories like
// prometheus-community/helm-charts (which keep individual charts in
// charts/<name>/Chart.yaml) won't trigger — the per-chart subdirs would
// need their own .anatomy files; that's how cascading discovery is meant
// to work.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { DetectedManifest } from "../../types.js";

const MAX_MANIFEST_BYTES = 64 * 1024;

interface HelmParsed {
  content: string;
}

export function detectHelm(repoRoot: string): DetectedManifest | null {
  const path = join(repoRoot, "Chart.yaml");
  if (!existsSync(path)) return null;
  let content = "";
  try {
    const st = statSync(path);
    if (st.isFile() && st.size <= MAX_MANIFEST_BYTES) {
      content = readFileSync(path, "utf8");
      // Disambiguation: a Chart.yaml has `apiVersion: v1|v2` and `name:`.
      // Without those, this might be a different tool's Chart.yaml.
      if (!/^apiVersion\s*:/m.test(content) || !/^name\s*:/m.test(content)) return null;
    }
  } catch { return null; }
  return { kind: "helm", path, parsed: { content } satisfies HelmParsed };
}

export function helmFormSuffix(_parsed: unknown): "library" {
  return "library";
}
