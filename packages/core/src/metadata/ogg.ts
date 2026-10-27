/**
 * Ogg reader for Vorbis and Opus streams.
 *
 * An Ogg file is a chain of pages. Each page has a 27-byte header (`OggS`,
 * header flags, a little-endian granule position, stream serial, sequence, CRC,
 * segment count) followed by a "lacing" table: 255 means "packet continues",
 * any smaller value ends the current packet. Packets can span pages, so the
 * reader reassembles them.
 *
 * The first packet is always the identification header (Vorbis: sample rate and
 * nominal bitrate; Opus: 48 kHz output rate and a pre-skip value). The second
 * packet is the comment header, which uses the same Vorbis-comment layout as
 * FLAC plus an optional Base64 `METADATA_BLOCK_PICTURE`.
 *
 * Duration comes from the granule position of the last page (the final 64 KiB
 * are read for it), divided by the sample rate; Opus subtracts its pre-skip.
 * A missing or malformed granule leaves `duration` at `0`.
 */

import type { ByteSource, MetadataResult } from "../types.js";
import { baseName } from "../util/format.js";
import { readAscii, readU16LE, readU32LE, readU64LE } from "./bytes.js";
import { applyVorbisComments, parseFlacPicture, parseVorbisComments } from "./flac.js";

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Decode Base64 (whitespace and padding tolerated); `undefined` when invalid. */
function decodeBase64(text: string): Uint8Array | undefined {
  const clean = text.replace(/[\s=]/g, "");
  const output = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let written = 0;
  for (const char of clean) {
    const value = BASE64_ALPHABET.indexOf(char);
    if (value < 0) return undefined;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output[written] = (buffer >> bits) & 0xff;
      written += 1;
    }
  }
  return output.subarray(0, written);
}

interface OggPage {
  headerType: number;
  granule: number;
  serial: number;
  lacing: number[];
  payload: Uint8Array;
  /** Total page length in bytes (header + segment table + payload). */
  length: number;
}

/** Read and validate one Ogg page at `offset`. */
async function readPage(source: ByteSource, offset: number): Promise<OggPage | undefined> {
  if (offset < 0 || offset + 27 > source.size) return undefined;
  const header = await source.read(offset, 27);
  if (header.length < 27 || readAscii(header, 0, 4) !== "OggS") return undefined;

  const headerType = header[5] ?? 0;
  const granule = readU64LE(header, 6);
  const serial = readU32LE(header, 14);
  const segmentCount = header[26] ?? 0;
  const table = await source.read(offset + 27, segmentCount);
  if (table.length < segmentCount) return undefined;

  const lacing: number[] = [];
  let payloadLength = 0;
  for (let i = 0; i < segmentCount; i += 1) {
    const value = table[i] ?? 0;
    lacing.push(value);
    payloadLength += value;
  }
  const payload = await source.read(offset + 27 + segmentCount, payloadLength);
  return {
    headerType,
    granule,
    serial,
    lacing,
    payload,
    length: 27 + segmentCount + payloadLength,
  };
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 0) return new Uint8Array(0);
  if (chunks.length === 1) return chunks[0] ?? new Uint8Array(0);
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const chunk of chunks) {
    out.set(chunk, pos);
    pos += chunk.length;
  }
  return out;
}

interface OggIdentification {
  codec: string;
  sampleRate: number;
  channels: number;
  /** Samples to drop at the start (Opus only). */
  preSkip: number;
  nominalBitrate: number;
}

/** Parse the first packet of the stream: Vorbis or Opus identification header. */
function parseIdentification(packet: Uint8Array): OggIdentification | undefined {
  if (packet.length >= 28 && (packet[0] ?? 0) === 1 && readAscii(packet, 1, 6) === "vorbis") {
    const channels = packet[11] ?? 0;
    const sampleRate = readU32LE(packet, 12);
    const nominal = readU32LE(packet, 20);
    // -1 (0xFFFFFFFF) means "not set"; huge values are equally meaningless.
    const nominalBitrate = nominal > 0 && nominal < 1000000 ? nominal : 0;
    return { codec: "Vorbis", sampleRate, channels, preSkip: 0, nominalBitrate };
  }
  if (packet.length >= 19 && readAscii(packet, 0, 8) === "OpusHead") {
    return {
      codec: "Opus",
      sampleRate: 48000, // Opus always decodes at 48 kHz
      channels: packet[9] ?? 0,
      preSkip: readU16LE(packet, 10),
      nominalBitrate: 0,
    };
  }
  return undefined;
}

/** Slice the comment block out of the second packet. */
function commentBlock(packet: Uint8Array): Uint8Array | undefined {
  if (packet.length >= 7 && (packet[0] ?? 0) === 3 && readAscii(packet, 1, 6) === "vorbis") {
    return packet.subarray(7);
  }
  if (packet.length >= 8 && readAscii(packet, 0, 8) === "OpusTags") {
    return packet.subarray(8);
  }
  return undefined;
}

