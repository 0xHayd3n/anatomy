import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveTagline } from "../src/pass1/tagline.js";
import type { DetectedManifest } from "../src/types.js";

const npm = (parsed: object): DetectedManifest => ({ kind: "npm", path: "", parsed });

describe("deriveTagline — sources", () => {
  it("readme first non-heading line wins", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-t-"));
    writeFileSync(join(root, "README.md"), "# Title\n\nA tiny lib for X.\n");
    const r = deriveTagline(npm({ name: "x", description: "fallback" }), root);
    expect(r.tagline.value).toBe("A tiny lib for X.");
    expect(r.tagline.source).toBe("readme");
    expect(r.tagline.isPlaceholder).toBe(false);
  });

  it("falls back to manifest description when readme missing", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-t-"));
    const r = deriveTagline(npm({ name: "x", description: "Manifest text." }), root);
    expect(r.tagline.value).toBe("Manifest text.");
    expect(r.tagline.source).toBe("manifest-description");
  });

  it("falls back to placeholder when both missing", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-t-"));
    const r = deriveTagline(npm({ name: "x" }), root);
    expect(r.tagline.value).toBe("todo-tagline");
    expect(r.tagline.source).toBe("placeholder");
    expect(r.tagline.isPlaceholder).toBe(true);
  });

  it("truncates at 120 chars on word boundary", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-t-"));
    writeFileSync(join(root, "README.md"), "x ".repeat(100) + "end\n");
    const r = deriveTagline(null, root);
    expect(r.tagline.value.length).toBeLessThanOrEqual(120);
    expect(r.tagline.value.endsWith(" ")).toBe(false);
  });

  it("skips markdown badge lines [![Badge](url)](url)", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-t-"));
    writeFileSync(
      join(root, "README.md"),
      "[![License](https://img.shields.io/npm/l/svelte.svg)](LICENSE.md)\n[![Build](https://example.com/build.svg)](https://example.com)\n\nA real description sentence.\n",
    );
    const r = deriveTagline(null, root);
    expect(r.tagline.value).toBe("A real description sentence.");
    expect(r.tagline.source).toBe("readme");
  });

  it("skips bare image lines ![alt](url)", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-t-"));
    writeFileSync(
      join(root, "README.md"),
      "![llama](https://user-images.githubusercontent.com/1991296/230134379.png)\n\nllama.cpp inference in pure C/C++.\n",
    );
    const r = deriveTagline(null, root);
    expect(r.tagline.value).toBe("llama.cpp inference in pure C/C++.");
  });

  it("skips HTML attribute continuation lines (multi-line tag)", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-t-"));
    // Mirrors axios's README: <a tag opens, attributes on subsequent lines.
    writeFileSync(
      join(root, "README.md"),
      `<h3 align="center">Sponsors</h3>\n<a\n    href="https://thanks.dev/?utm_source=axios"\n    target="_blank"\n>\n\nPromise based HTTP client for the browser and node.js.\n`,
    );
    const r = deriveTagline(null, root);
    expect(r.tagline.value).toBe("Promise based HTTP client for the browser and node.js.");
  });

  it("strips inline markdown link syntax [text](url) from chosen tagline", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-t-"));
    writeFileSync(
      join(root, "README.md"),
      "Oh My Zsh is a framework for managing your [zsh](https://www.zsh.org/) config.\n",
    );
    const r = deriveTagline(null, root);
    expect(r.tagline.value).toBe("Oh My Zsh is a framework for managing your zsh config.");
  });
});

describe("deriveTagline — description", () => {
  it("emits description when manifest desc is longer than tagline", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-t-"));
    writeFileSync(join(root, "README.md"), "# Title\n\nShort.\n");
    const r = deriveTagline(npm({ name: "x", description: "A much longer description than the tagline." }), root);
    expect(r.description).toBe("A much longer description than the tagline.");
  });

  it("omits description when nothing longer than tagline available", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-t-"));
    writeFileSync(join(root, "README.md"), "# Title\n\nA reasonable tagline that isn't beaten by anything.\n");
    const r = deriveTagline(npm({ name: "x", description: "Short." }), root);
    expect(r.description).toBeUndefined();
  });

  it("smart-truncates description over 500 chars to fit schema cap", () => {
    const longDesc = "Gin is a HTTP web framework written in Go (Golang). " +
      "It features a Martini-like API with much better performance -- up to 40 times faster. ".repeat(15);
    // longDesc is well over 500 chars.
    expect(longDesc.length).toBeGreaterThan(500);
    const root = mkdtempSync(join(tmpdir(), "anat-t-"));
    const r = deriveTagline(npm({ name: "gin", description: longDesc }), root);
    expect(r.description).toBeDefined();
    expect(r.description!.length).toBeLessThanOrEqual(500);
    // smartTruncateLine trims trailing connectors → no trailing whitespace.
    expect(r.description!.endsWith(" ")).toBe(false);
  });
});

