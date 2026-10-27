/**
 * `ByteSource` helpers.
 *
 * The core package cannot touch `fs`, so metadata reading is expressed against
 * the tiny `ByteSource` interface from `types.ts`. Hosts back it with a file
 * handle (desktop) or with an in-memory `Uint8Array` (tests, browser demo).
 */

import type { ByteSource } from "../types.js";
import { clamp } from "../util/format.js";

/**
 * Wrap an existing buffer as a {@link ByteSource}.
 *
 * Reads return `subarray` views, so no bytes are copied; the caller must treat
 * the returned arrays as immutable and must not mutate the input buffer while
 * parsing is in flight.
 */
export function bufferSource(bytes: Uint8Array): ByteSource {
  const size = bytes.length;
  return {
    size,
    read(offset: number, length: number): Promise<Uint8Array> {
      const start = clamp(Math.trunc(offset) || 0, 0, size);
      const wanted = Math.trunc(length) || 0;
      const end = clamp(start + Math.max(0, wanted), start, size);
      return Promise.resolve(bytes.subarray(start, end));
    },
  };
}

/**
 * A zero-copy window over `[offset, offset + length)` of another source.
 * Useful for parsing a nested container (an MP4 atom, an FLAC block) with the
 * same helpers as the whole file.
 */
export function sliceSource(source: ByteSource, offset: number, length: number): ByteSource {
  const start = clamp(Math.trunc(offset) || 0, 0, source.size);
  const end = clamp(start + Math.max(0, Math.trunc(length) || 0), start, source.size);
  return {
    size: end - start,
    async read(relativeOffset: number, relativeLength: number): Promise<Uint8Array> {
      const from = clamp(Math.trunc(relativeOffset) || 0, 0, end - start);
      const wanted = Math.max(0, Math.trunc(relativeLength) || 0);
      const to = clamp(from + wanted, from, end - start);
      if (to === from) return new Uint8Array(0);
      const bytes = await source.read(start + from, to - from);
      return bytes.length > to - from ? bytes.subarray(0, to - from) : bytes;
    },
  };
}
