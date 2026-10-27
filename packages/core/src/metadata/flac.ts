/**
 * FLAC reader.
 *
 * A FLAC stream is `"fLaC"` followed by metadata blocks. Each block header is
 * one byte holding the "last block" flag and the 7-bit block type, then a
 * 24-bit big-endian block length. This reader understands:
 *
 * - `STREAMINFO` (type 0): sample rate, channel count and total sample count,
 *   which give an exact duration.
 * - `VORBIS_COMMENT` (type 4): the same key/value comments Ogg Vorbis uses.
 * - `PICTURE` (type 6): embedded cover art; the "front cover" type (3) wins over
 *   whatever picture happens to come first.
 *
 * The Vorbis-comment and picture helpers are exported because the Ogg reader
 * reuses them: Ogg Vorbis and Opus carry the exact same comment format, and
 * `METADATA_BLOCK_PICTURE` is a Base64-encoded FLAC picture block.
 */

import type { ByteSource, CoverArt, MetadataResult } from "../types.js";
import { baseName } from "../util/format.js";
import { readAscii, readU24BE, readU32BE, readU32LE, readUtf8 } from "./bytes.js";

/** Read the year out of a `DATE`/`YEAR` comment ("2004", "2004-06-01", ...). */
function parseYear(text: string): number | undefined {
  const match = /(\d{4})/.exec(text);
  const raw = match?.[1];
  if (raw === undefined) return undefined;
  const year = Number(raw);
  return year > 0 && year <= 9999 ? year : undefined;
}

/** Read the leading number of a `TRACKNUMBER`/`DISCNUMBER` comment. */
function parseIndex(text: string): number | undefined {
  const match = /^\s*(\d{1,4})/.exec(text);
  const raw = match?.[1];
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return value > 0 ? value : undefined;
}

/**
 * Parse a FLAC `VORBIS_COMMENT` block body: a little-endian vendor string, a
 * little-endian comment count, then length-prefixed UTF-8 `KEY=value` entries.
 * Keys are upper-cased so lookups are case-insensitive; the first value wins.
 */
export function parseVorbisComments(data: Uint8Array): Map<string, string> {
  const comments = new Map<string, string>();
  let pos = 0;
  const vendorLength = readU32LE(data, pos);
  pos += 4;
  if (pos + vendorLength > data.length) return comments;
  pos += vendorLength;

  const count = readU32LE(data, pos);
  pos += 4;
  for (let i = 0; i < count && pos + 4 <= data.length; i += 1) {
    const length = readU32LE(data, pos);
    pos += 4;
    if (length === 0) continue;
    if (pos + length > data.length) break;
    const entry = readUtf8(data, pos, length);
    pos += length;
    const equals = entry.indexOf("=");
    if (equals <= 0) continue;
    const key = entry.slice(0, equals).trim().toUpperCase();
    const value = entry.slice(equals + 1).trim();
    if (key && value && !comments.has(key)) comments.set(key, value);
  }
  return comments;
}

/** Copy the well-known Vorbis comment fields onto a metadata result. */
export function applyVorbisComments(target: MetadataResult, comments: Map<string, string>): void {
  const pick = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = comments.get(key);
      if (value) return value;
    }
    return undefined;
  };

  const title = pick("TITLE");
  if (title) target.title = title;
  const artist = pick("ARTIST");
  if (artist) target.artist = artist;
  const album = pick("ALBUM");
  if (album) target.album = album;
  const albumArtist = pick("ALBUMARTIST", "ALBUM ARTIST");
  if (albumArtist) target.albumArtist = albumArtist;
  const genre = pick("GENRE");
  if (genre) target.genre = genre;
  const date = pick("DATE", "YEAR", "ORIGINALDATE");
  if (date) {
    const year = parseYear(date);
    if (year !== undefined) target.year = year;
  }
  const track = pick("TRACKNUMBER");
  if (track) {
    const trackNo = parseIndex(track);
    if (trackNo !== undefined) target.trackNo = trackNo;
  }
  const disc = pick("DISCNUMBER", "DISCNUM");
  if (disc) {
    const discNo = parseIndex(disc);
    if (discNo !== undefined) target.discNo = discNo;
  }
}