describe("deriveTagline — README structural pre-pass (9th sweep)", () => {
  it("skips markdown table rows (lodash shape)", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-t-"));
    writeFileSync(
      join(root, "README.md"),
      "# lodash v4.18.1\n\n[Site](https://lodash.com/) |\n[Docs](https://lodash.com/docs) |\n[FP Guide](https://example.com) |\n\nA modern JavaScript utility library delivering modularity, performance & extras.\n",
    );
    const r = deriveTagline(null, root);
    expect(r.tagline.value).toBe("A modern JavaScript utility library delivering modularity, performance & extras.");
  });

  it("skips multi-line HTML block with mid-line close tag (prometheus shape)", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-t-"));
    writeFileSync(
      join(root, "README.md"),
      `<h1 align="center">Prometheus</h1>\n\n<p align="center">Visit <a href="https://prometheus.io">prometheus.io</a> for the full documentation,\nexamples and guides.</p>\n\nThe Prometheus monitoring system and time series database.\n`,
    );
    const r = deriveTagline(null, root);
    expect(r.tagline.value).toBe("The Prometheus monitoring system and time series database.");
  });

  it("skips self-closing HTML fragment '/>' on its own line (fastify shape)", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-t-"));
    writeFileSync(
      join(root, "README.md"),
      `<div align="center"> <a href="https://fastify.dev/">\n    <img\n      src="https://example.com/logo.svg"\n      width="650"\n      height="auto"\n    />\n  </a>\n</div>\n\nFast and low overhead web framework, for Node.js.\n`,
    );
    const r = deriveTagline(null, root);
    expect(r.tagline.value).toBe("Fast and low overhead web framework, for Node.js.");
  });

  it("skips markdown reference-link definitions (nestjs/nest shape)", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-t-"));
    writeFileSync(
      join(root, "README.md"),
      `<p align="center">\n  <a href="https://nestjs.com/" target="_blank"><img src="logo.svg" /></a>\n</p>\n\n[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123\n[circleci-url]: https://circleci.com/gh/nestjs/nest\n\nA progressive Node.js framework for building efficient and scalable server-side applications.\n`,
    );
    const r = deriveTagline(null, root);
    expect(r.tagline.value).toBe("A progressive Node.js framework for building efficient and scalable server-side applications.");
  });

  it("skips multi-line markdown image with URL on next line (numpy shape)", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-t-"));
    writeFileSync(
      join(root, "README.md"),
      `<h1 align="center">\n<img src="https://example.com/numpylogo.svg" width="300">\n</h1>\n\n[![Powered by NumFOCUS](https://img.shields.io/badge/powered%20by-NumFOCUS-orange.svg)](\nhttps://numfocus.org)\n[![PyPI Downloads](https://img.shields.io/pypi/dm/numpy.svg)](\nhttps://pypi.org/project/numpy/)\n\nFundamental package for scientific computing with Python.\n`,
    );
    const r = deriveTagline(null, root);
    expect(r.tagline.value).toBe("Fundamental package for scientific computing with Python.");
  });
});

describe("deriveTagline — RST + reference-style links (10th sweep)", () => {
  it("skips RST title block (overline + text + underline) — django shape", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-t-"));
    writeFileSync(
      join(root, "README.md"),
      "======\nDjango\n======\n\nDjango is a high-level Python web framework that encourages rapid development.\n",
    );
    const r = deriveTagline(null, root);
    expect(r.tagline.value).toBe("Django is a high-level Python web framework that encourages rapid development.");
  });

  it("skips RST file-mode comments and directive blocks with indented continuation — scikit-learn shape", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-t-"));
    writeFileSync(
      join(root, "README.md"),
      `.. -*- mode: rst -*-\n\n|GitHubActions| |Codecov| |CircleCI|\n\n.. |GitHubActions| image:: https://github.com/example/actions.svg\n   :target: https://github.com/example/actions\n   :alt: Actions\n\nA Python machine learning library.\n`,
    );
    const r = deriveTagline(null, root);
    expect(r.tagline.value).toBe("A Python machine learning library.");
  });

  it("strips reference-style inline links [text][ref] and [text][] — hugo shape", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-t-"));
    writeFileSync(
      join(root, "README.md"),
      "[bep]: https://github.com/bep\n[friends]: https://example.com/friends\n\nA static site generator built by [bep][] and [friends][] in Go.\n",
    );
    const r = deriveTagline(null, root);
    expect(r.tagline.value).toBe("A static site generator built by bep and friends in Go.");
  });
});

