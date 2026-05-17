// src/pass1/tagline.ts
// Tagline + description derivation per spec §4.2 step 3-4.
// Tagline: first non-blank, non-heading README line truncated on word
// boundary at <=120 chars; fallback to manifest.description; fallback to
// "todo-tagline" placeholder.
// Description: manifest.description (if longer than tagline) OR README first
// paragraph (if <=2000 chars after stripping headings); else omitted.

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { DetectedManifest, Pass1Result } from "../types.js";
import { readReadmeFile } from "../io.js";
import { debug } from "../log.js";
import { smartTruncateLine } from "../text-utils.js";

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? v as Record<string, unknown> : {};
}

function manifestDescription(manifest: DetectedManifest | null): string | undefined {
  if (!manifest) return undefined;
  const p = asObj(manifest.parsed);
  if (manifest.kind === "npm" && typeof p.description === "string") return p.description;
  if (manifest.kind === "cargo") {
    const pkg = asObj(p.package);
    if (typeof pkg.description === "string") return pkg.description;
  }
  if (manifest.kind === "pyproject") {
    const project = asObj(p.project);
    if (typeof project.description === "string") return project.description;
  }
  return undefined;
}

function readReadme(repoRoot: string): string | null {
  for (const name of ["README.md", "README.rst", "README.txt", "README"]) {
    const path = join(repoRoot, name);
    if (existsSync(path)) {
      try {
        return readReadmeFile(path);
      } catch {
        return null;
      }
    }
  }
  return null;
}

// Markdown badge/image lines: [![alt](badgeUrl)](href), [![Logo](url)],
// or bare ![alt](url). Common at the top of popular OSS READMEs.
const MARKDOWN_BADGE_LINE = /^\s*\[?!?\[[^\]]*\]\([^)]*\)\]?(\([^)]*\))?\s*$/;

// HTML attribute continuation: a line that's purely an HTML attribute
// (e.g. axios's README has <a on one line, href="..." on the next).
// No-spaces-around-= is the standard HTML form (`href="..."`); requiring
// it avoids over-matching TOML/YAML config lines (`key = "value"`,
// `version = "1.0"`) that might appear at the top of some READMEs.
const HTML_ATTR_LINE = /^\s*[a-z][a-z0-9-]*="[^"]*"\s*$/;

