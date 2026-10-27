/**
 * ISO base media file format (MP4/M4A/M4B) reader.
 *
 * The container is a tree of "atoms": a 32-bit big-endian size, a 4-byte type,
 * then the payload. A size of `1` means the real size is a 64-bit integer stored
 * right after the type; a size of `0` means "until the end of the parent".
 * Atom types containing 0xA9 are the QuickTime `©`-prefixed metadata keys.
 *
 * The reader walks:
 *
 * - `moov/mvhd` — movie timescale and duration (exact).
 * - `trak/mdia/mdhd` — per-track timescale, used as a duration fallback.
 * - `trak/mdia/minf/stbl/stsd` — the audio sample entry (`mp4a` = AAC,
 *   `alac` = ALAC) plus channel count and sample rate.
 * - `moov/udta/meta/ilst` — `©nam`, `©ART`, `©alb`, `aART`, `©day`, `trkn`,
 *   `disk`, `gnre`/`©gen` and `covr` cover data.
 *
 * `meta` is a full box in some files and a plain container in others; both
 * layouts are handled. Malformed atom sizes stop the walk of that container
 * instead of throwing.
 */

import type { ByteSource, CoverArt, MetadataResult } from "../types.js";
import { baseName } from "../util/format.js";
import { readAscii, readU16BE, readU32BE, readUtf8, readU64BE } from "./bytes.js";
import { id3GenreName } from "./id3v2.js";

interface AtomRange {
  type: string;
  contentStart: number;
  contentEnd: number;
}

