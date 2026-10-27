#!/usr/bin/env node
/**
 * Documentation link check.
 *
 * Every relative link and image in the Markdown files must point at a real file
 * in the repository; otherwise the README ships dead links, which is the most
 * common way an otherwise good project looks unfinished.
 *
 *   node scripts/check-links.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const IGNORED_DIRS = new Set(["node_modules", "dist", "release", ".git", ".tmp", ".tmp-scan-test"]);
const LINK_RE = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      walk(path.join(dir, entry.name), out);
    } else if (entry.name.endsWith(".md")) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

const files = walk(root, []);
const problems = [];
let checked = 0;

/** Links inside fenced code blocks are examples, not real links. */
function withoutCodeBlocks(text) {
  return text.replace(/^```[\s\S]*?^```/gm, "");
}

for (const file of files) {
  const text = withoutCodeBlocks(fs.readFileSync(file, "utf8"));
  const relative = path.relative(root, file).replace(/\\/g, "/");

  for (const match of text.matchAll(LINK_RE)) {
    const raw = match[1];
    if (!raw) continue;
    // External, anchors, and mailto are out of scope.
    if (/^(https?:|mailto:|tel:|data:)/i.test(raw) || raw.startsWith("#")) continue;

    const [target] = raw.split("#");
    if (!target) continue;

    checked += 1;
    const resolved = target.startsWith("/")
      ? path.join(root, target)
      : path.resolve(path.dirname(file), target);

    if (!fs.existsSync(resolved)) {
      problems.push(`${relative}: missing "${raw}"`);
    }
  }
}

if (problems.length > 0) {
  console.error(`link check FAILED (${problems.length} of ${checked} links):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(`link check passed: ${checked} relative links across ${files.length} markdown files`);
