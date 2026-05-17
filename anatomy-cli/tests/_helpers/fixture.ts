// tests/_helpers/fixture.ts
// Builds valid .anatomy file text for tests, computing fingerprint via
// the exported fingerprintFromPillars so fixtures pass the fingerprint check.
// Default version is v0.7; pass version: "0.14" (or another supported wire
// version) to test features added in later versions (e.g. rule verify blocks).

import { fingerprintFromPillars } from "@anatomy/validate";

export interface AnatomyFixtureOpts {
  stack?: string;
  form?: string;
  domain?: string;
  function?: string;
  tagline?: string;
  description?: string;
  /** Extra TOML appended after [generated]. Use for adding [[rules]],
   *  [operation.commands], [[structure.entries]], etc. */
  extraToml?: string;
  /** Set to override the file's generated.commit. Used for staleness tests. */
  commit?: string;
  /** Wire version string written into anatomy_version and the schema URL.
   *  Defaults to "0.7". Newer versions are additive-compatible. */
  version?: string;
}

export function buildAnatomyToml(opts: AnatomyFixtureOpts = {}): string {
  const stack = opts.stack ?? "javascript";
  const form = opts.form ?? "javascript-library";
  const domain = opts.domain ?? "test";
  const fn = opts.function ?? "test";
  const tagline = opts.tagline ?? "test fixture";
  const version = opts.version ?? "0.7";
  const fp = fingerprintFromPillars(stack, form, domain, fn);

  const lines: string[] = [
    `anatomy_version = "${version}"`,
    `tagline = "${tagline}"`,
  ];
  if (opts.description) lines.push(`description = "${opts.description}"`);
  lines.push("");
  lines.push("[identity]");
  lines.push(`stack = "${stack}"`);
  lines.push(`form = "${form}"`);
  lines.push(`domain = "${domain}"`);
  lines.push(`function = "${fn}"`);
  lines.push(`fingerprint = "${fp}"`);

  if (opts.extraToml) {
    lines.push("");
    lines.push(opts.extraToml.trim());
  }

  lines.push("");
  lines.push("[generated]");
  lines.push(`at = 2026-05-08T00:00:00.000Z`);
  if (opts.commit) lines.push(`commit = "${opts.commit}"`);
  lines.push(`by = "@anatomy/cli@test"`);
  lines.push(`model = "none"`);
  lines.push(`schema = "https://anatomy.dev/spec/${version}/schema.json"`);
  return lines.join("\n") + "\n";
}