describe("deriveTagline — markdown emphasis + separators + introducer (11th sweep)", () => {
  it("strips markdown emphasis (**bold**, *italic*, __bold__, _italic_, ~~strike~~)", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-t-"));
    writeFileSync(
      join(root, "README.md"),
      "**Pandas** is a *fast* __open-source__ _data_ ~~framework~~ analysis library.\n",
    );
    const r = deriveTagline(null, root);
    expect(r.tagline.value).toBe("Pandas is a fast open-source data framework analysis library.");
  });

  it("skips horizontal separator-list lines (helmfile language-switcher shape)", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-t-"));
    writeFileSync(
      join(root, "README.md"),
      "English | 简体中文 | 日本語\n\nA Helm chart manager for Kubernetes.\n",
    );
    const r = deriveTagline(null, root);
    expect(r.tagline.value).toBe("A Helm chart manager for Kubernetes.");
  });

  it("skips introducer lines ending with ':' (lerna shape)", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-t-"));
    writeFileSync(
      join(root, "README.md"),
      "# Lerna\n\nA few links to help you get started:\n\n[Foo](https://example.com)\n\nLerna is a monorepo manager for JavaScript.\n",
    );
    const r = deriveTagline(null, root);
    expect(r.tagline.value).toBe("Lerna is a monorepo manager for JavaScript.");
  });
});

describe("deriveTagline — auto-links + bullets + link-rows (12th sweep)", () => {
  it("preserves RFC auto-link <https://...> in prose (phoenix shape)", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-t-"));
    writeFileSync(
      join(root, "README.md"),
      "See the official site at <https://example.com>.\n",
    );
    const r = deriveTagline(null, root);
    // The behavior we verify: the URL survives the pre-pass (pre-fix it
    // was eaten as if HTML, leaving "See the official site at ."). The
    // angle brackets are punctuation around the URL — stripInlineMarkdownLinks
    // only handles [text](url) / [text][ref] forms, so the brackets remain.
    expect(r.tagline.value).toBe("See the official site at <https://example.com>.");
  });

  it("skips lines of pipe-separated markdown links (opentofu nav-row shape)", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-t-"));
    writeFileSync(
      join(root, "README.md"),
      "[Homepage](https://example.com) | [Slack](https://example.com/slack) | [Get Started](https://example.com/start)\n\nA real description of the project.\n",
    );
    const r = deriveTagline(null, root);
    expect(r.tagline.value).toBe("A real description of the project.");
  });

  it("skips markdown bullet lines starting with '- ' or '* ' (ant-design/mocha shape)", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-t-"));
    writeFileSync(
      join(root, "README.md"),
      "# Title\n\n- 🌈 Enterprise UI feature one\n- 📦 Component library\n* Plain bullet item\n\nA real description here.\n",
    );
    const r = deriveTagline(null, root);
    expect(r.tagline.value).toBe("A real description here.");
  });
});

describe("deriveTagline — code fences + blockquotes (13th sweep)", () => {
  it("strips fenced code blocks from pre-pass (astro shape)", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-t-"));
    writeFileSync(
      join(root, "README.md"),
      "# Astro\n\n```bash\nnpm create astro@latest\n```\n\nA real description here.\n",
    );
    const r = deriveTagline(null, root);
    expect(r.tagline.value).toBe("A real description here.");
  });

  it("preserves markdown blockquote-as-tagline (clap shape) and strips leading > prefix", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-t-"));
    writeFileSync(
      join(root, "README.md"),
      "# clap\n\n> **Command Line Argument Parser for Rust**\n\n[![Crates.io](https://example.com/badge.svg)](https://example.com)\n",
    );
    const r = deriveTagline(null, root);
    expect(r.tagline.value).toBe("Command Line Argument Parser for Rust");
  });
});

describe("deriveTagline — ref-style badge + cargo implicit (14th sweep)", () => {
  it("strips reference-style internal image badge form (tree-sitter shape)", () => {
    const root = mkdtempSync(join(tmpdir(), "anat-t-"));
    writeFileSync(
      join(root, "README.md"),
      "# tree-sitter\n\n[![DOI](https://zenodo.org/badge/14164618.svg)](https://zenodo.org/badge/latestdoi/14164618)\n[![discord][discord]](https://discord.gg/w7nTvsVJhm)\n[![matrix][matrix]](https://matrix.to/#/#tree-sitter-chat:matrix.org)\n\n[discord]: https://example.com/discord-badge.svg\n[matrix]: https://example.com/matrix-badge.svg\n\nA parser generator tool and an incremental parsing library.\n",
    );
    const r = deriveTagline(null, root);
    expect(r.tagline.value).toBe("A parser generator tool and an incremental parsing library.");
  });
});
