// src/ingest/shared-extractor.ts
// Heading-allowlist markdown walker. Reads a markdown text, finds H2/H3
// headings matching the rule-source allowlist, and extracts bullet-list
// items inside those sections as IngestedRule. Pure function.

import type { IngestedRule } from "./types.js";

const MAX_RULE_CHARS = 300;
const MAX_WHY_CHARS = 200;
const MAX_RULES = 20;

const HEADING_ALLOWLIST = new Set([
  "rules",
  "conventions",
  "guidelines",
  "code style",
  "code conventions",
  "project conventions",
  "coding rules",
  "coding conventions",
  "code guidelines",
]);

const WHY_PREFIX_RE = /^\s*(?:why|because|reason)\s*:\s*(.+)$/i;
const BULLET_RE = /^(\s*)[-*]\s+(.+)$/;
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*:?\s*$/;
const NUMBERED_LIST_RE = /^\s*\d+[.)]\s+/;

function normalizeHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/\p{Extended_Pictographic}/gu, "")
    .trim()
    .replace(/[:]+$/, "")
    .trim();
}

interface Bullet {
  text: string;
  why?: string;
  line: number;
  section: string;
  indent: number;
}

export function extractRules(text: string, file: string): IngestedRule[] {
  const lines = text.split(/\r?\n/);
  const bullets: Bullet[] = [];

  let inAllowed = false;
  let currentSection = "";
  let currentHeadingLevel = 0;
  let currentBullet: Bullet | null = null;
  let currentBulletIndent = -1;

  function flushBullet() {
    if (currentBullet) {
      bullets.push(currentBullet);
      currentBullet = null;
      currentBulletIndent = -1;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] ?? "";
    const line = rawLine.replace(/\s+$/, "");
    if (line === "") {
      flushBullet();
      continue;
    }

    const headingMatch = HEADING_RE.exec(line);
    if (headingMatch) {
      flushBullet();
      const level = headingMatch[1].length;
      const headingText = headingMatch[2];
      const normalized = normalizeHeading(headingText);
      if (HEADING_ALLOWLIST.has(normalized)) {
        inAllowed = true;
        currentSection = headingText;
        currentHeadingLevel = level;
      } else if (inAllowed && level <= currentHeadingLevel) {
        inAllowed = false;
        currentSection = "";
        currentHeadingLevel = 0;
      }
      continue;
    }

    if (!inAllowed) continue;

    if (NUMBERED_LIST_RE.test(line)) {
      flushBullet();
      continue;
    }

    const bulletMatch = BULLET_RE.exec(line);
    if (bulletMatch) {
      const indent = bulletMatch[1].length;
      const content = bulletMatch[2];

      if (currentBullet && indent > currentBulletIndent) {
        const whyMatch = WHY_PREFIX_RE.exec(content);
        if (whyMatch) {
          currentBullet.why = whyMatch[1].trim();
        }
        continue;
      }

      flushBullet();
      currentBullet = {
        text: content,
        line: i + 1,
        section: currentSection,
        indent,
      };
      currentBulletIndent = indent;
      continue;
    }

    if (currentBullet && /^\s+\S/.test(line) && line.replace(/^\s+/, "").length > 0) {
      currentBullet.text += " " + line.trim();
      continue;
    }

    flushBullet();
  }

  flushBullet();

  const taken = bullets.slice(0, MAX_RULES);
  if (bullets.length > MAX_RULES) {
    process.stderr.write(
      `anatomy ingest: ${file} yielded ${bullets.length} rules; capping at ${MAX_RULES}. ` +
      `Dropped: ${bullets.slice(MAX_RULES).map(b => `"${b.text.slice(0, 50)}..."`).join(", ")}\n`,
    );
  }

  return taken.map(b => {
    let rule = b.text;
    if (rule.length > MAX_RULE_CHARS) {
      process.stderr.write(
        `anatomy ingest: rule at ${file}:${b.line} exceeds ${MAX_RULE_CHARS} chars; ` +
        `truncating. Original: "${rule.slice(0, 80)}..."\n`,
      );
      rule = rule.slice(0, MAX_RULE_CHARS);
    }
    let why = b.why;
    if (why !== undefined && why.length > MAX_WHY_CHARS) {
      process.stderr.write(
        `anatomy ingest: why annotation at ${file}:${b.line} exceeds ${MAX_WHY_CHARS} chars; truncating.\n`,
      );
      why = why.slice(0, MAX_WHY_CHARS);
    }
    return {
      rule,
      ...(why ? { why } : {}),
      source: { file, line: b.line, section: b.section },
    };
  });
}
