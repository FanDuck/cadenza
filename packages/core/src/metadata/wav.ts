/**
 * RIFF/WAVE reader.
 *
 * A WAV file is `"RIFF"`, a little-endian chunk size and `"WAVE"`, followed by
 * chunks of `id` + 32-bit little-endian size + payload. Chunk payloads are
 * padded to an even number of bytes.
 *
 * Only two chunks matter for a library entry:
 *
 * - `"fmt "` — audio format, channel count, sample rate, byte rate and bit
 *   depth.
 * - `"data"` — the raw sample payload, whose declared size divided by the byte
 *   rate gives the exact duration without decoding audio.
 *
 * Unknown chunks (including `LIST`/`INFO` metadata) are skipped by their size.
 */

import type { ByteSource, MetadataResult } from "../types.js";
import { baseName } from "../util/format.js";
import { readAscii, readU16LE, readU32LE } from "./bytes.js";

/** Parse a WAV file. Truncated chunks stop the walk; the function never throws. */
export async function parseWav(source: ByteSource, name: string): Promise<MetadataResult> {
  const result: MetadataResult = { title: baseName(name), duration: 0, codec: "WAV" };

  try {
    const riff = await source.read(0, 12);
    if (riff.length < 12 || readAscii(riff, 0, 4) !== "RIFF" || readAscii(riff, 8, 4) !== "WAVE") {
      return result;
    }

    let channels = 0;
    let sampleRate = 0;
    let byteRate = 0;
    let bitsPerSample = 0;
    let dataSize = 0;

    let offset = 12;
    let guard = 0;
    while (offset + 8 <= source.size && guard < 4096) {
      guard += 1;
      const header = await source.read(offset, 8);
      if (header.length < 8) break;
      const id = readAscii(header, 0, 4);
      const size = readU32LE(header, 4);
      const bodyOffset = offset + 8;
      if (size > source.size - bodyOffset) break; // truncated chunk

      if (id === "fmt ") {
        const body = await source.read(bodyOffset, Math.min(size, 16));
        if (body.length >= 16) {
          channels = readU16LE(body, 2);
          sampleRate = readU32LE(body, 4);
          byteRate = readU32LE(body, 8);
          bitsPerSample = readU16LE(body, 14);
        }
      } else if (id === "data") {
        dataSize = size;
        break; // everything after the samples is metadata we do not need
      }

      // Chunks are word-aligned: an odd payload has one pad byte.
      offset = bodyOffset + size + (size & 1);
    }

    if (channels > 0) result.channels = channels;
    if (sampleRate > 0) result.sampleRate = sampleRate;

    let effectiveByteRate = byteRate;
    if (effectiveByteRate <= 0 && sampleRate > 0 && channels > 0 && bitsPerSample > 0) {
      effectiveByteRate = (sampleRate * channels * bitsPerSample) / 8;
    }
    if (effectiveByteRate > 0) {
      result.bitrate = Math.round((effectiveByteRate * 8) / 1000);
      if (dataSize > 0) result.duration = dataSize / effectiveByteRate;
    }
  } catch {
    // Keep whatever was parsed so far.
  }

  if (!Number.isFinite(result.duration) || result.duration <= 0) result.duration = 0;
  return result;
}
