/**
 * Bounds-checked readers over `Uint8Array`.
 *
 * Audio tags are frequently truncated or malformed, and the metadata readers
 * never throw for such files. Every helper here therefore returns a neutral
 * value (`0` or `""`) instead of throwing when the requested range falls
 * outside the buffer.
 */

function inBounds(bytes: Uint8Array, offset: number, length: number): boolean {
  return (
    Number.isInteger(offset) &&
    Number.isInteger(length) &&
    offset >= 0 &&
    length >= 0 &&
    offset + length <= bytes.length
  );
}

function at(bytes: Uint8Array, index: number): number {
  return bytes[index] ?? 0;
}

/** Unsigned big-endian 16-bit integer, or `0` when out of bounds. */
export function readU16BE(bytes: Uint8Array, offset: number): number {
  if (!inBounds(bytes, offset, 2)) return 0;
  return (at(bytes, offset) << 8) | at(bytes, offset + 1);
}

/** Unsigned little-endian 16-bit integer, or `0` when out of bounds. */
export function readU16LE(bytes: Uint8Array, offset: number): number {
  if (!inBounds(bytes, offset, 2)) return 0;
  return at(bytes, offset) | (at(bytes, offset + 1) << 8);
}

/** Unsigned big-endian 24-bit integer, or `0` when out of bounds. */
export function readU24BE(bytes: Uint8Array, offset: number): number {
  if (!inBounds(bytes, offset, 3)) return 0;
  return (at(bytes, offset) << 16) | (at(bytes, offset + 1) << 8) | at(bytes, offset + 2);
}

/** Unsigned big-endian 32-bit integer, or `0` when out of bounds. */
export function readU32BE(bytes: Uint8Array, offset: number): number {
  if (!inBounds(bytes, offset, 4)) return 0;
  return (
    at(bytes, offset) * 0x1000000 +
    ((at(bytes, offset + 1) << 16) | (at(bytes, offset + 2) << 8) | at(bytes, offset + 3))
  );
}

/** Unsigned little-endian 32-bit integer, or `0` when out of bounds. */
export function readU32LE(bytes: Uint8Array, offset: number): number {
  if (!inBounds(bytes, offset, 4)) return 0;
  return (
    at(bytes, offset) +
    at(bytes, offset + 1) * 0x100 +
    at(bytes, offset + 2) * 0x10000 +
    at(bytes, offset + 3) * 0x1000000
  );
}

/**
 * Unsigned big-endian 64-bit integer as a JS number.
 * Returns `0` when out of bounds or when the value exceeds `Number.MAX_SAFE_INTEGER`
 * (durations and sizes of that magnitude are not meaningful for audio files).
 */
export function readU64BE(bytes: Uint8Array, offset: number): number {
  if (!inBounds(bytes, offset, 8)) return 0;
  const high = readU32BE(bytes, offset);
  const low = readU32BE(bytes, offset + 4);
  const value = high * 0x100000000 + low;
  return Number.isSafeInteger(value) ? value : 0;
}

/** Unsigned little-endian 64-bit integer as a JS number (used by Ogg granules). */
export function readU64LE(bytes: Uint8Array, offset: number): number {
  if (!inBounds(bytes, offset, 8)) return 0;
  const low = readU32LE(bytes, offset);
  const high = readU32LE(bytes, offset + 4);
  const value = high * 0x100000000 + low;
  return Number.isSafeInteger(value) ? value : 0;
}

/** ASCII text, one char per byte, or `""` when out of bounds. */
export function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  if (!inBounds(bytes, offset, length)) return "";
  let out = "";
  for (let i = 0; i < length; i += 1) out += String.fromCharCode(at(bytes, offset + i));
  return out;
}

/** UTF-8 text, or `""` when out of bounds. Invalid sequences become U+FFFD. */
export function readUtf8(bytes: Uint8Array, offset: number, length: number): string {
  if (!inBounds(bytes, offset, length)) return "";
  if (length === 0) return "";
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(offset, offset + length));
  } catch {
    return "";
  }
}

/**
 * Decode a 4-byte ID3 synchsafe integer (7 significant bits per byte).
 * Used for ID3v2 tag and frame sizes, which must never set the top bit.
 */
export function synchsafeToInt(bytes: Uint8Array, offset: number): number {
  if (!inBounds(bytes, offset, 4)) return 0;
  return (
    ((at(bytes, offset) & 0x7f) << 21) |
    ((at(bytes, offset + 1) & 0x7f) << 14) |
    ((at(bytes, offset + 2) & 0x7f) << 7) |
    (at(bytes, offset + 3) & 0x7f)
  );
}
