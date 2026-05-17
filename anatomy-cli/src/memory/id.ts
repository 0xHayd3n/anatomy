// src/memory/id.ts
// 8-char Crockford base32 entry id, derived from at + content hash.

import { createHash } from "node:crypto";

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

function toBase32(bytes: Buffer): string {
  let bits = 0n;
  let bitCount = 0;
  let out = "";
  for (const b of bytes) {
    bits = (bits << 8n) | BigInt(b);
    bitCount += 8;
  }
  while (bitCount >= 5) {
    bitCount -= 5;
    out += ALPHABET[Number((bits >> BigInt(bitCount)) & 0x1fn)];
  }
  if (bitCount > 0) {
    out += ALPHABET[Number((bits << BigInt(5 - bitCount)) & 0x1fn)];
  }
  return out;
}

/** First 8 chars of Crockford-base32 SHA-256(at NUL content). */
export function makeEntryId(at: string, content: string): string {
  const digest = createHash("sha256")
    .update(`${at}\x00${content}`, "utf8")
    .digest();
  return toBase32(digest).slice(0, 8);
}