// Structural pre-pass: removes whole-block decorations from README text
// before the line-local filter runs. Each rule handles a multi-line construct
// that the line filter can't see.
//
// Order matters:
//  - HTML comments first (so a fake </p> inside a comment can't fool the
//    HTML-block rule).
//  - HTML blocks before badges (badges often sit inside <p align="center">).
//  - Self-closing/void HTML before the bare-image rule (the void rule strips
//    <br>, <img />, etc. that don't have a paired close tag).
//  - Badge-as-link [![...](...)](url) before bare image ![...](...) (the
//    badge form contains an image inside it; stripping the bare image first
//    would leave dangling [...](url) link syntax).
//  - Reference-link defs and table rows are line-anchored and order-insensitive
//    relative to the rest.
function stripReadmeDecorations(text: string): string {
  return text
    // RST title block (overline + text + underline) — three-line pattern is
    // unambiguous (markdown has no overline). Strip the whole block; without
    // this, the picked line becomes either the decorator (======) or the bare
    // title text (Django) — neither is the prose tagline we want. The full
    // docutils adornment set is =-`:'"~^_*+#<>.; we use the safe subset
    // (HTML and YAML/key-value chars excluded to avoid false matches).
    .replace(/^[=\-~`^"+*#_.]{3,}\s*\n[^\n]+\n[=\-~`^"+*#_.]{3,}\s*$/gm, "")
    // RST directive block: a line starting with `..` plus any indented
    // continuation lines below it. Catches scikit-learn's substitution
    // definitions (`.. |GH| image:: url\n   :target: link`) and Emacs file-
    // mode comments (`.. -*- mode: rst -*-`).
    .replace(/^\s*\.\.[^\n]*(?:\n[ \t]+[^\n]*)*/gm, "")
    // Markdown fenced code blocks (``` or ```language ... ```). Strip the
    // whole block — neither the fence markers nor the code inside is ever
    // a tagline. astro's README opens with a `bash` install snippet that
    // pre-fix surfaced "```bash" as the picked tagline.
    // MUST run before the standalone-decorator rule below — that rule
    // strips bare ``` lines as decorator chars, which would prevent the
    // code-block close fence from being found by this rule.
    .replace(/^```[\s\S]*?^```\s*$/gm, "")
    // Standalone decorator lines: RST title underlines without overline AND
    // markdown horizontal rules (---). Neither is ever a tagline.
    .replace(/^\s*[=\-~`^"+*_.]{3,}\s*$/gm, "")
    .replace(/<!--[\s\S]*?-->/g, "")                          // HTML comments
    // Multi-line HTML blocks. The (?=[\s/>]) lookahead requires the next char
    // after the tag name to be a tag-valid char (whitespace, /, >). Excludes
    // RFC auto-links like <https://example.com> where `:` follows the
    // tag-name match. Length cap of {0,15} matches realistic HTML tag names
    // (longest standard ~10 chars) and prevents URL-like substrings from
    // matching long tag-name patterns.
    .replace(/<([a-z][\w-]{0,15})(?=[\s/>])[^>]*>[\s\S]*?<\/\1>/gi, "")
    // Self-closing / void HTML — same lookahead + length-cap precision.
    .replace(/<[a-z][\w-]{0,15}(?=[\s/>])[^>]*\/?>/gi, "")
    .replace(/\[!\[[^\]]*\]\([\s\S]*?\)\]\([^)]*\)/g, "")     // [![Badge](url)](url) incl. multi-line
    .replace(/\[!\[[^\]]*\]\[[^\]]*\]\]\([^)]*\)/g, "")       // [![Badge][ref]](url) — ref-style
                                                              // internal image (tree-sitter shape).
                                                              // Inner [ref] resolves to a URL via
                                                              // a `[ref]: url` def stripped earlier.
    .replace(/!\[[^\]]*\]\([\s\S]*?\)/g, "")                  // ![alt](url) incl. multi-line URL
    .replace(/^\s*\[[^\]]+\]:\s+\S+.*$/gm, "")                // [label]: url ref-defs
    // Pipe-separated markdown-link nav rows: `[Foo](url) | [Bar](url) | [Baz](url)`.
    // The 11th-sweep separator-list rule caps tokens at 30 chars; markdown-link
    // tokens are usually longer. Require 2+ links so isolated `[text](url) |`
    // shapes don't match here (that's still the trailing-pipe rule's job).
    .replace(/^\s*\[[^\]]+\]\([^)]+\)(?:\s*\|\s*\[[^\]]+\]\([^)]+\))+\s*$/gm, "")
    .replace(/^[^\n]*\|\s*$/gm, "")                           // table rows — any line ending with |
                                                              // (catches both standard `| Col1 | Col2 |`
                                                              // and lodash-style `[Site](url) |`)
    // Horizontal separator-list lines: "Token | Token | Token" with multiple
    // short tokens between pipes. Catches language switchers (helmfile:
    // `English | 简体中文`), navigation rows, and link-list rows that don't
    // end with a trailing pipe. Each token capped at 30 chars to avoid
    // matching prose with embedded pipes.
    .replace(/^[^\n|]{1,30}(?:\s*\|\s*[^\n|]{1,30}){1,}$/gm, "");
}

function firstNonBlankNonHeadingLine(text: string): string | null {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0) continue;
    if (line.startsWith("#")) continue;        // markdown heading
    if (line.startsWith("<")) continue;        // HTML tag open (logo/badge markup)
    if (line === ">") continue;                // pure HTML close-tag fragment on its own line
                                                // (axios shape: `<a\n  href="..."\n>`). Markdown
                                                // blockquote `> content` is preserved here and the
                                                // `> ` prefix is stripped in post-pick.
    if (MARKDOWN_BADGE_LINE.test(line)) continue;  // [![Badge](url)](url) etc.
    if (HTML_ATTR_LINE.test(line)) continue;       // multi-line tag attribute
    if (line.endsWith(":")) continue;              // introducer/header line (e.g. "A few links:")
    if (/^[-*]\s/.test(line)) continue;            // markdown bullet item ("- foo" or "* foo")
                                                    // The trailing space requirement avoids matching
                                                    // emphasis ("*italic*"); emphasis lines have no
                                                    // space after the leading marker.
    return line;
  }
  return null;
}

// Strip inline markdown link syntax [text](url) -> text. Applied after
// picking a tagline so README lines like "framework for managing
// [zsh](https://www.zsh.org/)" don't carry raw markdown into output.
// Also handles reference-style forms [text][ref] and [text][] — the
// matching [label]: url definition lines are stripped earlier by the
// pre-pass, but the inline references in prose survive otherwise.
function stripInlineMarkdownLinks(s: string): string {
  return s
    // Markdown blockquote prefix `> ` — used as a stylized tagline marker
    // by some READMEs (clap: `> **Command Line Argument Parser for Rust**`).
    // The line filter preserves blockquotes-with-content; this strip cleans
    // the `> ` decorator after pick.
    .replace(/^>\s+/, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")    // [text](url) -> text
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")   // [text][ref] and [text][] -> text
    // Markdown emphasis markers — strip in pairs from outside in. Bold first
    // (** / __) before italic (* / _) so doubled markers don't get half-
    // consumed. The italic regex's [^*\n] / [^_\n] prevents matching across
    // line breaks (single * or _ is more ambiguous than the doubled form).
    .replace(/\*\*([^*]+)\*\*/g, "$1")          // **bold** -> bold
    .replace(/__([^_]+)__/g, "$1")              // __bold__ -> bold
    .replace(/\*([^*\n]+)\*/g, "$1")            // *italic* -> italic
    .replace(/_([^_\n]+)_/g, "$1")              // _italic_ -> italic
    .replace(/~~([^~]+)~~/g, "$1");             // ~~strike~~ -> strike
}

function firstParagraph(readme: string): string | null {
  // Split on blank lines; take the first paragraph that isn't a heading or HTML block.
  const paragraphs = readme.split(/\r?\n\s*\r?\n/);
  for (const para of paragraphs) {
    const cleaned = para.split(/\r?\n/)
      .filter(l => !l.trim().startsWith("#") && !l.trim().startsWith("<"))
      .join(" ")
      .trim();
    if (cleaned.length > 0) return cleaned;
  }
  return null;
}

export function deriveTagline(manifest: DetectedManifest | null, repoRoot: string): {
  tagline: Pass1Result["tagline"];
  description?: string;
} {
  const readme = readReadme(repoRoot);
  const cleanedReadme = readme ? stripReadmeDecorations(readme) : null;
  const readmeFirst = cleanedReadme ? firstNonBlankNonHeadingLine(cleanedReadme) : null;
  const manifestDesc = manifestDescription(manifest);

  let tagline: Pass1Result["tagline"];
  if (readmeFirst) {
    tagline = {
      value: smartTruncateLine(stripInlineMarkdownLinks(readmeFirst), 120),
      isPlaceholder: false,
      source: "readme",
    };
  } else if (manifestDesc) {
    tagline = {
      value: smartTruncateLine(manifestDesc, 120),
      isPlaceholder: false,
      source: "manifest-description",
    };
  } else {
    tagline = { value: "todo-tagline", isPlaceholder: true, source: "placeholder" };
  }
  debug(`tagline: source=${tagline.source} value=${JSON.stringify(tagline.value).slice(0, 80)}`);

  // Description: prefer manifest description if longer than the tagline.
  // Schema caps description at 500 chars; smart-truncate on word/sentence
  // boundary to fit. Pre-fix, the <= 2000 gate let through 500-2000-char
  // descriptions that triggered description-too-long at validate time
  // (gin: 1107 chars from manifest).
  let description: string | undefined;
  if (manifestDesc && manifestDesc.length > tagline.value.length) {
    description = smartTruncateLine(manifestDesc, 500);
  } else if (cleanedReadme) {
    const para = firstParagraph(cleanedReadme);
    if (para && para.length > tagline.value.length) {
      description = smartTruncateLine(para, 500);
    }
  }

  return { tagline, description };
}
