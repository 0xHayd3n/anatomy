// src/io.ts
// Shared I/O helpers with size limits and BOM stripping.

import { readFileSync, statSync } from "node:fs";

const MAX_MANIFEST_BYTES = 1_000_000; // 1 MB — covers any realistic manifest
const MAX_README_BYTES = 1_000_000;   // 1 MB — covers any realistic README
const MAX_ANATOMY_BYTES = 200_000;    // 200 KB — .anatomy is a header, not a book
const MAX_ANATOMY_MEMORY_BYTES = 5_000_000; // 5 MB — append-only log; ~3300 max-size entries

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function readWithLimit(path: string, maxBytes: number, label: string): string {
  const size = statSync(path).size;
  if (size > maxBytes) {
    throw new Error(`${label} at ${path} is ${size} bytes; limit is ${maxBytes} bytes`);
  }
  return stripBom(readFileSync(path, "utf8"));
}

export function readManifest(path: string): string {
  return readWithLimit(path, MAX_MANIFEST_BYTES, "manifest");
}

export function readReadmeFile(path: string): string {
  return readWithLimit(path, MAX_README_BYTES, "README");
}

export function readAnatomyFile(path: string): string {
  return readWithLimit(path, MAX_ANATOMY_BYTES, ".anatomy");
}

export function readAnatomyMemoryFile(path: string): string {
  return readWithLimit(path, MAX_ANATOMY_MEMORY_BYTES, ".anatomy-memory");
}
