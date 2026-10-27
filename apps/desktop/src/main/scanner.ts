/**
 * Library scanning lives in the main process: it is the only place with `fs`.
 *
 * The renderer never touches the disk directly. It receives plain `Track`
 * objects, and cover art as small `data:` URLs on demand.
 */

import fsp from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import type { ByteSource, ScanProgress, Track } from "@fanduck/cadenza-core";
import { guessCodec, hashId, parseMetadata } from "@fanduck/cadenza-core";

const AUDIO_EXTENSIONS = new Set([
  ".mp3", ".flac", ".wav", ".m4a", ".m4b", ".aac", ".ogg", ".oga", ".opus", ".wma", ".aiff", ".aif",
]);

const SKIP_DIRS = new Set([
  "node_modules", ".git", "$recycle.bin", "system volume information", "windows", "program files",
  "program files (x86)", "appdata", ".cache", "temp", "tmp",
]);

const MAX_DEPTH = 12;
const MAX_FILES = 50_000;
const READ_CONCURRENCY = 4;

/** Random-access reads straight from disk, used by the metadata parsers. */
class FileByteSource implements ByteSource {
  private handle: fsp.FileHandle | null = null;
  readonly size: number;

  private constructor(
    private readonly file: string,
    size: number,
  ) {
    this.size = size;
  }

  static async open(file: string): Promise<FileByteSource> {
    const stat = await fsp.stat(file);
    return new FileByteSource(file, stat.size);
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    if (offset < 0 || length <= 0 || offset >= this.size) return new Uint8Array(0);
    const want = Math.min(length, this.size - offset);
    if (!this.handle) this.handle = await fsp.open(this.file, "r");
    const buffer = Buffer.allocUnsafe(want);
    const { bytesRead } = await this.handle.read(buffer, 0, want, offset);
    return new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead);
  }

  async close(): Promise<void> {
    if (this.handle) {
      const handle = this.handle;
      this.handle = null;
      await handle.close().catch(() => undefined);
    }
  }
}

export interface ScanOptions {
  roots: string[];
  coversDir: string;
  signal?: AbortSignal;
  onProgress?: (progress: ScanProgress) => void;
}

export interface ScanOutcome {
  tracks: Track[];
  errors: string[];
  scannedAt: number;
}

function isAudioFile(name: string): boolean {
  return AUDIO_EXTENSIONS.has(path.extname(name).toLowerCase());
}

function trackIdFor(file: string): string {
  return hashId(path.resolve(file).toLowerCase());
}

function coverIdFor(file: string, size: number): string {
  return hashId(`${path.resolve(file).toLowerCase()}:${size}`);
}

async function walk(root: string, found: string[], errors: string[], signal?: AbortSignal): Promise<void> {
  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  while (stack.length > 0) {
    if (signal?.aborted) return;
    const next = stack.pop();
    if (!next) break;
    const { dir, depth } = next;
    if (depth > MAX_DEPTH) continue;
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (error) {
      errors.push(`${dir}: ${(error as Error).message}`);
      continue;
    }
    for (const entry of entries) {
      if (signal?.aborted) return;
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name.toLowerCase())) continue;
        stack.push({ dir: full, depth: depth + 1 });
      } else if (entry.isFile() && isAudioFile(entry.name)) {
        found.push(full);
        if (found.length >= MAX_FILES) return;
      }
    }
  }
}

async function persistCover(coversDir: string, coverId: string, mime: string, data: Uint8Array): Promise<void> {
  const ext = mime.includes("png") ? ".png" : mime.includes("webp") ? ".webp" : ".jpg";
  const target = path.join(coversDir, `${coverId}${ext}`);
  try {
    await fsp.access(target, fs.constants.F_OK);
    return;
  } catch {
    /* not cached yet */
  }
  await fsp.writeFile(target, data).catch(() => undefined);
}

