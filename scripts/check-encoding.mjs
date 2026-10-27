#!/usr/bin/env node
/**
 * Text integrity check.
 *
 * Editors and shells disagree about encodings often enough that a mojibake
 * character has already slipped into this repository once (an em dash read as
 * ANSI and written back as UTF-8). This fails the build on:
 *
 * - U+FFFD (a byte sequence that could not be decoded)
 * - the usual "UTF-8 read as GBK" garbage sequences
 * - a UTF-8 BOM, which makes PowerShell 5 and some tools misbehave
 *
 *   node scripts/check-encoding.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const IGNORED_DIRS = new Set(["node_modules", "dist", "release", ".git", ".tmp", ".tmp-scan-test"]);
const EXTENSIONS = new Set([".md", ".ts", ".js", ".mjs", ".cjs", ".json", ".css", ".html", ".yml", ".yaml", ".py", ".txt", ".svg"]);

/**
 * Sequences produced by decoding UTF-8 bytes as GBK/CP936. Written as escapes so
 * this file stays readable and does not trip its own check.
 */
const MOJIBAKE = /\u9225|\u951B|\u9286|\u923E|\u9983|\u9428|\u93C2|\u935C|\u6D63|\u951F\u65A4\u62F7|\u00EF\u00BF\u00BD/;

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      walk(path.join(dir, entry.name), out);
    } else if (EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

const files = walk(root, []);
const problems = [];

for (const file of files) {
  const relative = path.relative(root, file).replace(/\\/g, "/");
  const bytes = fs.readFileSync(file);

  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    problems.push(`${relative}: starts with a UTF-8 BOM`);
    continue;
  }

  const text = bytes.toString("utf8");
  if (text.includes("\uFFFD")) {
    problems.push(`${relative}: contains U+FFFD, the file is not valid UTF-8`);
    continue;
  }

  const match = MOJIBAKE.exec(text);
  if (match) {
    const line = text.slice(0, match.index).split("\n").length;
    problems.push(`${relative}:${line}: mojibake "${match[0]}" (file was written in the wrong encoding)`);
  }
}

if (problems.length > 0) {
  console.error(`encoding check FAILED (${problems.length} problem(s)):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(`encoding check passed: ${files.length} text files are clean UTF-8 without BOM`);
