/**
 * ID3v2 tag reader for MP3 (and any other container that starts with an ID3
 * tag).
 *
 * Handles the three tag generations:
 *
 * - **ID3v2.2** — 3-character frame ids, a 6-byte frame header, a 24-bit frame
 *   size, an extended header made of plain integers.
 * - **ID3v2.3** — 4-character frame ids, a 10-byte frame header, a plain 32-bit
 *   frame size, a tag-wide unsynchronisation flag, an extended header whose size
 *   field excludes itself.
 * - **ID3v2.4** — synchsafe frame sizes (with a fallback for the many taggers
 *   that mistakenly wrote plain sizes), a per-frame unsynchronisation flag, a
 *   data-length indicator and an extended header whose size field includes
 *   itself.
 *
 * After the tag the first MPEG audio frame header is located to derive bitrate,
 * sample rate and channel count. Duration prefers a Xing/Info or VBRI frame
 * count and otherwise estimates from the remaining file size and the bitrate.
 *
 * The reader never throws: a truncated or nonsense file returns whatever could
 * be recovered and `duration: 0`.
 */

import type { ByteSource, CoverArt, MetadataResult } from "../types.js";
import { baseName } from "../util/format.js";
import { readAscii, readU16BE, readU24BE, readU32BE, synchsafeToInt } from "./bytes.js";

/** ID3v1 genre table (index 0 = "Blues"); also used by the MP4 `gnre` atom. */
const ID3_GENRES: readonly string[] = [
  "Blues", "Classic Rock", "Country", "Dance", "Disco", "Funk", "Grunge", "Hip-Hop",
  "Jazz", "Metal", "New Age", "Oldies", "Other", "Pop", "R&B", "Rap",
  "Reggae", "Rock", "Techno", "Industrial", "Alternative", "Ska", "Death Metal", "Pranks",
  "Soundtrack", "Euro-Techno", "Ambient", "Trip-Hop", "Vocal", "Jazz+Funk", "Fusion", "Trance",
  "Classical", "Instrumental", "Acid", "House", "Game", "Sound Clip", "Gospel", "Noise",
  "AlternRock", "Bass", "Soul", "Punk", "Space", "Meditative", "Instrumental Pop", "Instrumental Rock",
  "Ethnic", "Gothic", "Darkwave", "Techno-Industrial", "Electronic", "Pop-Folk", "Eurodance", "Dream",
  "Southern Rock", "Comedy", "Cult", "Gangsta", "Top 40", "Christian Rap", "Pop/Funk", "Jungle",
  "Native American", "Cabaret", "New Wave", "Psychedelic", "Rave", "Showtunes", "Trailer", "Lo-Fi",
  "Tribal", "Acid Punk", "Acid Jazz", "Polka", "Retro", "Musical", "Rock & Roll", "Hard Rock",
  "Folk", "Folk-Rock", "National Folk", "Swing", "Fast Fusion", "Bebop", "Latin", "Revival",
  "Celtic", "Bluegrass", "Avantgarde", "Gothic Rock", "Progressive Rock", "Psychedelic Rock", "Symphonic Rock", "Slow Rock",
  "Big Band", "Chorus", "Easy Listening", "Acoustic", "Humour", "Speech", "Chanson", "Opera",
  "Chamber Music", "Sonata", "Symphony", "Booty Bass", "Primus", "Porn Groove", "Satire", "Slow Jam",
  "Club", "Tango", "Samba", "Folklore", "Ballad", "Power Ballad", "Rhythmic Soul", "Freestyle",
  "Duet", "Punk Rock", "Drum Solo", "A Cappella", "Euro-House", "Dance Hall", "Goa", "Drum & Bass",
  "Club-House", "Hardcore", "Terror", "Indie", "Britpop", "Negerpunk", "Polsk Punk", "Beat",
  "Christian Gangsta Rap", "Heavy Metal", "Black Metal", "Crossover", "Contemporary Christian", "Christian Rock", "Merengue", "Salsa",
  "Thrash Metal", "Anime", "JPop", "Synthpop",
];