/** Guess a cover MIME type from the tag value and the image magic bytes. */
function pictureMime(mime: string, image: Uint8Array): string {
  const lower = mime.toLowerCase();
  if (lower.includes("png") || (image[0] === 0x89 && image[1] === 0x50 && image[2] === 0x4e && image[3] === 0x47)) {
    return "image/png";
  }
  if (lower.includes("jpeg") || lower.includes("jpg") || (image[0] === 0xff && image[1] === 0xd8)) {
    return "image/jpeg";
  }
  if (lower.includes("gif")) return "image/gif";
  if (lower.includes("webp")) return "image/webp";
  return mime.trim() || "application/octet-stream";
}

/**
 * Parse a FLAC `PICTURE` block body:
 * type, MIME length + MIME, description length + description, width, height,
 * depth, colour count, data length, data. All integers are big-endian.
 */
export function parseFlacPicture(data: Uint8Array): { type: number; cover: CoverArt } | undefined {
  const type = readU32BE(data, 0);
  const mimeLength = readU32BE(data, 4);
  let pos = 8;
  if (pos + mimeLength > data.length) return undefined;
  const mime = readAscii(data, pos, mimeLength);
  pos += mimeLength;

  const descriptionLength = readU32BE(data, pos);
  pos += 4;
  if (pos + descriptionLength > data.length) return undefined;
  pos += descriptionLength;

  // width, height, bits-per-pixel and colour count (unused for playback).
  pos += 16;
  if (pos + 4 > data.length) return undefined;
  const dataLength = readU32BE(data, pos);
  pos += 4;
  if (dataLength === 0 || pos + dataLength > data.length) return undefined;
  const image = data.subarray(pos, pos + dataLength);
  return { type, cover: { mime: pictureMime(mime, image), data: image } };
}

/** Apply a `STREAMINFO` block body to the result. */
function applyStreamInfo(target: MetadataResult, data: Uint8Array): void {
  if (data.length < 18) return;
  // Bytes 0-9 are block/frame size hints; sample rate starts at byte 10 and is
  // packed: 20 bits rate, 3 bits (channels - 1), 5 bits (bits - 1), 36 bits total.
  const sampleRate = ((data[10] ?? 0) << 12) | ((data[11] ?? 0) << 4) | ((data[12] ?? 0) >> 4);
  const channels = (((data[12] ?? 0) >> 1) & 0x07) + 1;
  const totalSamples = ((data[13] ?? 0) & 0x0f) * 0x100000000 + readU32BE(data, 14);
  if (sampleRate > 0) target.sampleRate = sampleRate;
  if (channels > 0) target.channels = channels;
  if (totalSamples > 0 && sampleRate > 0) target.duration = totalSamples / sampleRate;
}

/**
 * Parse a FLAC file: stream info, Vorbis comments and embedded cover art.
 * Truncated metadata simply stops the block walk; the function never throws.
 */
export async function parseFlac(source: ByteSource, name: string): Promise<MetadataResult> {
  const result: MetadataResult = { title: baseName(name), duration: 0, codec: "FLAC" };

  try {
    const magic = await source.read(0, 4);
    if (readAscii(magic, 0, 4) !== "fLaC") return result;

    let offset = 4;
    let bestPicture: { type: number; cover: CoverArt } | undefined;
    while (offset + 4 <= source.size) {
      const header = await source.read(offset, 4);
      if (header.length < 4) break;
      const first = header[0] ?? 0;
      const isLast = (first & 0x80) !== 0;
      const type = first & 0x7f;
      const length = readU24BE(header, 1);
      const bodyOffset = offset + 4;
      if (length > source.size - bodyOffset) break; // truncated block

      if (type === 0) {
        applyStreamInfo(result, await source.read(bodyOffset, length));
      } else if (type === 4) {
        applyVorbisComments(result, parseVorbisComments(await source.read(bodyOffset, length)));
      } else if (type === 6) {
        const picture = parseFlacPicture(await source.read(bodyOffset, length));
        if (picture && (!bestPicture || picture.type === 3)) bestPicture = picture;
      }

      offset = bodyOffset + length;
      if (isLast) break;
    }

    if (bestPicture) result.cover = bestPicture.cover;
  } catch {
    // Keep whatever fields were already filled in.
  }

  if (!Number.isFinite(result.duration) || result.duration <= 0) {
    result.duration = 0;
  } else if (source.size > 0) {
    result.bitrate = Math.round((source.size * 8) / result.duration / 1000);
  }
  return result;
}
