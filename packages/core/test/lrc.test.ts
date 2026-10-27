/**
 * Tests for the LRC reader: timestamps, metadata tags, offset handling,
 * active-line lookup and serialization round-trips.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { findActiveLine, parseLrc, serializeLrc } from "../dist/lyrics/lrc.js";

test("parseLrc reads timestamps and multiple timestamps per line", () => {
  const doc = parseLrc(
    [
      "[ti:Demo Song]",
      "[ar:The Artist]",
      "[al:Demo Album]",
      "[00:12.34][01:20.00]Hello",
      "[01:05]Plain",
      "[00:01.5]Short fraction",
    ].join("\n"),
  );

  assert.equal(doc.source, "sidecar");
  // Sorted by time: 1.5, 12.34, 65, 80.
  assert.deepEqual(doc.lines.map((line) => line.time), [1.5, 12.34, 65, 80]);
  assert.deepEqual(doc.lines.map((line) => line.text), ["Short fraction", "Hello", "Plain", "Hello"]);
  assert.equal(doc.raw, [
    "[ti:Demo Song]",
    "[ar:The Artist]",
    "[al:Demo Album]",
    "[00:12.34][01:20.00]Hello",
    "[01:05]Plain",
    "[00:01.5]Short fraction",
  ].join("\n"));
});

test("parseLrc accepts [mm:ss:xx] timestamps and 3-digit fractions", () => {
  const doc = parseLrc("[00:12:50]Colon fraction\n[01:02.345]Milliseconds");
  assert.equal(doc.lines.length, 2);
  assert.equal(doc.lines[0]?.time, 12.5);
  assert.equal(doc.lines[0]?.text, "Colon fraction");
  assert.ok(Math.abs((doc.lines[1]?.time ?? 0) - 62.345) < 1e-9);
});

test("parseLrc sorts out-of-order input", () => {
  const doc = parseLrc("[00:30.00]C\n[00:10.00]A\n[00:20.00]B");
  assert.deepEqual(doc.lines.map((line) => line.text), ["A", "B", "C"]);
  assert.deepEqual(doc.lines.map((line) => line.time), [10, 20, 30]);
});

test("parseLrc merges entries that share a timestamp", () => {
  const doc = parseLrc("[00:05.00]\n[00:05.00]First words\n[00:09.00]");
  assert.equal(doc.lines.length, 2);
  assert.equal(doc.lines[0]?.text, "First words");
  assert.equal(doc.lines[0]?.time, 5);
  assert.equal(doc.lines[1]?.text, "");
});

test("parseLrc stores the offset tag in seconds", () => {
  const doc = parseLrc("[offset:-500]\n[00:10.00]First");
  assert.equal(doc.offset, -0.5);
  assert.equal(doc.lines.length, 1);
});

test("findActiveLine applies the offset", () => {
  const doc = parseLrc("[offset:-500]\n[00:10.00]First\n[00:20.00]Second");

  // target = position + offset (offset is negative here).
  assert.equal(findActiveLine(doc, 10.4), -1); // target 9.9, before the first line
  assert.equal(findActiveLine(doc, 10.5), 0); // target 10.0
  assert.equal(findActiveLine(doc, 19.9), 0); // target 19.4
  assert.equal(findActiveLine(doc, 20.5), 1); // target 20.0

  const positive = parseLrc("[offset:+500]\n[00:10.00]First");
  assert.equal(positive.offset, 0.5);
  assert.equal(findActiveLine(positive, 9.6), 0); // target 10.1
  assert.equal(findActiveLine(positive, 9.4), -1); // target 9.9
});

test("findActiveLine returns boundaries and -1 before the first line", () => {
  const doc = parseLrc("[00:10.00]A\n[00:20.00]B");

  assert.equal(findActiveLine(doc, -100), -1);
  assert.equal(findActiveLine(doc, 0), -1);
  assert.equal(findActiveLine(doc, 9.99), -1);
  assert.equal(findActiveLine(doc, 10), 0);
  assert.equal(findActiveLine(doc, 19.999), 0);
  assert.equal(findActiveLine(doc, 20), 1);
  assert.equal(findActiveLine(doc, 999), 1);
  assert.equal(findActiveLine(doc, Number.NaN), -1);
  assert.equal(findActiveLine({ lines: [], offset: 0, source: "sidecar" }, 5), -1);
});

test("serializeLrc round-trips through parseLrc", () => {
  const original = parseLrc("[offset:+250]\n[00:12.34]Hello\n[01:20.00]World");
  const text = serializeLrc(original);

  assert.ok(text.includes("[offset:+250]"));
  assert.ok(text.includes("[00:12.34]Hello"));
  assert.ok(text.includes("[01:20.00]World"));

  const reparsed = parseLrc(text);
  assert.equal(reparsed.offset, 0.25);
  assert.equal(reparsed.lines.length, 2);
  assert.equal(reparsed.lines[0]?.text, "Hello");
  assert.equal(reparsed.lines[1]?.text, "World");
  assert.ok(Math.abs((reparsed.lines[0]?.time ?? 0) - 12.34) < 1e-9);
  assert.ok(Math.abs((reparsed.lines[1]?.time ?? 0) - 80) < 1e-9);
  assert.deepEqual(reparsed.lines.map((line) => line.time), original.lines.map((line) => line.time));
});

test("serializeLrc omits a zero offset and keeps empty lines", () => {
  const doc = parseLrc("[00:05.00]\n[00:10.00]Text");
  const text = serializeLrc(doc);
  assert.equal(text, "[00:05.00]\n[00:10.00]Text");
  const reparsed = parseLrc(text);
  assert.equal(reparsed.lines.length, 2);
  assert.equal(reparsed.lines[0]?.text, "");
});

test("parseLrc ignores a BOM and unknown bracket lines", () => {
  const doc = parseLrc("\uFEFF[by:Someone]\n[00:01.00]Hi");
  assert.equal(doc.lines.length, 1);
  assert.equal(doc.lines[0]?.text, "Hi");
});
