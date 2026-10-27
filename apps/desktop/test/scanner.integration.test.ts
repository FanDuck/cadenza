/**
 * Scanner integration test - real files on disk, real byte sources.
 *
 * This is the closest thing to "did the library actually work" that runs without
 * a GUI: it writes genuine WAV and FLAC files (with Vorbis comments and embedded
 * artwork), walks them with the same code path the Electron main process uses,
 * and reads the cached cover back.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// Compiled main-process module: it only depends on node + core, never on electron.
import { readCover, readTrack, scanLibrary } from "../dist/main/scanner.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.join(here, "..");

/* --------------------------------------------------------------- fixtures */

function writeU32LE(buffer: Buffer, offset: number, value: number): void {
  buffer.writeUInt32LE(value >>> 0, offset);
}

/** 16-bit PCM WAV of `seconds` length at 44.1 kHz, stereo. */
function makeWav(seconds: number): Buffer {
  const sampleRate = 44_100;
  const channels = 2;
  const bits = 16;
  const blockAlign = (channels * bits) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = Math.round(byteRate * seconds);
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0, "ascii");
  writeU32LE(buffer, 4, 36 + dataSize);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  writeU32LE(buffer, 16, 16); // fmt chunk size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(channels, 22);
  writeU32LE(buffer, 24, sampleRate);
  writeU32LE(buffer, 28, byteRate);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bits, 34);
  buffer.write("data", 36, "ascii");
  writeU32LE(buffer, 40, dataSize);
  return buffer;
}

function block(type: number, body: Buffer, last: boolean): Buffer {
  const header = Buffer.alloc(4);
  header[0] = (last ? 0x80 : 0) | type;
  header[1] = (body.length >> 16) & 0xff;
  header[2] = (body.length >> 8) & 0xff;
  header[3] = body.length & 0xff;
  return Buffer.concat([header, body]);
}

function streamInfo(sampleRate: number, channels: number, bitsPerSample: number, totalSamples: number): Buffer {
  const body = Buffer.alloc(34);
  body[10] = (sampleRate >> 12) & 0xff;
  body[11] = (sampleRate >> 4) & 0xff;
  body[12] = ((sampleRate & 0x0f) << 4) | (((channels - 1) & 0x07) << 1) | (((bitsPerSample - 1) >> 4) & 0x01);
  body[13] = (((bitsPerSample - 1) & 0x0f) << 4) | ((Math.floor(totalSamples / 0x100000000) & 0x0f) << 0);
  // The total-sample count is big-endian, unlike the Vorbis comment integers.
  body.writeUInt32BE(totalSamples >>> 0, 14);
  return body;
}

function vorbisComments(pairs: Array<[string, string]>): Buffer {
  const vendor = Buffer.from("CadenzaTest 0.1", "utf8");
  const parts: Buffer[] = [];
  const vendorHeader = Buffer.alloc(4);
  writeU32LE(vendorHeader, 0, vendor.length);
  parts.push(vendorHeader, vendor);

  const count = Buffer.alloc(4);
  writeU32LE(count, 0, pairs.length);
  parts.push(count);

  for (const [key, value] of pairs) {
    const entry = Buffer.from(`${key}=${value}`, "utf8");
    const length = Buffer.alloc(4);
    writeU32LE(length, 0, entry.length);
    parts.push(length, entry);
  }
  return Buffer.concat(parts);
}

function picture(type: number, mime: string, image: Buffer): Buffer {
  const mimeBytes = Buffer.from(mime, "ascii");
  const head = Buffer.alloc(8);
  head.writeUInt32BE(type, 0);
  head.writeUInt32BE(mimeBytes.length, 4);
  const description = Buffer.alloc(4); // empty description
  const dims = Buffer.alloc(16); // width, height, depth, colours
  const dataLength = Buffer.alloc(4);
  dataLength.writeUInt32BE(image.length, 0);
  return Buffer.concat([head, mimeBytes, description, dims, dataLength, image]);
}

