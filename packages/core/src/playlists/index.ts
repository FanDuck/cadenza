/**
 * Playlist readers and writers: M3U/M3U8 and PLS.
 *
 * Both formats are plain text and store paths exactly as the authoring player
 * saw them: absolute or relative, with either slash style. Parsers can resolve
 * relative entries against the playlist's own directory when `baseDir` is
 * supplied; without it the paths are returned untouched so the caller can
 * decide.
 *
 * `detectPlaylistFormat` looks at the file extension first but also sniffs the
 * content (`[playlist]`, `#EXTM3U`, JSON), because a `.txt` export is common.
 */

import type { PlaylistEntry, PlaylistFile } from "../types.js";

type PlaylistFormat = PlaylistFile["format"];

/** Remove a UTF-8 byte-order mark left by Windows editors. */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Lower-case extension without the dot, or `""` when the name has none. */
function extensionOf(fileName: string): string {
  const slash = Math.max(fileName.lastIndexOf("/"), fileName.lastIndexOf("\\"));
  const dot = fileName.lastIndexOf(".");
  if (dot <= slash) return "";
  return fileName.slice(dot + 1).toLowerCase();
}

/** Drive letters, UNC paths and rooted paths are already absolute. */
function isAbsolutePath(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("/") || path.startsWith("\\");
}

/**
 * Resolve a playlist entry against `baseDir`.
 * Relative entries adopt `baseDir`'s separator style, so a Windows base keeps
 * backslashes and a POSIX base keeps forward slashes.
 */
function resolvePath(entry: string, baseDir: string | undefined): string {
  if (!baseDir) return entry;
  if (isAbsolutePath(entry)) return entry;

  const separator = baseDir.includes("\\") && !baseDir.includes("/") ? "\\" : "/";
  let relative = entry.replace(/[\\/]+/g, separator);
  while (relative.startsWith("./") || relative.startsWith(".\\")) relative = relative.slice(2);
  while (relative.startsWith(separator)) relative = relative.slice(separator.length);

  const base = baseDir.replace(/[\\/]+$/, "");
  if (!base) return `${separator}${relative}`;
  return `${base}${separator}${relative}`;
}

/** Playlist file names cannot be recovered from the text alone; host sets it. */
const DEFAULT_NAME = "playlist";

/**
 * Parse M3U/M3U8 text.
 *
 * Understands `#EXTM3U`, `#EXTINF:duration,title` (including `-1` for an
 * unknown duration), blank lines, comments and a UTF-8 BOM. A UTF-8 file with
 * non-ASCII characters is reported as `"m3u8"`.
 */
export function parseM3u(text: string, baseDir?: string): PlaylistFile {
  const entries: PlaylistEntry[] = [];
  const source = stripBom(text);
  let pendingDuration: number | undefined;
  let pendingTitle: string | undefined;
  let nonAscii = false;

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/[^\x00-\x7f]/.test(line)) nonAscii = true;

    if (line.startsWith("#")) {
      if (/^#EXTINF:/i.test(line)) {
        const body = line.slice(8);
        const comma = body.indexOf(",");
        const durationText = (comma >= 0 ? body.slice(0, comma) : body).trim();
        const title = comma >= 0 ? body.slice(comma + 1).trim() : "";
        const duration = Number.parseInt(durationText, 10);
        pendingDuration = Number.isFinite(duration) && duration >= 0 ? duration : undefined;
        pendingTitle = title || undefined;
      }
      continue; // #EXTM3U and every other directive are informational
    }

    const entry: PlaylistEntry = { path: resolvePath(line, baseDir) };
    if (pendingDuration !== undefined) entry.duration = pendingDuration;
    if (pendingTitle !== undefined) entry.title = pendingTitle;
    entries.push(entry);
    pendingDuration = undefined;
    pendingTitle = undefined;
  }

  return { name: DEFAULT_NAME, format: nonAscii ? "m3u8" : "m3u", entries };
}

/** Serialize tracks as an extended M3U (UTF-8), one `#EXTINF` per entry. */
export function serializeM3u(tracks: { path: string; duration?: number; title?: string }[]): string {
  const lines = ["#EXTM3U"];
  for (const track of tracks) {
    const duration = track.duration !== undefined && Number.isFinite(track.duration) && track.duration >= 0
      ? Math.round(track.duration)
      : 0;
    lines.push(`#EXTINF:${duration},${track.title ?? ""}`);
    lines.push(track.path);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Parse a PLS playlist: an INI-like `[playlist]` section with
 * `FileN=`, `TitleN=` and `LengthN=` keys. Entries are ordered by `N`;
 * orphaned titles/lengths without a `FileN` are ignored.
 */
export function parsePls(text: string, baseDir?: string): PlaylistFile {
  interface Slot {
    file?: string;
    title?: string;
    length?: number;
  }
  const slots = new Map<number, Slot>();

  for (const rawLine of stripBom(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals < 0) continue;
    const key = line.slice(0, equals).trim().toLowerCase();
    const value = line.slice(equals + 1).trim();
    const match = /^(file|title|length)(\d+)$/.exec(key);
    if (!match) continue; // [playlist], NumberOfEntries, Version, ...

    const index = Number(match[2] ?? 0);
    const slot = slots.get(index) ?? {};
    const field = match[1] ?? "";
    if (field === "file") {
      slot.file = value;
    } else if (field === "title") {
      slot.title = value;
    } else {
      const length = Number.parseInt(value, 10);
      if (Number.isFinite(length) && length >= 0) slot.length = length;
    }
    slots.set(index, slot);
  }

  const entries: PlaylistEntry[] = [];
  for (const index of [...slots.keys()].sort((a, b) => a - b)) {
    const slot = slots.get(index);
    if (!slot?.file) continue;
    const entry: PlaylistEntry = { path: resolvePath(slot.file, baseDir) };
    if (slot.title) entry.title = slot.title;
    if (slot.length !== undefined) entry.duration = slot.length;
    entries.push(entry);
  }

  return { name: DEFAULT_NAME, format: "pls", entries };
}

/**
 * Guess a playlist format from the file name, using `content` as a tie-breaker
 * (`[playlist]` => PLS, `#EXTM3U` => M3U/M3U8, JSON => Cadenza).
 */
export function detectPlaylistFormat(fileName: string, content?: string): PlaylistFormat {
  const extension = extensionOf(fileName);

  if (content !== undefined) {
    const head = stripBom(content).trimStart().slice(0, 32).toLowerCase();
    if (head.startsWith("[playlist]")) return "pls";
    if (head.startsWith("{") || head.startsWith("[")) return "cadenza";
    if (head.startsWith("#extm3u")) {
      if (extension === "m3u8") return "m3u8";
      return /[^\x00-\x7f]/.test(content) ? "m3u8" : "m3u";
    }
  }

  switch (extension) {
    case "m3u":
      return "m3u";
    case "m3u8":
      return "m3u8";
    case "pls":
      return "pls";
    case "cadenza":
    case "json":
      return "cadenza";
    default:
      return "m3u";
  }
}
