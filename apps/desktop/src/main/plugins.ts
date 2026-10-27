/**
 * Plugin discovery. A plugin is just a folder with a manifest:
 *
 *   <userData>/plugins/my-plugin/
 *     cadenza.plugin.json
 *     index.js
 *
 * The renderer imports `index.js` through the `app://` protocol at
 * `/plugins/<folder>/<main>`, which resolves inside the plugin directory only.
 * Serving plugins from the app origin (instead of their own scheme) keeps the
 * renderer CSP at `script-src 'self'`.
 */

import fsp from "node:fs/promises";
import path from "node:path";
import type { PluginInfo, PluginManifest } from "@fanduck/cadenza-core";

const MANIFEST = "cadenza.plugin.json";

function isManifest(value: unknown): value is PluginManifest {
  if (!value || typeof value !== "object") return false;
  const m = value as Record<string, unknown>;
  return typeof m["id"] === "string" && typeof m["name"] === "string" && typeof m["version"] === "string" && typeof m["main"] === "string";
}

export function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 64);
}

export function pluginEntryUrl(pluginDir: string, manifest: PluginManifest): string {
  const folder = path.basename(pluginDir);
  const main = manifest.main.replace(/\\/g, "/").replace(/^\/+/, "");
  return `app://cadenza/plugins/${encodeURIComponent(folder)}/${main}`;
}

export async function listPlugins(pluginDir: string, errors: string[] = []): Promise<PluginInfo[]> {
  await fsp.mkdir(pluginDir, { recursive: true });
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = await fsp.readdir(pluginDir, { withFileTypes: true });
  } catch (error) {
    errors.push(`plugin folder: ${(error as Error).message}`);
    return [];
  }

  const infos: PluginInfo[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const dir = path.join(pluginDir, entry.name);
    try {
      const raw = await fsp.readFile(path.join(dir, MANIFEST), "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (!isManifest(parsed)) {
        errors.push(`${entry.name}: manifest is missing id/name/version/main`);
        continue;
      }
      const manifest: PluginManifest = { ...parsed, id: sanitizeId(parsed.id) };
      infos.push({
        manifest,
        entryUrl: pluginEntryUrl(dir, manifest),
        status: "discovered",
      });
    } catch (error) {
      errors.push(`${entry.name}: ${(error as Error).message}`);
    }
  }

  infos.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
  return infos;
}

export { MANIFEST };
