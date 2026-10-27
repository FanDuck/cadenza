#!/usr/bin/env node
/**
 * Assemble a self-contained application folder in `release/app/`.
 *
 * Why not just point electron-builder at `apps/desktop`? Because the renderer is
 * served from the repository root (`app://cadenza/packages/...`), and a packaged
 * app must keep that layout. This script copies exactly what the runtime needs:
 *
 *   release/app/
 *     package.json                       main: apps/desktop/dist/main/index.js
 *     apps/desktop/dist/main/*.js        Electron main process
 *     apps/desktop/dist/shared/*.js
 *     apps/desktop/dist/renderer/*       compiled UI + index.html
 *     apps/desktop/src/preload.cjs
 *     apps/desktop/resources/*           icons
 *     packages/core/dist/*               imported by the renderer via app://
 *     packages/ui/dist/*, packages/ui/src/theme.css
 *
 * The layout intentionally mirrors the repository, because the renderer requests
 * `app://cadenza/packages/...` and `/apps/desktop/dist/renderer/...`.
 *
 * Run `pnpm package` afterwards (electron-builder) to turn it into an installer.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "release", "app");

function copy(from, to) {
  const source = path.join(root, from);
  if (!fs.existsSync(source)) {
    console.warn(`[package] missing ${from} - run "pnpm build" first`);
    return;
  }
  fs.cpSync(source, path.join(out, to), { recursive: true });
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

// Electron entry + compiled code, mirroring the repo layout.
copy("apps/desktop/dist/main", "apps/desktop/dist/main");
copy("apps/desktop/dist/shared", "apps/desktop/dist/shared");
copy("apps/desktop/dist/renderer", "apps/desktop/dist/renderer");
copy("apps/desktop/src/preload.cjs", "apps/desktop/src/preload.cjs");
copy("apps/desktop/resources", "apps/desktop/resources");

// Packages the renderer imports over app://.
copy("packages/core/dist", "packages/core/dist");
copy("packages/core/package.json", "packages/core/package.json");
copy("packages/ui/dist", "packages/ui/dist");
copy("packages/ui/src/theme.css", "packages/ui/src/theme.css");
copy("packages/ui/package.json", "packages/ui/package.json");

// A minimal package.json: electron-builder reads `main` and `version` from here.
const desktop = JSON.parse(fs.readFileSync(path.join(root, "apps/desktop/package.json"), "utf8"));
const manifest = {
  name: "cadenza",
  productName: "Cadenza",
  version: desktop.version,
  description: desktop.description,
  author: desktop.author,
  license: desktop.license,
  main: "apps/desktop/dist/main/index.js",
  type: "module",
  homepage: "https://github.com/FanDuck/cadenza",
};
fs.writeFileSync(path.join(out, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);

const bytes = (dir) => {
  let total = 0;
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else total += fs.statSync(full).size;
    }
  };
  walk(dir);
  return total;
};

console.log(`[package] app assembled at release/app (${(bytes(out) / 1024 / 1024).toFixed(1)} MB)`);
console.log('[package] next: npx electron-builder --win --config apps/desktop/electron-builder.yml');
