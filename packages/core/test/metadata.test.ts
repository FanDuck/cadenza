/**
 * Metadata reader tests.
 *
 * Synthetic files are built in memory byte by byte (see the builders below):
 * they are deliberately tiny and heavily commented, because the parsers must
 * work for *correct* files even when the fixture is minimal. Every fixture is
 * fed through the same `ByteSource` abstraction the desktop app uses for real
 * files.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { bufferSource } from "../dist/metadata/source.js";
import { parseFlac } from "../dist/metadata/flac.js";
import { parseId3v2 } from "../dist/metadata/id3v2.js";
import { parseMp4 } from "../dist/metadata/mp4.js";
import { parseOgg } from "../dist/metadata/ogg.js";
import { parseWav } from "../dist/metadata/wav.js";
import { describeCodec, guessCodec, parseMetadata } from "../dist/metadata/index.js";

/* ------------------------------------------------------------- builders */

function ascii(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i += 1) out.push(text.charCodeAt(i) & 0xff);
  return out;
}

function u16be(value: number): number[] {
  return [(value >>> 8) & 0xff, value & 0xff];
}

function u16le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff];
}

function u24be(value: number): number[] {
  return [(value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function u32be(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function u32le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

function u64le(value: number): number[] {
  return [...u32le(value % 0x100000000), ...u32le(Math.floor(value / 0x100000000))];
}

/** ID3 synchsafe integer: 7 usable bits per byte. */
function synchsafe(value: number): number[] {
  return [(value >>> 21) & 0x7f, (value >>> 14) & 0x7f, (value >>> 7) & 0x7f, value & 0x7f];
}

function concat(parts: Array<number[] | Uint8Array>): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/* ----------------------------------------------------------- FLAC fixture */

function buildFlac(): Uint8Array {
  const sampleRate = 44100;
  const channels = 2;
  const bitsPerSample = 16;
  const totalSamples = 132300; // 3 seconds at 44.1 kHz

  // STREAMINFO: 10 bytes of block/frame size hints, then four packed fields
  // (20-bit sample rate, 3-bit channels-1, 5-bit bits-1, 36-bit total samples),
  // then a 16-byte MD5 signature that the reader ignores.
  const streamInfo: number[] = [
    0x10, 0x00, // minimum block size
    0x10, 0x00, // maximum block size
    0x00, 0x00, 0x00, // minimum frame size (unknown)
    0x00, 0x00, 0x00, // maximum frame size (unknown)
  ];
  const packed =
    (BigInt(sampleRate) << 44n) |
    (BigInt(channels - 1) << 41n) |
    (BigInt(bitsPerSample - 1) << 36n) |
    BigInt(totalSamples);
  for (let shift = 56n; shift >= 0n; shift -= 8n) {
    streamInfo.push(Number((packed >> shift) & 0xffn));
  }
  for (let i = 0; i < 16; i += 1) streamInfo.push(0);
  assert.equal(streamInfo.length, 34);

  const comments = [
    "TITLE=Test Title",
    "ARTIST=Test Artist",
    "ALBUM=Test Album",
    "ALBUMARTIST=Test Album Artist",
    "TRACKNUMBER=3/12",
    "DISCNUMBER=1/2",
    "DATE=2004-06-01",
    "GENRE=Rock",
  ];
  const vendor = ascii("cadenza");
  const commentBody: number[] = [...u32le(vendor.length), ...vendor, ...u32le(comments.length)];
  for (const comment of comments) {
    const encoded = ascii(comment);
    commentBody.push(...u32le(encoded.length), ...encoded);
  }

  // PICTURE: front cover (type 3) holding just a fake PNG signature.
  const image = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const pictureBody: number[] = [
    ...u32be(3), // picture type: front cover
    ...u32be(9), ...ascii("image/png"),
    ...u32be(0), // empty description
    ...u32be(1), ...u32be(1), ...u32be(24), ...u32be(0), // width, height, depth, colours
    ...u32be(image.length), ...image,
  ];

  const block = (type: number, body: number[], last: boolean): number[] => [
    (last ? 0x80 : 0x00) | type,
    ...u24be(body.length),
    ...body,
  ];

  return concat([
    ascii("fLaC"),
    block(0, streamInfo, false),
    block(4, commentBody, false),
    block(6, pictureBody, true),
  ]);
}

/* ------------------------------------------------------------ WAV fixture */

function buildWav(): Uint8Array {
  const channels = 1;
  const sampleRate = 8000;
  const bitsPerSample = 16;
  const byteRate = sampleRate * channels * (bitsPerSample / 8); // 16000 B/s
  const dataSize = byteRate; // exactly one second of silence

  const fmt = [
    ...u16le(1), // PCM
    ...u16le(channels),
    ...u32le(sampleRate),
    ...u32le(byteRate),
    ...u16le(channels * (bitsPerSample / 8)), // block align
    ...u16le(bitsPerSample),
  ];
  const chunk = (id: string, body: number[] | Uint8Array): number[] => [
    ...ascii(id),
    ...u32le(body.length),
    ...body,
  ];
  const fmtChunk = chunk("fmt ", fmt);
  const dataChunk = chunk("data", new Uint8Array(dataSize));
  const riffSize = 4 + fmtChunk.length + dataChunk.length; // "WAVE" + chunks

  return concat([
    ascii("RIFF"),
    new Uint8Array(u32le(riffSize)),
    ascii("WAVE"),
    new Uint8Array(fmtChunk),
    new Uint8Array(dataChunk),
  ]);
}

/* ----------------------------------------------------------- ID3 fixtures */

/** One ID3v2.3/v2.4 frame; v2.3 uses plain sizes, v2.4 synchsafe ones. */
function id3Frame(id: string, payload: number[], synchsafeSize = true): number[] {
  const size = synchsafeSize ? synchsafe(payload.length) : u32be(payload.length);
  return [...ascii(id), ...size, 0x00, 0x00, ...payload];
}

/** Text frame payload: encoding byte 0 (latin1), 1 (UTF-16 BOM) or 3 (UTF-8). */
function textPayload(text: string, encoding: number): number[] {
  if (encoding === 0) return [0x00, ...ascii(text)];
  if (encoding === 3) return [0x03, ...ascii(text)];
  const bytes: number[] = [0x01, 0xff, 0xfe]; // encoding 1 + little-endian BOM
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    bytes.push(code & 0xff, code >>> 8);
  }
  return bytes;
}

/** APIC payload: encoding, MIME + NUL, picture type, empty description, image. */
function apicPayload(type: number, mime: string, image: number[]): number[] {
  return [0x00, ...ascii(mime), 0x00, type, 0x00, ...image];
}

/** One MPEG-1 Layer III frame header at 128 kbps / 44.1 kHz / stereo. */
function mpegAudioFrame(): Uint8Array {
  const frameLength = Math.floor((1152 / 8) * (128000 / 44100)); // 417 bytes
  const frame = new Uint8Array(frameLength);
  frame.set([0xff, 0xfb, 0x90, 0x00], 0);
  return frame;
}

function buildMp3V24(): Uint8Array {
  const frames: number[] = [
    ...id3Frame("TIT2", textPayload("Tagged Title", 3)),
    ...id3Frame("TPE1", textPayload("Tagged Artist", 0)),
    ...id3Frame("TALB", textPayload("Tagged Album", 0)),
    ...id3Frame("TPE2", textPayload("Album Artist", 0)),
    ...id3Frame("TDRC", textPayload("2004-06-01", 0)),
    ...id3Frame("TRCK", textPayload("7/12", 0)),
    ...id3Frame("TPOS", textPayload("1/2", 0)),
    ...id3Frame("TCON", textPayload("(17)", 0)),
    // Two pictures: a generic one first, the front cover second.
    ...id3Frame("APIC", apicPayload(0, "image/jpeg", [0xff, 0xd8, 0xff, 0xe0])),
    ...id3Frame("APIC", apicPayload(3, "image/png", [0x89, 0x50, 0x4e, 0x47])),
  ];
  const header = [...ascii("ID3"), 0x04, 0x00, 0x00, ...synchsafe(frames.length)];
  return concat([new Uint8Array(header), new Uint8Array(frames), mpegAudioFrame()]);
}

function buildMp3V23(): Uint8Array {
  const frames: number[] = [
    ...id3Frame("TIT2", textPayload("Version Three", 0), false),
    ...id3Frame("TYER", textPayload("1999", 0), false),
    ...id3Frame("TRCK", textPayload("4/9", 0), false),
    ...id3Frame("APIC", apicPayload(0, "image/jpeg", [0xff, 0xd8, 0xff, 0xe0]), false),
  ];
  const header = [...ascii("ID3"), 0x03, 0x00, 0x00, ...synchsafe(frames.length)];
  return concat([new Uint8Array(header), new Uint8Array(frames), mpegAudioFrame()]);
}

/* ------------------------------------------------------------ Ogg fixture */

function oggPage(
  headerType: number,
  granule: number,
  serial: number,
  sequence: number,
  lacing: number[],
  payload: number[],
): number[] {
  return [
    ...ascii("OggS"),
    0x00, // stream structure version
    headerType,
    ...u64le(granule),
    ...u32le(serial),
    ...u32le(sequence),
    0x00, 0x00, 0x00, 0x00, // CRC (this reader does not validate it)
    lacing.length,
    ...lacing,
    ...payload,
  ];
}

function buildOggVorbis(): Uint8Array {
  // Identification header: version, channels, sample rate, three bitrates.
  const identify = [
    0x01, ...ascii("vorbis"),
    ...u32le(0),
    0x02, // channels
    ...u32le(44100),
    ...u32le(0), ...u32le(128000), ...u32le(0), // maximum, nominal, minimum bitrate
    0x00, 0x01, // blocksize, framing
  ];

  const comments = ["TITLE=Ogg Title", "ARTIST=Ogg Artist", "ALBUM=Ogg Album", "DATE=2001", "TRACKNUMBER=2", "GENRE=Ambient"];
  const vendor = ascii("cadenza");
  const commentBody: number[] = [...u32le(vendor.length), ...vendor, ...u32le(comments.length)];
  for (const comment of comments) {
    const encoded = ascii(comment);
    commentBody.push(...u32le(encoded.length), ...encoded);
  }
  const commentPacket = [0x03, ...ascii("vorbis"), ...commentBody, 0x01]; // framing bit

  const serial = 42;
  return concat([
    new Uint8Array(oggPage(0x02, 0, serial, 0, [identify.length], identify)), // BOS
    new Uint8Array(oggPage(0x00, 0, serial, 1, [commentPacket.length], commentPacket)),
    new Uint8Array(oggPage(0x04, 44100 * 2, serial, 2, [], [])), // EOS, granule = 2 seconds
  ]);
}

/* ------------------------------------------------------------ MP4 fixture */

function atom(type: string, ...children: number[][]): number[] {
  const body = children.flat();
  return [...u32be(8 + body.length), ...ascii(type), ...body];
}

/** `data` atom of an `ilst` entry: version/flags type, locale, payload. */
function ilstData(dataType: number, payload: number[]): number[] {
  return atom("data", u32be(dataType), u32be(0), payload);
}

function buildMp4(): Uint8Array {
  const ftyp = atom("ftyp", ascii("M4A "), u32be(0), ascii("M4A "), ascii("isom"));

  const mvhd = atom(
    "mvhd",
    u32be(0), // version 0, flags 0
    u32be(0), u32be(0), // creation, modification
    u32be(1000), // movie timescale
    u32be(3000), // duration = 3 seconds
  );

  const mdhd = atom(
    "mdhd",
    u32be(0),
    u32be(0), u32be(0),
    u32be(44100), // track timescale
    u32be(132300),
  );

  // AudioSampleEntry: 8-byte atom header, 6 reserved bytes, data ref, then
  // version/revision/vendor, channels, sample size, codes, 16.16 sample rate.
  const sampleEntry = atom(
    "mp4a",
    new Array<number>(6).fill(0),
    u16be(1), // data reference index
    u32be(0), // version + revision
    u32be(0), // vendor
    u16be(2), // channels
    u16be(16), // sample size
    u16be(0), u16be(0),
    u32be(44100 << 16), // sample rate as 16.16 fixed point
  );
  const stsd = atom("stsd", u32be(0), u32be(1), sampleEntry);
  const stbl = atom("stbl", stsd);
  const minf = atom("minf", stbl);
  const mdia = atom("mdia", mdhd, minf);
  const trak = atom("trak", mdia);

  const ilst = atom(
    "ilst",
    atom("\u00a9nam", ilstData(1, ascii("M4A Title"))),
    atom("\u00a9ART", ilstData(1, ascii("M4A Artist"))),
    atom("\u00a9alb", ilstData(1, ascii("M4A Album"))),
    atom("aART", ilstData(1, ascii("M4A Album Artist"))),
    atom("\u00a9day", ilstData(1, ascii("2004-06-01"))),
    atom("trkn", ilstData(0, [0x00, 0x00, 0x00, 0x07, 0x00, 0x0c])),
    atom("disk", ilstData(0, [0x00, 0x00, 0x00, 0x01, 0x00, 0x02])),
    atom("gnre", ilstData(0, [0x00, 0x12])), // 18 = ID3 genre index 17 ("Rock")
    atom("covr", ilstData(13, [0xff, 0xd8, 0xff, 0xe0])),
  );
  // `meta` is a full box: four version/flags bytes before its children.
  const meta = atom("meta", u32be(0), ilst);
  const udta = atom("udta", meta);
  const moov = atom("moov", mvhd, trak, udta);

  return concat([new Uint8Array(ftyp), new Uint8Array(moov)]);
}

/* ----------------------------------------------------------------- tests */

test("bufferSource clamps reads and returns views", async () => {
  const bytes = new Uint8Array([1, 2, 3, 4, 5]);
  const source = bufferSource(bytes);

  assert.equal(source.size, 5);
  assert.deepEqual([...(await source.read(1, 2))], [2, 3]);
  assert.deepEqual([...(await source.read(4, 100))], [5]); // short read at EOF
  assert.deepEqual([...(await source.read(10, 2))], []); // out of bounds
  assert.deepEqual([...(await source.read(2, -1))], []); // negative length
});

test("parseFlac reads STREAMINFO, Vorbis comments and the front cover", async () => {
  const metadata = await parseFlac(bufferSource(buildFlac()), "C:\\Music\\fixture.flac");

  assert.equal(metadata.title, "Test Title");
  assert.equal(metadata.artist, "Test Artist");
  assert.equal(metadata.album, "Test Album");
  assert.equal(metadata.albumArtist, "Test Album Artist");
  assert.equal(metadata.genre, "Rock");
  assert.equal(metadata.year, 2004);
  assert.equal(metadata.trackNo, 3);
  assert.equal(metadata.discNo, 1);
  assert.equal(metadata.sampleRate, 44100);
  assert.equal(metadata.channels, 2);
  assert.equal(metadata.codec, "FLAC");
  assert.ok(Math.abs(metadata.duration - 3) < 1e-9);
  assert.ok((metadata.bitrate ?? 0) > 0);
  assert.equal(metadata.cover?.mime, "image/png");
  assert.equal(metadata.cover?.data.length, 8);
});

test("parseFlac falls back to the file name for non-FLAC data", async () => {
  const metadata = await parseFlac(bufferSource(new Uint8Array([1, 2, 3, 4, 5])), "folder/mystery.flac");
  assert.equal(metadata.title, "mystery");
  assert.equal(metadata.duration, 0);
  assert.equal(metadata.codec, "FLAC");
});

test("parseWav reads the fmt and data chunks", async () => {
  const metadata = await parseWav(bufferSource(buildWav()), "sound.wav");

  assert.equal(metadata.title, "sound");
  assert.equal(metadata.codec, "WAV");
  assert.equal(metadata.channels, 1);
  assert.equal(metadata.sampleRate, 8000);
  assert.equal(metadata.bitrate, 128); // 16000 B/s * 8 / 1000
  assert.ok(Math.abs(metadata.duration - 1) < 1e-9);
});

test("parseId3v2 reads ID3v2.4 frames, prefers the front cover and probes MPEG audio", async () => {
  const metadata = await parseId3v2(bufferSource(buildMp3V24()), "C:\\Music\\tagged.mp3");

  assert.equal(metadata.title, "Tagged Title");
  assert.equal(metadata.artist, "Tagged Artist");
  assert.equal(metadata.album, "Tagged Album");
  assert.equal(metadata.albumArtist, "Album Artist");
  assert.equal(metadata.genre, "Rock");
  assert.equal(metadata.year, 2004);
  assert.equal(metadata.trackNo, 7);
  assert.equal(metadata.discNo, 1);
  assert.equal(metadata.codec, "MP3");
  assert.equal(metadata.bitrate, 128);
  assert.equal(metadata.sampleRate, 44100);
  assert.equal(metadata.channels, 2);
  assert.ok((metadata.duration ?? 0) > 0 && (metadata.duration ?? 0) < 1); // estimated from file size
  assert.equal(metadata.cover?.mime, "image/png"); // type 3 wins over the earlier type 0
  assert.equal(metadata.cover?.data.length, 4);
});

test("parseId3v2 reads ID3v2.3 frames with plain 32-bit sizes", async () => {
  const metadata = await parseId3v2(bufferSource(buildMp3V23()), "old.mp3");

  assert.equal(metadata.title, "Version Three");
  assert.equal(metadata.year, 1999);
  assert.equal(metadata.trackNo, 4);
  assert.equal(metadata.codec, "MP3");
  assert.equal(metadata.bitrate, 128);
  assert.equal(metadata.cover?.mime, "image/jpeg");
});

test("parseId3v2 tolerates plain sizes inside an ID3v2.4 tag", async () => {
  const title = id3Frame("TIT2", textPayload("Fallback Title", 3));
  // 200 bytes long: the synchsafe reading of [0,0,0,200] would be 72 and land
  // inside the payload, where the spaces cannot look like a frame id.
  const albumPayload = textPayload("ALBUM" + " ".repeat(194), 3);
  const album = id3Frame("TALB", albumPayload, false); // plain size
  const frames = [...title, ...album];
  const header = [...ascii("ID3"), 0x04, 0x00, 0x00, ...synchsafe(frames.length)];

  const metadata = await parseId3v2(bufferSource(concat([new Uint8Array(header), new Uint8Array(frames)])), "plain.mp3");

  assert.equal(metadata.title, "Fallback Title");
  assert.equal(metadata.album, "ALBUM");
});

test("parseId3v2 decodes UTF-16 text with a BOM", async () => {
  const frames = [...id3Frame("TIT2", textPayload("UTF-16 Title", 1))];
  const header = [...ascii("ID3"), 0x04, 0x00, 0x00, ...synchsafe(frames.length)];

  const metadata = await parseId3v2(
    bufferSource(concat([new Uint8Array(header), new Uint8Array(frames)])),
    "utf16.mp3",
  );

  assert.equal(metadata.title, "UTF-16 Title");
  assert.equal(metadata.duration, 0);
});

test("parseOgg reads Vorbis comments and uses the last granule for duration", async () => {
  const metadata = await parseOgg(bufferSource(buildOggVorbis()), "fixture.ogg");

  assert.equal(metadata.title, "Ogg Title");
  assert.equal(metadata.artist, "Ogg Artist");
  assert.equal(metadata.album, "Ogg Album");
  assert.equal(metadata.year, 2001);
  assert.equal(metadata.trackNo, 2);
  assert.equal(metadata.genre, "Ambient");
  assert.equal(metadata.codec, "Vorbis");
  assert.equal(metadata.sampleRate, 44100);
  assert.equal(metadata.channels, 2);
  assert.equal(metadata.bitrate, 128); // nominal bitrate from the identification header
  assert.ok(Math.abs(metadata.duration - 2) < 1e-9);
});

test("parseMp4 walks atoms, ilst metadata and the audio sample entry", async () => {
  const metadata = await parseMp4(bufferSource(buildMp4()), "C:\\Music\\fixture.m4a");

  assert.equal(metadata.title, "M4A Title");
  assert.equal(metadata.artist, "M4A Artist");
  assert.equal(metadata.album, "M4A Album");
  assert.equal(metadata.albumArtist, "M4A Album Artist");
  assert.equal(metadata.year, 2004);
  assert.equal(metadata.trackNo, 7);
  assert.equal(metadata.discNo, 1);
  assert.equal(metadata.genre, "Rock");
  assert.equal(metadata.codec, "AAC");
  assert.equal(metadata.channels, 2);
  assert.equal(metadata.sampleRate, 44100);
  assert.ok(Math.abs(metadata.duration - 3) < 1e-9);
  assert.equal(metadata.cover?.mime, "image/jpeg");
});

test("parseMetadata dispatches on the file extension", async () => {
  const flac = await parseMetadata(bufferSource(buildFlac()), "C:\\Music\\fixture.flac");
  assert.equal(flac.title, "Test Title");
  assert.equal(flac.codec, "FLAC");
  assert.ok(Math.abs(flac.duration - 3) < 1e-9);

  const wav = await parseMetadata(bufferSource(buildWav()), "fixture.wav");
  assert.equal(wav.title, "fixture");
  assert.equal(wav.codec, "WAV");
  assert.ok(Math.abs(wav.duration - 1) < 1e-9);

  const mp3 = await parseMetadata(bufferSource(buildMp3V24()), "fixture.MP3"); // uppercase extension
  assert.equal(mp3.title, "Tagged Title");
  assert.equal(mp3.codec, "MP3");

  const m4a = await parseMetadata(bufferSource(buildMp4()), "fixture.m4a");
  assert.equal(m4a.title, "M4A Title");
  assert.equal(m4a.codec, "AAC");

  const ogg = await parseMetadata(bufferSource(buildOggVorbis()), "fixture.opus");
  assert.equal(ogg.title, "Ogg Title");
  assert.equal(ogg.codec, "Vorbis"); // detected from the stream, not the extension
});

test("parseMetadata sniffs the format when the extension is unknown", async () => {
  const flac = await parseMetadata(bufferSource(buildFlac()), "no-extension");
  assert.equal(flac.title, "Test Title");
  assert.equal(flac.codec, "FLAC");

  const mp4 = await parseMetadata(bufferSource(buildMp4()), "no-extension");
  assert.equal(mp4.title, "M4A Title");
  assert.equal(mp4.codec, "AAC");

  const wav = await parseMetadata(bufferSource(buildWav()), "no-extension");
  assert.equal(wav.title, "no-extension");
  assert.equal(wav.codec, "WAV");
});

test("parseMetadata never throws and falls back to the file base name", async () => {
  const garbage = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);
  const metadata = await parseMetadata(bufferSource(garbage), "C:\\Music\\Untitled Track.mp3");

  assert.equal(metadata.title, "Untitled Track");
  assert.equal(metadata.duration, 0);
  assert.equal(metadata.codec, "MP3");

  const unknown = await parseMetadata(bufferSource(garbage), "folder/Mystery Song.xyz");
  assert.equal(unknown.title, "Mystery Song");
  assert.equal(unknown.duration, 0);
  assert.equal(unknown.codec, undefined);
});

test("parseMetadata survives truncated files", async () => {
  const bytes = buildFlac();
  for (const length of [0, 2, 8, 20]) {
    const metadata = await parseMetadata(bufferSource(bytes.subarray(0, length)), "broken.flac");
    assert.equal(metadata.title, "broken");
    assert.equal(metadata.duration, 0);
    assert.equal(metadata.codec, "FLAC");
  }
});

test("guessCodec and describeCodec produce human labels", () => {
  assert.equal(guessCodec("song.mp3"), "MP3");
  assert.equal(guessCodec("song.FLAC"), "FLAC");
  assert.equal(guessCodec("song.ogg"), "Vorbis");
  assert.equal(guessCodec("song.opus"), "Opus");
  assert.equal(guessCodec("song.m4a"), "AAC");
  assert.equal(guessCodec("song.wav"), "WAV");
  assert.equal(guessCodec("song.xyz"), "");

  assert.equal(describeCodec("FLAC", 900, 44100), "FLAC · 44.1 kHz · 900 kbps");
  assert.equal(describeCodec("MP3", 128, 44100), "MP3 · 44.1 kHz · 128 kbps");
  assert.equal(describeCodec("Opus", undefined, 48000), "Opus · 48 kHz");
  assert.equal(describeCodec("WAV"), "WAV");
  assert.equal(describeCodec(undefined, 320, 96000), "Unknown · 96 kHz · 320 kbps");
});
