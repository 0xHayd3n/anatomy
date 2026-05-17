// src/canonical.ts
// Implements the normative canonicalization algorithm from spec/0.1/canonicalization.md
// and the v0.7 fingerprint formula. Logic must stay byte-identical with the two
// other copies in this monorepo:
//   - scripts/canonical.mjs (the spec's normative reference implementation)
//   - anatomy-cli/src/canonical.ts (the CLI's copy)
// fingerprintFromPillars originated in anatomy-cli and was mirrored here and to
// scripts/; the canonicalize/hash/canonicalHash trio has not changed since v0.1.

import { createHash } from "node:crypto";

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"; // Crockford-base32, lowercase

/**
 * Reduce input to canonical form per spec/0.1/canonicalization.md.
 * Returns null if the input fails alphabet validation or reduces to empty.
 */
export function canonicalize(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let s = input.toLowerCase();
  s = s.replace(/[\s_]+/g, "-");
  s = s.replace(/^[-.,:;]+|[-.,:;]+$/g, "");
  s = s.replace(/-+/g, "-");
  if (s === "" || /[^a-z0-9-]/.test(s)) return null;
  return s;
}

function toBase32(bytes: Buffer): string {
  let bits = 0n;
  let bitCount = 0;
  for (const b of bytes) {
    bits = (bits << 8n) | BigInt(b);
    bitCount += 8;
  }
  let out = "";
  while (bitCount >= 5) {
    bitCount -= 5;
    const idx = Number((bits >> BigInt(bitCount)) & 0x1fn);
    out += ALPHABET[idx];
  }
  if (bitCount > 0) {
    const idx = Number((bits << BigInt(5 - bitCount)) & 0x1fn);
    out += ALPHABET[idx];
  }
  return out;
}

/**
 * Compute a 5-char lowercase Crockford-base32 hash from canonical form.
 * Throws if the input is not already in canonical form.
 */
export function hash(canonical: string): string {
  if (canonicalize(canonical) !== canonical) {
    throw new Error(`hash() called on non-canonical input: ${JSON.stringify(canonical)}`);
  }
  const digest = createHash("sha256").update(canonical, "utf8").digest();
  return toBase32(digest).slice(0, 5);
}

/**
 * Convenience: canonicalize then hash. Returns null if canonicalization fails.
 */
export function canonicalHash(input: unknown): string | null {
  const c = canonicalize(input);
  if (c === null) return null;
  return hash(c);
}

/**
 * Compute the v0.7 identity fingerprint from four canonical pillar ID strings.
 * Formula: first 20 Crockford-base32 chars of SHA-256(stack NUL form NUL domain NUL function).
 * Inputs must already be in canonical form (lowercase hyphenated). Does NOT validate them.
 */
export function fingerprintFromPillars(
  stack: string, form: string, domain: string, fn: string
): string {
  const digest = createHash("sha256")
    .update(`${stack}\x00${form}\x00${domain}\x00${fn}`, "utf8")
    .digest();
  return toBase32(digest).slice(0, 20);
}