/** List the atoms directly inside `[start, end)`. */
async function listAtoms(source: ByteSource, start: number, end: number): Promise<AtomRange[]> {
  const atoms: AtomRange[] = [];
  let offset = start;
  // Guard against pathological files that would otherwise loop forever.
  let guard = 0;
  while (offset + 8 <= end && guard < 100000) {
    guard += 1;
    const head = await source.read(offset, 16);
    if (head.length < 8) break;
    const type = readAscii(head, 4, 4);
    let size = readU32BE(head, 0);
    let headerSize = 8;
    if (size === 1) {
      if (head.length < 16) break;
      size = readU64BE(head, 8);
      headerSize = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (!/^[\x20-\x7e\u00a9]{4}$/.test(type) || size < headerSize || offset + size > end) break;
    atoms.push({ type, contentStart: offset + headerSize, contentEnd: offset + size });
    offset += size;
  }
  return atoms;
}

/** First atom of `type` inside `[start, end)`, if any. */
async function findAtom(source: ByteSource, start: number, end: number, type: string): Promise<AtomRange | undefined> {
  const atoms = await listAtoms(source, start, end);
  return atoms.find((atom) => atom.type === type);
}

/**
 * Read a full-box `mvhd`/`mdhd` duration: version 0 stores 32-bit creation,
 * modification, timescale and duration; version 1 widens them to 64 bits.
 */
async function readFullBoxDuration(source: ByteSource, atom: AtomRange): Promise<number | undefined> {
  const length = atom.contentEnd - atom.contentStart;
  if (length < 20) return undefined;
  const head = await source.read(atom.contentStart, Math.min(32, length));
  if (head.length < 20) return undefined;
  const version = head[0] ?? 0;
  let timescale: number;
  let duration: number;
  if (version === 1) {
    if (head.length < 32) return undefined;
    timescale = readU32BE(head, 20);
    duration = readU64BE(head, 24);
  } else {
    timescale = readU32BE(head, 12);
    duration = readU32BE(head, 16);
  }
  if (timescale <= 0 || duration <= 0) return undefined;
  return duration / timescale;
}

function decodeUtf16BE(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    out += String.fromCharCode(((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0));
  }
  return out;
}

/** Decode an `ilst` value; type 1/0 is UTF-8, type 2 is UTF-16BE. */
function decodeItemText(dataType: number, payload: Uint8Array): string {
  const text = dataType === 2 ? decodeUtf16BE(payload) : readUtf8(payload, 0, payload.length);
  return text.replace(/\u0000+$/, "").trim();
}

function imageMime(dataType: number, payload: Uint8Array): string {
  if (dataType === 13) return "image/jpeg";
  if (dataType === 14) return "image/png";
  if (payload[0] === 0xff && payload[1] === 0xd8) return "image/jpeg";
  if (payload[0] === 0x89 && payload[1] === 0x50 && payload[2] === 0x4e && payload[3] === 0x47) return "image/png";
  return "application/octet-stream";
}

/** Read the leading 16-bit number of an `trkn`/`disk` payload (after 2 pad bytes). */
function readIndexPair(payload: Uint8Array): number | undefined {
  const value = readU16BE(payload, 2);
  return value > 0 ? value : undefined;
}

/** Read `moov/udta/meta/ilst` metadata into `result`. */
async function applyIlst(source: ByteSource, range: StartEnd, result: MetadataResult): Promise<void> {
  const items = await listAtoms(source, range.start, range.end);
  for (const item of items) {
    const dataAtom = await findAtom(source, item.contentStart, item.contentEnd, "data");
    if (!dataAtom) continue;
    const payloadLength = dataAtom.contentEnd - dataAtom.contentStart;
    if (payloadLength <= 8) continue;

    const header = await source.read(dataAtom.contentStart, 8);
    if (header.length < 8) continue;
    const dataType = readU32BE(header, 0) & 0x00ffffff;
    // A 16 MiB cap keeps a broken length field from allocating the whole heap.
    const wanted = Math.min(payloadLength - 8, 16 * 1024 * 1024);
    const payload = await source.read(dataAtom.contentStart + 8, wanted);
    if (payload.length === 0) continue;

    switch (item.type) {
      case "\u00a9nam": {
        const value = decodeItemText(dataType, payload);
        if (value) result.title = value;
        break;
      }
      case "\u00a9ART": {
        const value = decodeItemText(dataType, payload);
        if (value) result.artist = value;
        break;
      }
      case "\u00a9alb": {
        const value = decodeItemText(dataType, payload);
        if (value) result.album = value;
        break;
      }
      case "aART": {
        const value = decodeItemText(dataType, payload);
        if (value) result.albumArtist = value;
        break;
      }
      case "\u00a9day": {
        const value = decodeItemText(dataType, payload);
        const match = /(\d{4})/.exec(value);
        if (match?.[1]) {
          const year = Number(match[1]);
          if (year > 0 && year <= 9999) result.year = year;
        }
        break;
      }
      case "trkn": {
        const trackNo = readIndexPair(payload);
        if (trackNo !== undefined) result.trackNo = trackNo;
        break;
      }
      case "disk": {
        const discNo = readIndexPair(payload);
        if (discNo !== undefined) result.discNo = discNo;
        break;
      }
      case "gnre": {
        const index = readU16BE(payload, 0);
        const name = id3GenreName(index - 1);
        if (name) result.genre = name;
        break;
      }
      case "\u00a9gen": {
        const value = decodeItemText(dataType, payload);
        if (value) result.genre = value;
        break;
      }
      case "covr": {
        if (!result.cover) {
          const cover: CoverArt = { mime: imageMime(dataType, payload), data: payload };
          result.cover = cover;
        }
        break;
      }
      default:
        break;
    }
  }
}

interface StartEnd {
  start: number;
  end: number;
}

/** Read the first audio sample entry of an `stsd` atom. */
async function readSampleEntry(source: ByteSource, stsd: AtomRange): Promise<{ format: string; channels?: number; sampleRate?: number } | undefined> {
  const length = stsd.contentEnd - stsd.contentStart;
  if (length < 16) return undefined;
  // stsd: version/flags (4) + entry count (4), then 8-byte sample entry headers.
  const entryStart = stsd.contentStart + 8;
  const head = await source.read(entryStart, Math.min(36, stsd.contentEnd - entryStart));
  if (head.length < 8) return undefined;
  const format = readAscii(head, 4, 4);
  // AudioSampleEntry: channels at +24 and the 16.16 sample rate at +32. The
  // unsigned shift matters: a 44100 Hz value fills the sign bit of a 32-bit int.
  const channels = head.length >= 26 ? readU16BE(head, 24) : undefined;
  const fixedRate = head.length >= 36 ? readU32BE(head, 32) : 0;
  const sampleRate = fixedRate >>> 16;
  const entry: { format: string; channels?: number; sampleRate?: number } = { format };
  if (channels !== undefined && channels > 0) entry.channels = channels;
  if (sampleRate > 0) entry.sampleRate = sampleRate;
  return entry;
}

/** Find the `stsd` atom below a `trak` atom and read its first audio entry. */
async function readTrackSampleEntry(source: ByteSource, trak: AtomRange): Promise<{ format: string; channels?: number; sampleRate?: number } | undefined> {
  const mdia = await findAtom(source, trak.contentStart, trak.contentEnd, "mdia");
  if (!mdia) return undefined;
  const minf = await findAtom(source, mdia.contentStart, mdia.contentEnd, "minf");
  if (!minf) return undefined;
  const stbl = await findAtom(source, minf.contentStart, minf.contentEnd, "stbl");
  if (!stbl) return undefined;
  const stsd = await findAtom(source, stbl.contentStart, stbl.contentEnd, "stsd");
  if (!stsd) return undefined;
  return readSampleEntry(source, stsd);
}

/** `moov/udta/meta/ilst` range, handling both `meta` layouts. */
async function readMetaIlst(source: ByteSource, meta: AtomRange): Promise<StartEnd | undefined> {
  let childrenStart = meta.contentStart;
  const length = meta.contentEnd - meta.contentStart;
  if (length < 8) return undefined;
  const head = await source.read(meta.contentStart, 8);
  if (head.length < 8) return undefined;
  const firstSize = readU32BE(head, 0);
  const firstType = readAscii(head, 4, 4);
  const looksLikeAtom = /^[\x20-\x7e\u00a9]{4}$/.test(firstType) && firstSize >= 8 && firstSize <= length;
  if (!looksLikeAtom) childrenStart += 4; // skip the full-box version/flags word

  const ilst = await findAtom(source, childrenStart, meta.contentEnd, "ilst");
  if (!ilst) return undefined;
  return { start: ilst.contentStart, end: ilst.contentEnd };
}

/** Parse an MP4/M4A/M4B file. Returns whatever metadata could be recovered. */
export async function parseMp4(source: ByteSource, name: string): Promise<MetadataResult> {
  const result: MetadataResult = { title: baseName(name), duration: 0 };

  try {
    const top = await listAtoms(source, 0, source.size);
    const moov = top.find((atom) => atom.type === "moov");
    if (moov) {
      const moovChildren = await listAtoms(source, moov.contentStart, moov.contentEnd);

      const mvhd = moovChildren.find((atom) => atom.type === "mvhd");
      if (mvhd) {
        const duration = await readFullBoxDuration(source, mvhd);
        if (duration !== undefined) result.duration = duration;
      }

      let fallbackDuration: number | undefined;
      let sampleEntry: { format: string; channels?: number; sampleRate?: number } | undefined;
      for (const trak of moovChildren.filter((atom) => atom.type === "trak")) {
        const mdia = await findAtom(source, trak.contentStart, trak.contentEnd, "mdia");
        if (mdia && fallbackDuration === undefined) {
          const mdhd = await findAtom(source, mdia.contentStart, mdia.contentEnd, "mdhd");
          if (mdhd) fallbackDuration = await readFullBoxDuration(source, mdhd);
        }
        if (sampleEntry === undefined) sampleEntry = await readTrackSampleEntry(source, trak);
      }
      if (result.duration <= 0 && fallbackDuration !== undefined) result.duration = fallbackDuration;

      if (sampleEntry) {
        result.codec = sampleEntry.format === "alac" ? "ALAC" : "AAC";
        if (sampleEntry.channels !== undefined) result.channels = sampleEntry.channels;
        if (sampleEntry.sampleRate !== undefined) result.sampleRate = sampleEntry.sampleRate;
      }

      const udta = moovChildren.find((atom) => atom.type === "udta");
      if (udta) {
        const meta = await findAtom(source, udta.contentStart, udta.contentEnd, "meta");
        if (meta) {
          const ilstRange = await readMetaIlst(source, meta);
          if (ilstRange) await applyIlst(source, ilstRange, result);
        }
      }
    }
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