/** `true` when every byte in the range is 0xFF (an "unknown" granule). */
function allOnes(bytes: Uint8Array, offset: number, length: number): boolean {
  if (offset < 0 || offset + length > bytes.length) return false;
  for (let i = 0; i < length; i += 1) {
    if ((bytes[offset + i] ?? 0) !== 0xff) return false;
  }
  return true;
}

/** Last occurrence of an ASCII marker at or before `before`, or -1. */
function lastIndexOfAscii(bytes: Uint8Array, text: string, before: number): number {
  const limit = Math.min(before, bytes.length) - text.length;
  for (let i = limit; i >= 0; i -= 1) {
    if (readAscii(bytes, i, text.length) === text) return i;
  }
  return -1;
}

/** Read the granule position of the last complete page in the final 64 KiB. */
async function readLastGranule(source: ByteSource): Promise<number | undefined> {
  const tailLength = Math.min(65536, source.size);
  if (tailLength < 27) return undefined;
  const tail = await source.read(source.size - tailLength, tailLength);
  let searchEnd = tail.length;
  while (searchEnd > 0) {
    const index = lastIndexOfAscii(tail, "OggS", searchEnd);
    if (index < 0) return undefined;
    if (index + 14 <= tail.length && !allOnes(tail, index + 6, 8)) {
      const granule = readU64LE(tail, index + 6);
      if (granule > 0) return granule;
    }
    searchEnd = index;
  }
  return undefined;
}

/**
 * Parse an Ogg Vorbis/Opus file: audio properties, Vorbis comments, embedded
 * cover art and duration. Malformed pages end the walk without throwing.
 */
export async function parseOgg(source: ByteSource, name: string): Promise<MetadataResult> {
  const result: MetadataResult = { title: baseName(name), duration: 0 };

  try {
    const firstPage = await readPage(source, 0);
    if (!firstPage) return result;

    // Reassemble the first two packets of the first logical stream only; other
    // streams (e.g. a video track) may interleave their pages.
    const serial = firstPage.serial;
    const packets: Uint8Array[] = [];
    let chunks: Uint8Array[] = [];
    let page: OggPage | undefined = firstPage;
    let pageOffset = 0;
    let pagesRead = 0;
    let bytesRead = 0;

    while (page && packets.length < 2 && pagesRead < 256 && bytesRead < 8 * 1024 * 1024) {
      pagesRead += 1;
      bytesRead += page.payload.length;
      if ((page.headerType & 0x01) === 0) chunks = []; // no continuation: previous packet ended
      let payloadPos = 0;
      for (const lacing of page.lacing) {
        const chunk = page.payload.subarray(payloadPos, payloadPos + lacing);
        chunks.push(chunk);
        payloadPos += lacing;
        if (lacing < 255) {
          packets.push(concatChunks(chunks));
          chunks = [];
          if (packets.length >= 2) break;
        }
      }
      if (packets.length >= 2) break;

      // Advance to the next page of this stream, skipping interleaved ones.
      pageOffset += page.length;
      let nextPage: OggPage | undefined;
      for (let skipped = 0; skipped < 128; skipped += 1) {
        const candidate = await readPage(source, pageOffset);
        if (!candidate) break;
        pageOffset += candidate.length;
        if (candidate.serial === serial) {
          nextPage = candidate;
          break;
        }
      }
      page = nextPage;
    }

    const identify = packets[0] ? parseIdentification(packets[0]) : undefined;
    if (identify) {
      result.codec = identify.codec;
      if (identify.sampleRate > 0) result.sampleRate = identify.sampleRate;
      if (identify.channels > 0) result.channels = identify.channels;
    }

    const block = packets[1] ? commentBlock(packets[1]) : undefined;
    if (block) {
      const comments = parseVorbisComments(block);
      applyVorbisComments(result, comments);
      const encodedPicture = comments.get("METADATA_BLOCK_PICTURE");
      if (encodedPicture) {
        const bytes = decodeBase64(encodedPicture);
        const picture = bytes ? parseFlacPicture(bytes) : undefined;
        if (picture) result.cover = picture.cover;
      }
    }

    const sampleRate = identify?.sampleRate ?? 0;
    const granule = await readLastGranule(source);
    if (sampleRate > 0 && granule !== undefined) {
      const samples = Math.max(0, granule - (identify?.preSkip ?? 0));
      result.duration = samples / sampleRate;
    }

    if (result.bitrate === undefined && identify && identify.nominalBitrate > 0) {
      result.bitrate = Math.round(identify.nominalBitrate / 1000);
    }
    if (result.bitrate === undefined && result.duration > 0 && source.size > 0) {
      result.bitrate = Math.round((source.size * 8) / result.duration / 1000);
    }
  } catch {
    // Keep whatever was parsed so far.
  }

  result.codec ??= "Ogg";
  if (!Number.isFinite(result.duration) || result.duration <= 0) result.duration = 0;
  return result;
}