/** A FLAC stream: real STREAMINFO, Vorbis comments and front-cover art. */
function makeFlac(options: { title: string; artist: string; album: string }): Buffer {
  const magic = Buffer.from("fLaC", "ascii");
  // 44100 Hz stereo 16-bit, 2 seconds.
  return Buffer.concat([
    magic,
    block(0, streamInfo(44_100, 2, 16, 88_200), false),
    block(
      4,
      vorbisComments([
        ["TITLE", options.title],
        ["ARTIST", options.artist],
        ["ALBUM", options.album],
        ["TRACKNUMBER", "3"],
        ["DATE", "2019-04-02"],
        ["GENRE", "Ambient"],
      ]),
      false,
    ),
    block(6, picture(3, "image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9])), true),
  ]);
}

function makeTempDir(): string {
  const base = path.join(appRoot, ".tmp-scan-test");
  fs.rmSync(base, { recursive: true, force: true });
  fs.mkdirSync(base, { recursive: true });
  return base;
}

/* ------------------------------------------------------------------ tests */

test("scanLibrary reads real files, recurses, skips non-audio and caches covers", async () => {
  const root = makeTempDir();
  try {
    fs.mkdirSync(path.join(root, "album", "disc 1"), { recursive: true });
    // Real-world Windows library: CJK folder names, spaces and brackets.
    fs.mkdirSync(path.join(root, "周杰伦 - 十一月的萧邦"), { recursive: true });
    fs.writeFileSync(path.join(root, "alpha.wav"), makeWav(2));
    fs.writeFileSync(
      path.join(root, "album", "disc 1", "beta.flac"),
      makeFlac({ title: "Aurora Drift", artist: "Nova Reed", album: "Glass Harbour" }),
    );
    fs.writeFileSync(path.join(root, "周杰伦 - 十一月的萧邦", "夜曲 (Live) [2005].wav"), makeWav(1));
    fs.writeFileSync(path.join(root, "album", "notes.txt"), "not audio");
    fs.writeFileSync(path.join(root, "cover.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

    const coversDir = path.join(root, "covers");
    const progress = [];
    const result = await scanLibrary({ roots: [root], coversDir, onProgress: (p) => progress.push(p) });

    assert.deepEqual(result.errors, [], `no scan errors: ${result.errors.join("; ")}`);
    assert.equal(result.tracks.length, 3, "only audio files are indexed");

    const cjk = result.tracks.find((t) => t.path.includes("夜曲"));
    assert.ok(cjk, "non-ASCII file and folder names are indexed");
    assert.equal(cjk.title, "夜曲 (Live) [2005]", "CJK file name survives the title fallback");
    assert.ok(Math.abs(cjk.duration - 1) < 0.05, "CJK file duration parsed");

    const flac = result.tracks.find((t) => t.path.endsWith("beta.flac"));
    assert.ok(flac, "the nested FLAC file was found by recursion");
    assert.equal(flac.title, "Aurora Drift");
    assert.equal(flac.artist, "Nova Reed");
    assert.equal(flac.album, "Glass Harbour");
    assert.equal(flac.trackNo, 3);
    assert.equal(flac.year, 2019);
    assert.equal(flac.genre, "Ambient");
    assert.equal(flac.codec, "FLAC");
    assert.equal(flac.sampleRate, 44_100);
    assert.equal(flac.channels, 2);
    assert.ok(Math.abs(flac.duration - 2) < 0.01, `duration came from STREAMINFO (got ${flac.duration})`);
    assert.ok(flac.size && flac.size > 0, "file size recorded");
    assert.ok(flac.coverId, "embedded artwork produced a cover id");

    const wav = result.tracks.find((t) => t.path.endsWith("alpha.wav"));
    assert.ok(wav, "the WAV file was indexed");
    assert.equal(wav.title, "alpha", "untagged files fall back to the file name");
    assert.equal(wav.codec, "WAV");
    assert.ok(Math.abs(wav.duration - 2) < 0.05, `wav duration from the data chunk (got ${wav.duration})`);

    // Cover art was written to the cache and can be read back as a data URL.
    const cover = flac.coverId ? await readCover(coversDir, flac.coverId) : null;
    assert.ok(cover, "cached cover is readable");
    assert.ok(cover.startsWith("data:image/jpeg;base64,"), "cover is returned as a base64 data URL");
    assert.ok(fs.readdirSync(coversDir).length > 0, "cover files exist on disk");
    assert.equal(await readCover(coversDir, "../escape"), null, "cover ids cannot traverse the cache directory");

    // Progress reporting reached the caller.
    assert.ok(progress.length > 0, "scan reported progress");
    assert.equal(progress.at(-1)?.phase, "done");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("scanLibrary honours cancellation", async () => {
  const root = makeTempDir();
  try {
    fs.writeFileSync(path.join(root, "one.wav"), makeWav(1));
    const controller = new AbortController();
    controller.abort();
    const result = await scanLibrary({
      roots: [root],
      coversDir: path.join(root, "covers"),
      signal: controller.signal,
    });
    assert.equal(result.tracks.length, 0, "an aborted scan indexes nothing");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("readTrack parses a single file and tolerates garbage", async () => {
  const root = makeTempDir();
  try {
    const flacPath = path.join(root, "single.flac");
    fs.writeFileSync(flacPath, makeFlac({ title: "Solo", artist: "Solo Artist", album: "Solo Album" }));

    const track = await readTrack(flacPath, path.join(root, "covers"));
    assert.ok(track, "track parsed");
    assert.equal(track.title, "Solo");

    const brokenPath = path.join(root, "broken.mp3");
    fs.writeFileSync(brokenPath, Buffer.from([0x00, 0x01, 0x02, 0x03]));
    const broken = await readTrack(brokenPath, path.join(root, "covers"));
    assert.ok(broken, "a malformed file still yields a track entry");
    assert.equal(broken.title, "broken", "falls back to the file name");
    assert.equal(broken.duration, 0, "duration is unknown rather than NaN");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
