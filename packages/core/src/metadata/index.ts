/**
 * Metadata entry point.
 *
 * {@link parseMetadata} dispatches on the file extension and falls back to
 * sniffing the magic bytes for files without a useful name. Metadata reading is
 * always best-effort: a malformed file yields whatever was recovered plus
 * `duration: 0`, never an exception.
 *
 * The parser lives in the core package, which has no filesystem access; the
 * caller supplies a {@link ByteSource} (see `bufferSource` for in-memory data).
 */

import type { ByteSource, MetadataResult } from "../types.js";
import { baseName } from "../util/format.js";
import { readAscii } from "./bytes.js";
import { parseFlac } from "./flac.js";
import { parseId3v2 } from "./id3v2.js";
import { parseMp4 } from "./mp4.js";
import { parseOgg } from "./ogg.js";
import { parseWav } from "./wav.js";

type Parser = (source: ByteSource, fileName: string) => Promise<MetadataResult>;

/** Extension -> reader. Keys are lower-case, without the dot. */
const EXTENSION_PARSERS: Readonly<Record<string, Parser>> = {
  mp3: parseId3v2,
  flac: parseFlac,
  ogg: parseOgg,
  oga: parseOgg,
  opus: parseOgg,
  m4a: parseMp4,
  mp4: parseMp4,
  m4b: parseMp4,
  aac: parseMp4,
  wav: parseWav,
};

/** Extension -> human codec label used when the parser could not detect one. */
const EXTENSION_CODECS: Readonly<Record<string, string>> = {
  mp3: "MP3",
  flac: "FLAC",
  ogg: "Vorbis",
  oga: "Vorbis",
  opus: "Opus",
  m4a: "AAC",
  mp4: "AAC",
  m4b: "AAC",
  aac: "AAC",
  wav: "WAV",
};

/** Lower-case extension without the dot, or `""` when the name has none. */
function extensionOf(fileName: string): string {
  const slash = Math.max(fileName.lastIndexOf("/"), fileName.lastIndexOf("\\"));
  const dot = fileName.lastIndexOf(".");
  if (dot <= slash) return "";
  return fileName.slice(dot + 1).toLowerCase();
}

/** Human codec label for a file name, e.g. `"FLAC"`; `""` when unknown. */
export function guessCodec(fileName: string): string {
  return EXTENSION_CODECS[extensionOf(fileName)] ?? "";
}

/**
 * Render a compact technical summary, e.g. `"FLAC · 44.1 kHz · 900 kbps"`.
 * Missing values are simply omitted; an empty codec becomes `"Unknown"`.
 */
export function describeCodec(codec: string | undefined, bitrate?: number, sampleRate?: number): string {
  const parts: string[] = [(codec ?? "").trim() || "Unknown"];
  if (sampleRate !== undefined && Number.isFinite(sampleRate) && sampleRate > 0) {
    const kHz = sampleRate / 1000;
    const text = kHz >= 100 ? kHz.toFixed(0) : kHz.toFixed(1).replace(/\.0$/, "");
    parts.push(`${text} kHz`);
  }
  if (bitrate !== undefined && Number.isFinite(bitrate) && bitrate > 0) {
    parts.push(`${Math.round(bitrate)} kbps`);
  }
  return parts.join(" · ");
}

/** Sniff the format from magic bytes and delegate to the matching reader. */
async function parseByMagic(source: ByteSource, fileName: string): Promise<MetadataResult | undefined> {
  try {
    const head = await source.read(0, 12);
    const magic = readAscii(head, 0, 4);
    if (magic === "ID3") return await parseId3v2(source, fileName);
    if (magic === "fLaC") return await parseFlac(source, fileName);
    if (magic === "OggS") return await parseOgg(source, fileName);
    if (magic === "RIFF" && readAscii(head, 8, 4) === "WAVE") return await parseWav(source, fileName);
    if (readAscii(head, 4, 4) === "ftyp") return await parseMp4(source, fileName);
  } catch {
    // Fall through to the minimal result below.
  }
  return undefined;
}

/**
 * Read metadata for `fileName` from `source`.
 *
 * The title always falls back to the file base name and `duration` is always a
 * finite, non-negative number, so callers can store the result directly.
 */
export async function parseMetadata(source: ByteSource, fileName: string): Promise<MetadataResult> {
  const fallbackTitle = baseName(fileName);
  let metadata: MetadataResult | undefined;

  const parser = EXTENSION_PARSERS[extensionOf(fileName)];
  if (parser) {
    try {
      metadata = await parser(source, fileName);
    } catch {
      metadata = undefined;
    }
  } else {
    metadata = await parseByMagic(source, fileName);
  }

  const result: MetadataResult = metadata ?? { title: fallbackTitle, duration: 0 };
  if (!result.title || !result.title.trim()) result.title = fallbackTitle;
  if (!Number.isFinite(result.duration) || result.duration < 0) result.duration = 0;
  if (!result.codec) {
    const codec = guessCodec(fileName);
    if (codec) result.codec = codec;
  }
  return result;
}