/** Human readable name for an ID3v1 genre index, or `undefined` when unknown. */
export function id3GenreName(index: number): string | undefined {
  if (!Number.isInteger(index) || index < 0 || index >= ID3_GENRES.length) return undefined;
  return ID3_GENRES[index];
}

/* ------------------------------------------------------------------ text */

/** Decode ISO-8859-1 (one byte per character). */
function decodeLatin1(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i] ?? 0);
  return out;
}

/**
 * Decode UTF-16, honouring a byte-order mark when present and falling back to
 * `defaultBigEndian` for older files that omit it.
 */
function decodeUtf16(bytes: Uint8Array, defaultBigEndian: boolean): string {
  let bigEndian = defaultBigEndian;
  let start = 0;
  const b0 = bytes[0] ?? 0;
  const b1 = bytes[1] ?? 0;
  if (bytes.length >= 2 && b0 === 0xff && b1 === 0xfe) {
    bigEndian = false;
    start = 2;
  } else if (bytes.length >= 2 && b0 === 0xfe && b1 === 0xff) {
    bigEndian = true;
    start = 2;
  }
  let out = "";
  for (let i = start; i + 1 < bytes.length; i += 2) {
    const high = bigEndian ? bytes[i] ?? 0 : bytes[i + 1] ?? 0;
    const low = bigEndian ? bytes[i + 1] ?? 0 : bytes[i] ?? 0;
    out += String.fromCharCode((high << 8) | low);
  }
  return out;
}

/** Cut the string at the first NUL (multi-value frames) and trim whitespace. */
function trimText(text: string): string {
  const nul = text.indexOf("\u0000");
  const head = nul >= 0 ? text.slice(0, nul) : text;
  return head.trim();
}

/** Decode a text frame body (`encoding` byte followed by the payload). */
function decodeTextFrame(data: Uint8Array): string {
  if (data.length === 0) return "";
  const encoding = data[0] ?? 0;
  const body = data.subarray(1);
  switch (encoding) {
    case 1:
    case 2:
      return trimText(decodeUtf16(body, true));
    case 3:
      return trimText(new TextDecoder("utf-8", { fatal: false }).decode(body));
    default:
      return trimText(decodeLatin1(body));
  }
}

/* --------------------------------------------------------------- parsing */

interface ParsedTag {
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  genre?: string;
  year?: number;
  trackNo?: number;
  discNo?: number;
  cover?: CoverArt;
}

/** Strip tags written as `0xFF 0x00` (unsynchronisation). */
function removeUnsynchronisation(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  let length = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i] ?? 0;
    out[length] = byte;
    length += 1;
    if (byte === 0xff && (bytes[i + 1] ?? 0) === 0x00) i += 1;
  }
  return out.subarray(0, length);
}

/** Parse a `TRCK`-style "3/12" value into the leading number. */
function parseIndexPair(text: string): number | undefined {
  const match = /^\s*(\d{1,4})/.exec(text);
  const raw = match?.[1];
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return value > 0 ? value : undefined;
}

/** Parse the year out of `TDRC`/`TYER`/`©day` style values. */
function parseYear(text: string): number | undefined {
  const match = /(\d{4})/.exec(text);
  const raw = match?.[1];
  if (raw === undefined) return undefined;
  const year = Number(raw);
  return year > 0 && year <= 9999 ? year : undefined;
}

/**
 * Turn a `TCON` value into a plain genre name. Handles the ID3v1 index syntax
 * `(17)` and `(17)Rock`, and falls back to the genre table for bare numbers.
 */
