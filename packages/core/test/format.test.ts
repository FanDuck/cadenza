/**
 * Tests for the formatting helpers.
 *
 * The compiled output in `dist/` is imported directly because the tests are
 * plain Node scripts (Node's built-in TypeScript type stripping handles these
 * files; `tsc` compiles the package first).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { clamp, formatBytes, formatDuration, formatTime, hashId } from "../dist/util/format.js";

test("formatTime renders m:ss and h:mm:ss", () => {
  assert.equal(formatTime(0), "0:00");
  assert.equal(formatTime(7), "0:07");
  assert.equal(formatTime(59.9), "0:59");
  assert.equal(formatTime(60), "1:00");
  assert.equal(formatTime(187), "3:07");
  assert.equal(formatTime(600), "10:00");
  assert.equal(formatTime(3599), "59:59");
  assert.equal(formatTime(3600), "1:00:00");
  assert.equal(formatTime(3753), "1:02:33");
});

test("formatTime degrades gracefully for invalid input", () => {
  assert.equal(formatTime(Number.NaN), "0:00");
  assert.equal(formatTime(-1), "0:00");
  assert.equal(formatTime(-187.5), "0:00");
  assert.equal(formatTime(Number.POSITIVE_INFINITY), "0:00");
  assert.equal(formatTime(Number.NEGATIVE_INFINITY), "0:00");
});

test("formatDuration is an alias of formatTime", () => {
  assert.equal(formatDuration(187), "3:07");
  assert.equal(formatDuration(3753), "1:02:33");
  assert.equal(formatDuration(Number.NaN), "0:00");
});

test("formatBytes uses binary units with one decimal", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1024), "1.0 KB");
  assert.equal(formatBytes(1536000), "1.5 MB");
  assert.equal(formatBytes(13002342), "12.4 MB");
  assert.equal(formatBytes(-5), "0 B");
  assert.equal(formatBytes(Number.NaN), "0 B");
});

test("hashId is deterministic, stable across calls and well formed", () => {
  const first = hashId("C:/Music/song.mp3");
  const second = hashId("C:/Music/song.mp3");

  assert.equal(first, second);
  assert.match(first, /^[0-9a-z]{8}$/);
  // FNV-1a anchor: guards against accidental algorithm changes.
  assert.equal(hashId("cadenza"), "01jvn25x");
});

test("hashId separates different inputs", () => {
  const inputs = ["", "a", "b", "song.mp3", "SONG.MP3", "C:/Music/song.mp3"];
  const ids = inputs.map((input) => hashId(input));
  assert.equal(new Set(ids).size, inputs.length);
  for (const id of ids) assert.match(id, /^[0-9a-z]{8}$/);
});

test("hashId is stable for non-ASCII input", () => {
  assert.equal(hashId("日本語 — song"), hashId("日本語 — song"));
  assert.match(hashId("日本語 — song"), /^[0-9a-z]{8}$/);
});

test("clamp keeps values inside the range", () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(11, 0, 10), 10);
  assert.equal(clamp(0, 0, 10), 0);
  assert.equal(clamp(10, 0, 10), 10);
  assert.equal(clamp(Number.NaN, 2, 8), 2);
});