async function readOne(file: string, coversDir: string): Promise<Track> {
  const stat = await fsp.stat(file);
  const source = await FileByteSource.open(file);
  try {
    const meta = await parseMetadata(source, path.basename(file));
    const coverId = meta.cover ? coverIdFor(file, stat.size) : undefined;
    if (meta.cover && coverId) {
      await persistCover(coversDir, coverId, meta.cover.mime, meta.cover.data);
    }
    return {
      id: trackIdFor(file),
      path: path.resolve(file),
      title: meta.title,
      artist: meta.artist ?? "Unknown artist",
      album: meta.album ?? "Unknown album",
      ...(meta.albumArtist ? { albumArtist: meta.albumArtist } : {}),
      ...(meta.genre ? { genre: meta.genre } : {}),
      ...(meta.year ? { year: meta.year } : {}),
      ...(meta.trackNo ? { trackNo: meta.trackNo } : {}),
      ...(meta.discNo ? { discNo: meta.discNo } : {}),
      duration: meta.duration,
      ...(meta.bitrate ? { bitrate: meta.bitrate } : {}),
      ...(meta.sampleRate ? { sampleRate: meta.sampleRate } : {}),
      ...(meta.channels ? { channels: meta.channels } : {}),
      codec: meta.codec ?? guessCodec(file),
      size: stat.size,
      ...(coverId ? { coverId } : {}),
      addedAt: stat.birthtimeMs || stat.mtimeMs || Date.now(),
      origin: "scan" as const,
    };
  } finally {
    await source.close();
  }
}

/** Walk every root, parse every audio file, and report progress as it goes. */
export async function scanLibrary(options: ScanOptions): Promise<ScanOutcome> {
  const { roots, coversDir, signal, onProgress } = options;
  const errors: string[] = [];
  await fsp.mkdir(coversDir, { recursive: true });

  let filesFound = 0;
  let filesProcessed = 0;
  let lastEmit = 0;

  const emit = (force = false): void => {
    const now = Date.now();
    if (!force && now - lastEmit < 120) return;
    lastEmit = now;
    onProgress?.({
      phase: "reading",
      filesFound,
      filesProcessed,
      errors: errors.slice(-5),
    });
  };

  onProgress?.({ phase: "discovering", filesFound: 0, filesProcessed: 0, errors: [] });

  const files: string[] = [];
  for (const root of roots) {
    await walk(root, files, errors, signal);
  }
  filesFound = files.length;
  onProgress?.({ phase: "reading", filesFound, filesProcessed: 0, errors: [] });

  const tracks: Track[] = [];
  const queue = [...files];
  const worker = async (): Promise<void> => {
    for (;;) {
      if (signal?.aborted) return;
      const file = queue.shift();
      if (!file) return;
      try {
        tracks.push(await readOne(file, coversDir));
      } catch (error) {
        errors.push(`${path.basename(file)}: ${(error as Error).message}`);
      } finally {
        filesProcessed += 1;
        emit();
      }
    }
  };

  await Promise.all(Array.from({ length: READ_CONCURRENCY }, () => worker()));

  const phase: ScanProgress["phase"] = signal?.aborted ? "cancelled" : "done";
  onProgress?.({ phase, filesFound, filesProcessed, errors: errors.slice(-10) });

  // Stable ordering: artist → album → disc → track number → title.
  tracks.sort((a, b) => {
    const key = (t: Track) => `${t.artist}\u0000${t.album}\u0000${t.discNo ?? 0}\u0000${t.trackNo ?? 0}\u0000${t.title}`;
    return key(a).localeCompare(key(b), "en", { sensitivity: "base" });
  });

  return { tracks, errors, scannedAt: Date.now() };
}

/** Parse a single file (used when the user drags one track in). */
export async function readTrack(file: string, coversDir: string): Promise<Track | null> {
  try {
    await fsp.mkdir(coversDir, { recursive: true });
    return await readOne(file, coversDir);
  } catch {
    return null;
  }
}

/** Resolve a cached cover into a data URL the renderer can put in an <img>. */
export async function readCover(coversDir: string, coverId: string): Promise<string | null> {
  if (!/^[a-z0-9]+$/i.test(coverId)) return null;
  for (const ext of [".jpg", ".png", ".webp"]) {
    const file = path.join(coversDir, `${coverId}${ext}`);
    try {
      const data = await fsp.readFile(file);
      const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
      return `data:${mime};base64,${data.toString("base64")}`;
    } catch {
      /* try the next extension */
    }
  }
  return null;
}

export { trackIdFor, isAudioFile, AUDIO_EXTENSIONS };
