// scripts/canonical.mjs
// Shared canonicalization and hash helpers used by validate-spec.mjs and fix-fixture-hashes.mjs.
// IMPLEMENTS THE NORMATIVE RULES FROM spec/0.1/canonicalization.md.

import { createHash } from "node:crypto";

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"; // Crockford-base32, lowercase

/**
 * Reduce input to canonical form per spec/0.1/canonicalization.md.
 * Returns null if the input fails step 5 (alphabet validation).
 */
export function canonicalize(input) {
  if (typeof input !== "string") return null;
  let s = input.toLowerCase();
  s = s.replace(/[\s_]+/g, "-");
  s = s.replace(/^[-.,:;]+|[-.,:;]+$/g, "");
  s = s.replace(/-+/g, "-");
  if (s === "" || /[^a-z0-9-]/.test(s)) return null;
  return s;
}

function toBase32(bytes) {
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
export function hash(canonical) {
  if (canonicalize(canonical) !== canonical) {
    throw new Error(`hash() called on non-canonical input: ${JSON.stringify(canonical)}`);
  }
  const digest = createHash("sha256").update(canonical, "utf8").digest();
  return toBase32(digest).slice(0, 5);
}

/**
 * Convenience: canonicalize then hash. Returns null if input fails canonicalization.
 */
export function canonicalHash(input) {
  const c = canonicalize(input);
  if (c === null) return null;
  return hash(c);
}

/**
 * Compute the v0.7 identity fingerprint from four canonical pillar ID strings.
 * Formula: first 20 Crockford-base32 chars of SHA-256(stack NUL form NUL domain NUL function).
 * Inputs must already be in canonical form (lowercase hyphenated). Does NOT validate them.
 */
export function fingerprintFromPillars(stack, form, domain, fn) {
  const digest = createHash("sha256")
    .update(`${stack}\x00${form}\x00${domain}\x00${fn}`, "utf8")
    .digest();
  return toBase32(digest).slice(0, 20);
}
