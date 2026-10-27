/**
 * Custom protocols used by the renderer.
 *
 * - `app://cadenza/...`         static files of the app (repo root in dev)
 * - `cadenza-media://<id>/...`  audio files, with HTTP range support so seeking works
 * - `cadenza-plugin://<id>/...` plugin folders from the user data directory
 *
 * Everything is path-checked: a malicious playlist must not be able to read
 * `C:\Windows\...` through our own protocol.
 */

import { protocol, net } from "electron";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";

export const APP_ORIGIN = "app://cadenza";
export const MEDIA_SCHEME = "cadenza-media";
export const PLUGIN_SCHEME = "cadenza-plugin";

const MEDIA_EXTENSIONS = new Set([
  ".mp3", ".flac", ".wav", ".m4a", ".m4b", ".aac", ".ogg", ".oga", ".opus", ".wma", ".aiff", ".aif",
]);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".flac": "audio/flac",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".opus": "audio/ogg",
};

/** Must run before `app.ready`. */
export function registerSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "app",
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
    },
    {
      scheme: MEDIA_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
    },
    {
      scheme: PLUGIN_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
    },
  ]);
}

function mimeFor(file: string): string {
  return MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

/** Reject anything that escapes `root`. Returns null when unsafe. */
function safeJoin(root: string, relative: string): string | null {
  const decoded = decodeURIComponent(relative).replace(/^\/+/, "");
  const target = path.resolve(root, decoded);
  const normalRoot = path.resolve(root);
  const withSep = normalRoot.endsWith(path.sep) ? normalRoot : normalRoot + path.sep;
  if (target === normalRoot || target.startsWith(withSep)) return target;
  return null;
}

function notFound(): Response {
  return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
}

/** Serve one file with Range support, so <audio> can seek without buffering everything. */
async function serveFile(file: string, request: Request): Promise<Response> {
  let stat: fs.Stats;
  try {
    stat = await fsp.stat(file);
  } catch {
    return notFound();
  }
  if (!stat.isFile()) return notFound();

  const type = mimeFor(file);
  const range = request.headers.get("range");
  const baseHeaders: Record<string, string> = {
    "content-type": type,
    "accept-ranges": "bytes",
    "cache-control": "no-cache",
    "access-control-allow-origin": "*",
  };

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!match) return new Response(null, { status: 416, headers: { ...baseHeaders, "content-range": `bytes */${stat.size}` } });
    const startRaw = match[1] ?? "";
    const endRaw = match[2] ?? "";
    let start = startRaw === "" ? 0 : Number(startRaw);
    let end = endRaw === "" ? stat.size - 1 : Number(endRaw);
    if (startRaw === "" && endRaw !== "") {
      // suffix range: last N bytes
      start = Math.max(0, stat.size - Number(endRaw));
      end = stat.size - 1;
    }
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= stat.size) {
      return new Response(null, { status: 416, headers: { ...baseHeaders, "content-range": `bytes */${stat.size}` } });
    }
    end = Math.min(end, stat.size - 1);
    const stream = fs.createReadStream(file, { start, end });
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers: {
        ...baseHeaders,
        "content-length": String(end - start + 1),
        "content-range": `bytes ${start}-${end}/${stat.size}`,
      },
    });
  }

  const stream = fs.createReadStream(file);
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers: { ...baseHeaders, "content-length": String(stat.size) },
  });
}

export interface ProtocolOptions {
  /** Directory that `app://` serves. Usually the repo root or the packaged app root. */
  webRoot: string;
  pluginDir: string;
}

export function registerProtocols(options: ProtocolOptions): void {
  protocol.handle("app", async (request) => {
    const url = new URL(request.url);
    // Plugin modules are served under the SAME origin as the app. That keeps
    // `script-src 'self'` strict: `cadenza-plugin://` would need its own CSP
    // exception, and a plugin is trusted code anyway.
    if (url.pathname.startsWith("/plugins/")) {
      const target = safeJoin(options.pluginDir, url.pathname.slice("/plugins/".length));
      if (!target) return notFound();
      return serveFile(target, request);
    }
    const target = safeJoin(options.webRoot, url.pathname);
    if (!target) return notFound();
    return serveFile(target, request);
  });

  protocol.handle(MEDIA_SCHEME, async (request) => {
    const url = new URL(request.url);
    // cadenza-media://file/<encoded absolute path>
    const encoded = url.pathname.replace(/^\/+/, "");
    const file = decodeURIComponent(encoded);
    if (!file) return notFound();
    if (!MEDIA_EXTENSIONS.has(path.extname(file).toLowerCase())) return notFound();
    return serveFile(path.resolve(file), request);
  });

  protocol.handle(PLUGIN_SCHEME, async (request) => {
    const url = new URL(request.url);
    const host = url.hostname;
    if (!host || host.includes("..")) return notFound();
    const target = safeJoin(path.join(options.pluginDir, host), url.pathname);
    if (!target) return notFound();
    return serveFile(target, request);
  });
}

/** URL the renderer uses to fetch a media file. */
export function mediaUrlFor(file: string): string {
  return `${MEDIA_SCHEME}://file/${encodeURIComponent(path.resolve(file))}`;
}

/** Fallback for file types the media protocol refuses (e.g. artwork on disk). */
export function fileUrlFor(file: string): string {
  return pathToFileURL(path.resolve(file)).href;
}

export { net };
