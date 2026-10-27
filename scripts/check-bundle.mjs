#!/usr/bin/env node
/**
 * Bundle check - verifies that every module the renderer imports actually
 * resolves over HTTP, exactly like it will over `app://` at runtime.
 *
 * Catches the classic no-bundler failure: a wrong relative path, a missing
 * import-map entry, or a package that was not built.
 *
 *   node scripts/check-bundle.mjs
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = "/apps/desktop/dist/renderer/index.html";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");
      const file = path.join(root, url);
      if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404).end("not found");
        return;
      }
      res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, base: `http://127.0.0.1:${address.port}` });
    });
  });
}

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/g;
const BARE_IMPORT_RE = /(?:^|\n)\s*import\s+["']([^"']+)["']/g;

function specifiersIn(source) {
  const found = new Set();
  for (const re of [IMPORT_RE, BARE_IMPORT_RE]) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(source)) !== null) found.add(match[1]);
  }
  return [...found];
}

const { server, base } = await startServer();
const problems = [];
const seen = new Set();
const queue = [];

try {
  const html = await (await fetch(`${base}${ENTRY}`)).text();

  const mapMatch = /<script[^>]+type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (!mapMatch) problems.push("index.html has no <script type=\"importmap\">");
  const importMap = mapMatch ? JSON.parse(mapMatch[1]) : { imports: {} };

  // A CSP without the import map's hash silently blocks it: the map is ignored,
  // bare specifiers fail to resolve and the window stays blank. Catch it here.
  if (mapMatch) {
    const cspMeta = /<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]+content="([^"]*)"/i.exec(html);
    const policy = cspMeta?.[1] ?? "";
    const digest = crypto.createHash("sha256").update(mapMatch[1], "utf8").digest("base64");
    if (!policy.includes(`'sha256-${digest}'`)) {
      problems.push(
        `CSP does not allow the inline import map (expected 'sha256-${digest}' in script-src). ` +
          "The renderer will load, fail to resolve its imports and paint nothing.",
      );
    }
  }

  const scriptMatch = /<script[^>]+type=["']module["'][^>]+src=["']([^"']+)["']/i.exec(html);
  if (!scriptMatch) problems.push("index.html has no module script");

  const entryUrl = new URL(scriptMatch?.[1] ?? "./main.js", `${base}${ENTRY}`).href;
  queue.push(entryUrl);

  while (queue.length > 0) {
    const url = queue.shift();
    if (!url || seen.has(url)) continue;
    seen.add(url);

    const response = await fetch(url);
    if (!response.ok) {
      problems.push(`${response.status} ${new URL(url).pathname}`);
      continue;
    }
    const type = response.headers.get("content-type") ?? "";
    if (!type.includes("javascript")) {
      problems.push(`wrong content-type (${type}) for ${new URL(url).pathname}`);
      continue;
    }

    const source = await response.text();
    for (const specifier of specifiersIn(source)) {
      let target;
      if (specifier.startsWith(".") || specifier.startsWith("/")) {
        target = new URL(specifier, url).href;
      } else if (importMap.imports?.[specifier]) {
        target = new URL(importMap.imports[specifier], base).href;
      } else {
        problems.push(`bare specifier "${specifier}" not in import map (from ${new URL(url).pathname})`);
        continue;
      }
      if (!target.startsWith(base)) {
        problems.push(`module escapes the server root: ${specifier} -> ${target}`);
        continue;
      }
      queue.push(target);
    }
  }

  const cssLinks = [...html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["']/gi)].map((m) => m[1]);
  for (const href of cssLinks) {
    if (!href) continue;
    const url = href.startsWith("/") ? `${base}${href}` : new URL(href, `${base}${ENTRY}`).href;
    const response = await fetch(url);
    if (!response.ok) problems.push(`stylesheet ${response.status}: ${href}`);
  }

  console.log(`checked ${seen.size} modules and ${cssLinks.length} stylesheets`);
} finally {
  server.close();
}

if (problems.length > 0) {
  console.error("bundle check FAILED:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log("bundle check passed: every import resolves");