function normaliseGenre(raw: string): string | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  const indexed = /^\((\d+)\)(.*)$/s.exec(text);
  if (indexed) {
    const rest = (indexed[2] ?? "").trim();
    if (rest) return rest;
    const name = id3GenreName(Number(indexed[1]));
    if (name) return name;
  }
  if (/^\d{1,3}$/.test(text)) {
    const name = id3GenreName(Number(text));
    if (name) return name;
  }
  return text;
}

/** Find the terminator of a tag string (one NUL, or two for UTF-16). */
function findTerminator(data: Uint8Array, from: number, encoding: number): number {
  const wide = encoding === 1 || encoding === 2;
  if (wide) {
    for (let i = from; i + 1 < data.length; i += 2) {
      if ((data[i] ?? 0) === 0 && (data[i + 1] ?? 0) === 0) return i;
    }
    return -1;
  }
  for (let i = from; i < data.length; i += 1) {
    if ((data[i] ?? 0) === 0) return i;
  }
  return -1;
}

function bytesStartWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    if ((bytes[i] ?? 0) !== prefix[i]) return false;
  }
  return true;
}

/** Normalise a MIME label, sniffing the image magic when the tag is sloppy. */
function normaliseMime(mime: string, image: Uint8Array): string {
  const lower = mime.toLowerCase();
  if (lower.includes("png") || bytesStartWith(image, [0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (lower.includes("jpeg") || lower.includes("jpg") || bytesStartWith(image, [0xff, 0xd8, 0xff])) {
    return "image/jpeg";
  }
  if (lower.includes("gif")) return "image/gif";
  if (lower.includes("webp")) return "image/webp";
  return mime.trim() || "application/octet-stream";
}

/** Parse an ID3v2.3/2.4 `APIC` frame. */
function parseApic(data: Uint8Array): { type: number; cover: CoverArt } | undefined {
  if (data.length < 4) return undefined;
  const encoding = data[0] ?? 0;
  const mimeEnd = findTerminator(data, 1, 0);
  if (mimeEnd < 0) return undefined;
  const mime = decodeLatin1(data.subarray(1, mimeEnd));
  let pos = mimeEnd + 1;
  if (pos >= data.length) return undefined;
  const type = data[pos] ?? 0;
  pos += 1;
  const descriptionEnd = findTerminator(data, pos, encoding);
  if (descriptionEnd < 0) return undefined;
  pos = descriptionEnd + (encoding === 1 || encoding === 2 ? 2 : 1);
  if (pos > data.length) return undefined;
  const image = data.subarray(pos);
  if (image.length === 0) return undefined;
  return { type, cover: { mime: normaliseMime(mime, image), data: image } };
}

/** Parse an ID3v2.2 `PIC` frame (3-character "JPG"/"PNG" format field). */
function parsePic(data: Uint8Array): { type: number; cover: CoverArt } | undefined {
  if (data.length < 6) return undefined;
  const encoding = data[0] ?? 0;
  const format = readAscii(data, 1, 3).toUpperCase();
  const type = data[4] ?? 0;
  const descriptionEnd = findTerminator(data, 5, encoding);
  if (descriptionEnd < 0) return undefined;
  const pos = descriptionEnd + (encoding === 1 || encoding === 2 ? 2 : 1);
  const image = data.subarray(pos);
  if (image.length === 0) return undefined;
  const mime = format.includes("PNG") ? "image/png" : "image/jpeg";
  return { type, cover: { mime, data: image } };
}

function applyFrame(tag: ParsedTag, frameId: string, data: Uint8Array): void {
  switch (frameId) {
    case "TIT2":
    case "TT2": {
      const value = decodeTextFrame(data);
      if (value) tag.title = value;
      break;
    }
    case "TPE1":
    case "TP1": {
      const value = decodeTextFrame(data);
      if (value) tag.artist = value;
      break;
    }
    case "TALB":
    case "TAL": {
      const value = decodeTextFrame(data);
      if (value) tag.album = value;
      break;
    }
    case "TPE2":
    case "TP2": {
      const value = decodeTextFrame(data);
      if (value) tag.albumArtist = value;
      break;
    }
    case "TCON":
    case "TCO": {
      const value = normaliseGenre(decodeTextFrame(data));
      if (value) tag.genre = value;
      break;
    }
    case "TDRC":
    case "TYER":
    case "TYE": {
      const value = parseYear(decodeTextFrame(data));
      if (value !== undefined) tag.year = value;
      break;
    }
    case "TRCK":
    case "TRK": {
      const value = parseIndexPair(decodeTextFrame(data));
      if (value !== undefined) tag.trackNo = value;
      break;
    }
    case "TPOS":
    case "TPA": {
      const value = parseIndexPair(decodeTextFrame(data));
      if (value !== undefined) tag.discNo = value;
      break;
    }
    case "APIC": {
      const picture = parseApic(data);
      if (picture && (!tag.cover || picture.type === 3)) tag.cover = picture.cover;
      break;
    }
    case "PIC": {
      const picture = parsePic(data);
      if (picture && (!tag.cover || picture.type === 3)) tag.cover = picture.cover;
      break;
    }
    default:
      break;
  }
}

/** A frame id is 3 or 4 uppercase letters/digits; anything else is padding. */
function looksLikeFrameHeader(data: Uint8Array, at: number, idLength: number): boolean {
  if (at >= data.length) return true; // end of tag padding is a valid boundary
  if ((data[at] ?? 0) === 0) return true; // zero padding
  return /^[A-Z0-9]+$/.test(readAscii(data, at, idLength));
}

/**
 * Read a v2.4 frame size. The spec says synchsafe, but some taggers write plain
 * 32-bit integers, so pick whichever interpretation lands on a plausible next
 * frame header.
 */
function readFrameSizeV4(data: Uint8Array, pos: number): number {
  const synchsafe = synchsafeToInt(data, pos + 4);
  const plain = readU32BE(data, pos + 4);
  if (plain < 0x80) return plain; // both interpretations agree for small sizes
  if (looksLikeFrameHeader(data, pos + 10 + synchsafe, 4)) return synchsafe;
  if (looksLikeFrameHeader(data, pos + 10 + plain, 4)) return plain;
  return synchsafe;
}

/** Walk the frame area of a tag body. */
function parseFrames(body: Uint8Array, version: number, flags: number): ParsedTag {
  const tag: ParsedTag = {};
  let data = body;
  if ((flags & 0x80) !== 0) data = removeUnsynchronisation(data);

  let pos = 0;
  if ((flags & 0x40) !== 0) {
    // Extended header: v2.4 stores a synchsafe size that includes itself,
    // v2.2/v2.3 store a plain size that excludes the size field.
    if (version === 4) {
      const size = synchsafeToInt(data, 0);
      pos = size > 0 ? size : 6;
    } else {
      pos = 4 + readU32BE(data, 0);
    }
    if (pos > data.length) return tag;
  }

  const idLength = version === 2 ? 3 : 4;
  const headerLength = version === 2 ? 6 : 10;

  while (pos + headerLength <= data.length) {
    const frameId = readAscii(data, pos, idLength);
    if (!/^[A-Z0-9]+$/.test(frameId)) break; // reached zero padding

    const frameSize = version === 2 ? readU24BE(data, pos + 3) : version === 4 ? readFrameSizeV4(data, pos) : readU32BE(data, pos + 4);
    if (frameSize <= 0) break;

    const frameFlags = version === 2 ? 0 : readU16BE(data, pos + 8);
    const dataStart = pos + headerLength;
    const dataEnd = dataStart + frameSize;
    if (dataEnd > data.length) break; // truncated frame

    let frameData = data.subarray(dataStart, dataEnd);
    if (version === 3) {
      if ((frameFlags & 0x0080) !== 0 || (frameFlags & 0x0040) !== 0) {
        pos = dataEnd; // compressed/encrypted frames cannot be read
        continue;
      }
      if ((frameFlags & 0x0020) !== 0) frameData = frameData.subarray(1); // grouping id
    } else if (version === 4) {
      if ((frameFlags & 0x0008) !== 0 || (frameFlags & 0x0004) !== 0) {
        pos = dataEnd;
        continue;
      }
      if ((frameFlags & 0x0040) !== 0) frameData = frameData.subarray(1); // grouping id
      if ((frameFlags & 0x0002) !== 0) frameData = removeUnsynchronisation(frameData);
      if ((frameFlags & 0x0001) !== 0) frameData = frameData.subarray(4); // data length indicator
    }

    applyFrame(tag, frameId, frameData);
    pos = dataEnd;
  }
  return tag;
}

/* ----------------------------------------------------------- MPEG audio */

const MPEG1_LAYER1 = [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 0] as const;
const MPEG1_LAYER2 = [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 0] as const;
const MPEG1_LAYER3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0] as const;
const MPEG2_LAYER1 = [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256, 0] as const;
const MPEG2_LAYER23 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0] as const;

interface MpegInfo {
  bitrate: number;
  sampleRate: number;
  channels: number;
  samplesPerFrame: number;
  /** Duration in seconds, present when a Xing/Info/VBRI header carried it. */
  duration?: number;
}

function bitrateTable(version: number, layer: number): readonly number[] {
  if (version === 3) {
    if (layer === 3) return MPEG1_LAYER1;
    if (layer === 2) return MPEG1_LAYER2;
    return MPEG1_LAYER3;
  }
  return layer === 3 ? MPEG2_LAYER1 : MPEG2_LAYER23;
}

function sampleRateTable(version: number): readonly number[] {
  if (version === 3) return [44100, 48000, 32000];
  if (version === 2) return [22050, 24000, 16000];
  if (version === 0) return [11025, 12000, 8000];
  return [];
}

/**
 * Locate the first valid MPEG audio frame in `window` and read its header.
 * Also inspects the Xing/Info and VBRI extension headers that some encoders put
 * in the first frame to store an exact frame count.
 */
function findMpegFrame(window: Uint8Array): MpegInfo | undefined {
  for (let i = 0; i + 4 <= window.length; i += 1) {
    if ((window[i] ?? 0) !== 0xff || ((window[i + 1] ?? 0) & 0xe0) !== 0xe0) continue;
    const b1 = window[i + 1] ?? 0;
    const b2 = window[i + 2] ?? 0;
    const b3 = window[i + 3] ?? 0;

    const version = (b1 >> 3) & 0x03;
    const layer = (b1 >> 1) & 0x03;
    const bitrateIndex = (b2 >> 4) & 0x0f;
    const sampleRateIndex = (b2 >> 2) & 0x03;
    const channelMode = (b3 >> 6) & 0x03;

    if (version === 1 || layer === 0) continue;
    if (bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) continue;

    const bitrate = bitrateTable(version, layer)[bitrateIndex];
    const sampleRate = sampleRateTable(version)[sampleRateIndex];
    if (bitrate === undefined || sampleRate === undefined || bitrate === 0 || sampleRate === 0) continue;

    const channels = channelMode === 3 ? 1 : 2;
    const samplesPerFrame = layer === 3 ? 384 : layer === 2 ? 1152 : version === 3 ? 1152 : 576;

    const info: MpegInfo = { bitrate, sampleRate, channels, samplesPerFrame };

    // Xing/Info lives after the frame header and the side information block.
    const sideInfo = version === 3 ? (channels === 1 ? 17 : 32) : channels === 1 ? 9 : 17;
    const xingOffset = i + 4 + sideInfo;
    const xingId = readAscii(window, xingOffset, 4);
    if (xingId === "Xing" || xingId === "Info") {
      const flags = readU32BE(window, xingOffset + 4);
      if ((flags & 0x0001) !== 0) {
        const frames = readU32BE(window, xingOffset + 8);
        if (frames > 0) info.duration = (frames * samplesPerFrame) / sampleRate;
      } else if ((flags & 0x0002) !== 0) {
        const bytes = readU32BE(window, xingOffset + 8);
        if (bytes > 0) info.duration = (bytes * 8) / (bitrate * 1000);
      }
    }
    if (info.duration === undefined) {
      // VBRI sits at a fixed offset from the frame start.
      const vbriOffset = i + 36;
      if (readAscii(window, vbriOffset, 4) === "VBRI") {
        const bytes = readU32BE(window, vbriOffset + 10);
        const frames = readU32BE(window, vbriOffset + 14);
        if (frames > 0) {
          info.duration = (frames * samplesPerFrame) / sampleRate;
        } else if (bytes > 0) {
          info.duration = (bytes * 8) / (bitrate * 1000);
        }
      }
    }
    return info;
  }
  return undefined;
}

/* ------------------------------------------------------------ public API */

/**
 * Parse an MP3 file: ID3v2 text frames, embedded cover art, audio properties
 * and a duration estimate.
 */
export async function parseId3v2(source: ByteSource, name: string): Promise<MetadataResult> {
  const result: MetadataResult = { title: baseName(name), duration: 0, codec: "MP3" };

  let audioStart = 0;
  try {
    const header = await source.read(0, 10);
    if (header.length >= 10 && readAscii(header, 0, 3) === "ID3") {
      const version = header[3] ?? 0;
      const flags = header[5] ?? 0;
      const tagSize = synchsafeToInt(header, 6);
      if (version >= 2 && version <= 4 && tagSize > 0) {
        const hasFooter = version === 4 && (flags & 0x10) !== 0;
        audioStart = Math.min(source.size, 10 + tagSize + (hasFooter ? 10 : 0));
        const bodyLength = Math.min(tagSize, Math.max(0, source.size - 10));
        const body = await source.read(10, bodyLength);
        const tag = parseFrames(body, version, flags);
        if (tag.title) result.title = tag.title;
        if (tag.artist) result.artist = tag.artist;
        if (tag.album) result.album = tag.album;
        if (tag.albumArtist) result.albumArtist = tag.albumArtist;
        if (tag.genre) result.genre = tag.genre;
        if (tag.year !== undefined) result.year = tag.year;
        if (tag.trackNo !== undefined) result.trackNo = tag.trackNo;
        if (tag.discNo !== undefined) result.discNo = tag.discNo;
        if (tag.cover) result.cover = tag.cover;
      }
    }
  } catch {
    // Recover what we have; a broken tag must not hide the audio properties.
  }

  try {
    const audioOffset = Math.min(audioStart, source.size);
    const windowLength = Math.min(65536, Math.max(0, source.size - audioOffset));
    const window = await source.read(audioOffset, windowLength);
    const frame = findMpegFrame(window);
    if (frame) {
      result.bitrate = frame.bitrate;
      result.sampleRate = frame.sampleRate;
      result.channels = frame.channels;
      if (frame.duration !== undefined && Number.isFinite(frame.duration) && frame.duration > 0) {
        result.duration = frame.duration;
      } else {
        // Estimate: remaining bytes at the announced bitrate.
        const audioBytes = Math.max(0, source.size - audioOffset);
        const estimated = (audioBytes * 8) / (frame.bitrate * 1000);
        if (Number.isFinite(estimated) && estimated > 0) result.duration = estimated;
      }
    } else {
      // No MPEG sync found: keep the file size as a hint for the UI.
      const audioBytes = Math.max(0, source.size - audioOffset);
      if (audioBytes === 0) result.duration = 0;
    }
  } catch {
    // Ignore audio probing errors.
  }

  if (!Number.isFinite(result.duration) || result.duration < 0) result.duration = 0;
  return result;
}
