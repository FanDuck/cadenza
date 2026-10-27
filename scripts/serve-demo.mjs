#!/usr/bin/env node
/**
 * Tiny static server for the browser demo (no dependencies).
 *
 *   node scripts/serve-demo.mjs [--port 5199] [--open]
 *
 * It serves the repository root, so the absolute imports used by the renderer
 * (`/packages/core/dist/index.js`, `/apps/desktop/dist/renderer/main.js`) work
 * exactly like they do over the `app://` protocol in Electron.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const portArg = args.indexOf("--port");
const port = portArg >= 0 ? Number(args[portArg + 1]) : Number(process.env.PORT ?? 5199);
const DEMO_ENTRY = "/apps/desktop/dist/renderer/index.html";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
};

function safePath(urlPath) {
  const clean = decodeURIComponent(urlPath.split("?")[0] ?? "/");
  const file = path.join(root, clean);
  const normalRoot = root.endsWith(path.sep) ? root : root + path.sep;
  return file === root || file.startsWith(normalRoot) ? file : null;
}

const server = http.createServer((req, res) => {
  const url = req.url ?? "/";
  if (url === "/" || url === "/index.html") {
    res.writeHead(302, { location: DEMO_ENTRY });
    res.end();
    return;
  }

  const file = safePath(url);
  if (!file) {
    res.writeHead(403).end("forbidden");
    return;
  }

  fs.stat(file, (error, stat) => {
    if (error || !stat.isFile()) {
      res.writeHead(404, { "content-type": "text/plain" }).end("not found");
      return;
    }
    res.writeHead(200, {
      "content-type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    fs.createReadStream(file).pipe(res);
  });
});

server.listen(port, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${port}/`;
  console.log(`Cadenza demo running at ${url}`);
  console.log("Tip: the demo uses sample data - no audio files are touched.");
});
