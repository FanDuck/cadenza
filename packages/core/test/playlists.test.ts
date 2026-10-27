/**
 * Tests for M3U/PLS reading and writing plus format detection.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { detectPlaylistFormat, parseM3u, parsePls, serializeM3u } from "../dist/playlists/index.js";

test("parseM3u handles #EXTM3U, #EXTINF and Windows paths", () => {
  const text = [
    "#EXTM3U",
    "# a plain comment that must be ignored",
    "",
    "#EXTINF:187,First Song",
    "C:\\Music\\first.mp3",
    "#EXTINF:-1,Unknown Length",
    "second.mp3",
  ].join("\r\n");

  const playlist = parseM3u(text, "C:\\Music");

  assert.equal(playlist.format, "m3u");
  assert.equal(playlist.entries.length, 2);
  assert.deepEqual(playlist.entries[0], {
    path: "C:\\Music\\first.mp3",
    duration: 187,
    title: "First Song",
  });
  assert.deepEqual(playlist.entries[1], {
    path: "C:\\Music\\second.mp3",
    title: "Unknown Length",
  });
});

test("parseM3u resolves relative paths against a POSIX base", () => {
  const text = ["#EXTM3U", "sub/song.flac", "/absolute/song.mp3", "./local.ogg"].join("\n");
  const playlist = parseM3u(text, "/music");

  assert.equal(playlist.entries.length, 3);
  assert.equal(playlist.entries[0]?.path, "/music/sub/song.flac");
  assert.equal(playlist.entries[1]?.path, "/absolute/song.mp3");
  assert.equal(playlist.entries[2]?.path, "/music/local.ogg");
});

test("parseM3u leaves paths untouched without a base directory", () => {
  const playlist = parseM3u("relative\\song.mp3\nC:\\Music\\absolute.mp3");
  assert.equal(playlist.entries[0]?.path, "relative\\song.mp3");
  assert.equal(playlist.entries[1]?.path, "C:\\Music\\absolute.mp3");
});

test("parseM3u strips a UTF-8 BOM and reports m3u8 for non-ASCII content", () => {
  const bom = parseM3u("\uFEFF#EXTM3U\n#EXTINF:60,BOM Song\nbom.mp3");
  assert.equal(bom.entries.length, 1);
  assert.equal(bom.entries[0]?.path, "bom.mp3");
  assert.equal(bom.entries[0]?.duration, 60);
  assert.equal(bom.format, "m3u");

  const utf8 = parseM3u("#EXTM3U\n#EXTINF:60,日本語\nutf8.mp3");
  assert.equal(utf8.format, "m3u8");
});

test("serializeM3u writes #EXTM3U, #EXTINF and paths that parse back", () => {
  const text = serializeM3u([
    { path: "a.mp3", duration: 187.4, title: "A Song" },
    { path: "b.mp3" },
  ]);

  assert.ok(text.startsWith("#EXTM3U\n"));
  assert.ok(text.includes("#EXTINF:187,A Song\na.mp3\n"));

  const parsed = parseM3u(text);
  assert.equal(parsed.entries[0]?.path, "a.mp3");
  assert.equal(parsed.entries[0]?.title, "A Song");
  assert.equal(parsed.entries[0]?.duration, 187);
  assert.equal(parsed.entries[1]?.path, "b.mp3");
  assert.equal(parsed.entries[1]?.duration, 0);
});

test("parsePls groups FileN/TitleN/LengthN entries and resolves paths", () => {
  const text = [
    "[playlist]",
    "NumberOfEntries=2",
    "File1=C:\\Music\\alpha.mp3",
    "Title1=Alpha",
    "Length1=100",
    "File2=beta.mp3",
    "Title2=Beta",
    "Length2=200",
    "Version=2",
  ].join("\r\n");

  const playlist = parsePls(text, "C:\\Music");

  assert.equal(playlist.format, "pls");
  assert.deepEqual(playlist.entries, [
    { path: "C:\\Music\\alpha.mp3", title: "Alpha", duration: 100 },
    { path: "C:\\Music\\beta.mp3", title: "Beta", duration: 200 },
  ]);
});

test("parsePls ignores orphans and non-entry keys", () => {
  const playlist = parsePls("[playlist]\nTitle1=Only a title\nFile2=second.mp3\nLength2=-1");
  assert.equal(playlist.entries.length, 1);
  assert.equal(playlist.entries[0]?.path, "second.mp3");
  assert.equal(playlist.entries[0]?.title, undefined);
  assert.equal(playlist.entries[0]?.duration, undefined);
});

test("detectPlaylistFormat prefers content and falls back to extension", () => {
  assert.equal(detectPlaylistFormat("mix.m3u"), "m3u");
  assert.equal(detectPlaylistFormat("mix.M3U8"), "m3u8");
  assert.equal(detectPlaylistFormat("mix.pls"), "pls");
  assert.equal(detectPlaylistFormat("session.cadenza"), "cadenza");
  assert.equal(detectPlaylistFormat("library.json"), "cadenza");
  assert.equal(detectPlaylistFormat("unknown.txt"), "m3u");

  assert.equal(detectPlaylistFormat("unknown.txt", "[playlist]\nFile1=a.mp3"), "pls");
  assert.equal(detectPlaylistFormat("unknown.txt", "#EXTM3U\nsong.mp3"), "m3u");
  assert.equal(detectPlaylistFormat("unknown.txt", '{"tracks":[]}'), "cadenza");
  assert.equal(detectPlaylistFormat("mix.m3u8", "#EXTM3U\nsong.mp3"), "m3u8");
});
