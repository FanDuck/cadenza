/**
 * LRC (LyRiCs) reader, used for sidecar lyric files.
 *
 * Supported syntax:
 *
 * - Timestamps: `[mm:ss]`, `[mm:ss.xx]`, `[mm:ss.xxx]` and the `[mm:ss:xx]`
 *   variant some editors emit. Minutes may be 1-3 digits.
 * - Multiple timestamps on one line (`[00:12.34][01:20.00]text`), a common way
 *   to repeat a chorus.
 * - Metadata tags: `[ti:]`, `[ar:]`, `[al:]`, `[by:]`, `[re:]`, `[ve:]`,
 *   `[length:]` (parsed and skipped) and `[offset:+/-ms]` (stored, not applied).
 * - Blank lines are ignored; lines sharing a timestamp are merged so an empty
 *   line followed by the same timestamp's text does not produce two entries.
 *
 * The document keeps the offset in seconds; `findActiveLine` applies it when
 * looking up the current line.
 */

import type { LyricsDoc, LrcLine } from "../types.js";

/** `[mm:ss]`, `[mm:ss.xx]`, `[mm:ss.xxx]` and `[mm:ss:xx]`. */
const TIMESTAMP = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

/** Metadata tags, including a possibly signed millisecond offset. */
const METADATA = /^\[(ti|ar|al|by|re|ve|length|offset):([^\]]*)\]$/i;

/** Convert a fractional timestamp part ("34", "345") to seconds. */
function fractionSeconds(raw: string | undefined): number {
  if (raw === undefined || raw === "") return 0;
  return Number(raw.padEnd(3, "0")) / 1000;
}

/**
 * Parse LRC text into a {@link LyricsDoc}.
 *
 * `source` defaults to `"sidecar"`; a caller that decodes embedded lyrics (for
 * example an ID3 `USLT` frame) passes `"embedded"`.
 */
export function parseLrc(text: string, source: LyricsDoc["source"] = "sidecar"): LyricsDoc {
  const raw = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  let offset = 0;
  const entries: LrcLine[] = [];

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const metadata = METADATA.exec(line);
    if (metadata) {
      const key = (metadata[1] ?? "").toLowerCase();
      const value = (metadata[2] ?? "").trim();
      if (key === "offset") {
        const milliseconds = Number.parseInt(value, 10);
        if (Number.isFinite(milliseconds)) offset = milliseconds / 1000;
      }
      continue;
    }

    // Collect the timestamps that form a contiguous prefix of the line.
    const times: number[] = [];
    let consumed = 0;
    TIMESTAMP.lastIndex = 0;
    let match = TIMESTAMP.exec(line);
    while (match !== null && match.index === consumed) {
      const minutes = Number(match[1] ?? 0);
      const seconds = Number(match[2] ?? 0);
      times.push(minutes * 60 + seconds + fractionSeconds(match[3]));
      consumed = TIMESTAMP.lastIndex;
      match = TIMESTAMP.exec(line);
    }
    if (times.length === 0) continue;

    const lyric = line.slice(consumed).trim();
    for (const time of times) entries.push({ time, text: lyric });
  }

  entries.sort((a, b) => a.time - b.time);

  // Merge entries that share a timestamp (e.g. an instrumental marker followed
  // by the text at the same time, or a duplicated timestamp).
  const lines: LrcLine[] = [];
  for (const entry of entries) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.time - entry.time) < 1e-6) {
      if (!last.text) last.text = entry.text;
      else if (entry.text && entry.text !== last.text) last.text = `${last.text} ${entry.text}`;
      continue;
    }
    lines.push({ time: entry.time, text: entry.text });
  }

  return { lines, offset, source, raw: text };
}

/**
 * Index of the last line whose timestamp is at or before
 * `position + doc.offset`, or `-1` when playback is before the first line.
 */
export function findActiveLine(doc: LyricsDoc, position: number): number {
  if (!Number.isFinite(position)) return -1;
  const offset = Number.isFinite(doc.offset) ? doc.offset : 0;
  const target = position + offset;

  let low = 0;
  let high = doc.lines.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const line = doc.lines[middle];
    if (line === undefined) break;
    if (line.time <= target) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

/** Format seconds as `[mm:ss.xx]` timestamp text. */
function formatTimestamp(time: number): string {
  const totalCentiseconds = Math.max(0, Math.round(time * 100));
  const minutes = Math.floor(totalCentiseconds / 6000);
  const seconds = Math.floor(totalCentiseconds / 100) % 60;
  const centiseconds = totalCentiseconds % 100;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
}

/**
 * Serialize a document back to LRC text.
 * Round-trips through {@link parseLrc}: the offset tag is emitted when non-zero
 * and timestamps keep centisecond precision.
 */
export function serializeLrc(doc: LyricsDoc): string {
  const out: string[] = [];
  if (Number.isFinite(doc.offset) && doc.offset !== 0) {
    const milliseconds = Math.round(doc.offset * 1000);
    const sign = milliseconds >= 0 ? "+" : "-";
    out.push(`[offset:${sign}${Math.abs(milliseconds)}]`);
  }
  for (const line of doc.lines) {
    out.push(`[${formatTimestamp(line.time)}]${line.text}`);
  }
  return out.join("\n");
}
