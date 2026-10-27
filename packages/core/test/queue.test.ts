/**
 * Queue semantics: cursor stability, repeat modes, shuffle order and mutation.
 *
 * These tests import the compiled output (`dist/`) so they exercise exactly
 * what a consumer of the package loads.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { Queue } from "../dist/queue.js";
import type { Track } from "../dist/types.js";

function makeTrack(id: string, overrides: Partial<Track> = {}): Track {
  return {
    id,
    path: `C:/music/${id}.mp3`,
    title: `Title ${id}`,
    artist: "Artist",
    album: "Album",
    duration: 200,
    addedAt: 0,
    ...overrides,
  };
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

test("setTracks clamps the start index and reports the current track", () => {
  const queue = new Queue();
  assert.equal(queue.index, -1);
  assert.equal(queue.current, null);

  queue.setTracks([makeTrack("a"), makeTrack("b"), makeTrack("c")]);
  assert.equal(queue.length, 3);
  assert.equal(queue.index, 0);
  assert.equal(queue.current?.id, "a");

  queue.setTracks([makeTrack("a"), makeTrack("b")], 99);
  assert.equal(queue.index, 1);
  assert.equal(queue.current?.id, "b");

  queue.setTracks([], 3);
  assert.equal(queue.index, -1);
  assert.equal(queue.current, null);
});

test("add appends and selects the first track of an empty queue", () => {
  const queue = new Queue();
  queue.add([makeTrack("a")]);
  assert.equal(queue.index, 0);
  assert.equal(queue.current?.id, "a");

  queue.add([makeTrack("b"), makeTrack("c")]);
  assert.equal(queue.length, 3);
  assert.equal(queue.current?.id, "a");
});

test("insertAt shifts the cursor when inserting before it", () => {
  const queue = new Queue();
  queue.setTracks([makeTrack("a"), makeTrack("b"), makeTrack("c")], 1);

  queue.insertAt([makeTrack("x")], 0);
  assert.deepEqual(queue.items.map((track) => track.id), ["x", "a", "b", "c"]);
  assert.equal(queue.current?.id, "b");

  queue.insertAt([makeTrack("y")], 4);
  assert.deepEqual(queue.items.map((track) => track.id), ["x", "a", "b", "c", "y"]);
  assert.equal(queue.current?.id, "b");
});

test("removeAt keeps the cursor on the same track and clamps at the end", () => {
  const queue = new Queue();
  queue.setTracks([makeTrack("a"), makeTrack("b"), makeTrack("c"), makeTrack("d")], 2);

  const removedBefore = queue.removeAt(1);
  assert.equal(removedBefore?.id, "b");
  assert.equal(queue.index, 1);
  assert.equal(queue.current?.id, "c");

  const removedCurrent = queue.removeAt(1);
  assert.equal(removedCurrent?.id, "c");
  assert.equal(queue.index, 1);
  assert.equal(queue.current?.id, "d");

  queue.removeAt(1);
  assert.equal(queue.index, 0);
  assert.equal(queue.current?.id, "a");

  assert.equal(queue.removeAt(99), null);
  assert.equal(queue.removeAt(-1), null);
});

test("removeAt empties the queue cleanly", () => {
  const queue = new Queue();
  queue.setTracks([makeTrack("a")]);
  assert.equal(queue.removeAt(0)?.id, "a");
  assert.equal(queue.length, 0);
  assert.equal(queue.index, -1);
  assert.equal(queue.current, null);
});

test("move keeps the current track current", () => {
  const queue = new Queue();
  queue.setTracks([makeTrack("a"), makeTrack("b"), makeTrack("c"), makeTrack("d")], 1);

  queue.move(1, 3);
  assert.deepEqual(queue.items.map((track) => track.id), ["a", "c", "d", "b"]);
  assert.equal(queue.current?.id, "b");
  assert.equal(queue.index, 3);

  queue.move(0, 2);
  assert.deepEqual(queue.items.map((track) => track.id), ["c", "d", "a", "b"]);
  assert.equal(queue.current?.id, "b");
  assert.equal(queue.index, 3);
});

test("replaceAt keeps the cursor index", () => {
  const queue = new Queue();
  queue.setTracks([makeTrack("a"), makeTrack("b")], 0);
  queue.replaceAt(0, makeTrack("z"));
  assert.equal(queue.current?.id, "z");
  assert.equal(queue.index, 0);
  queue.replaceAt(9, makeTrack("nope"));
  assert.deepEqual(queue.items.map((track) => track.id), ["z", "b"]);
});

test("repeat off stops at the end, repeat all wraps", () => {
  const queue = new Queue();
  queue.setTracks([makeTrack("a"), makeTrack("b"), makeTrack("c")], 2);
  assert.equal(queue.repeat, "off");
  assert.equal(queue.nextIndex(1), null);
  assert.equal(queue.advanceIndex(true), null);
  assert.equal(queue.index, 2);

  queue.setRepeat("all");
  assert.equal(queue.nextIndex(1), 0);
  assert.equal(queue.advanceIndex(true), 0);
  assert.equal(queue.current?.id, "a");
});

test("previous honours repeat off and repeat all", () => {
  const queue = new Queue();
  queue.setTracks([makeTrack("a"), makeTrack("b")], 0);
  assert.equal(queue.nextIndex(-1), null);

  queue.setRepeat("all");
  assert.equal(queue.nextIndex(-1), 1);
  queue.advanceIndex(true);
  assert.equal(queue.index, 1);
});

test("repeat one: user next moves, automatic advance repeats", () => {
  const queue = new Queue();
  queue.setTracks([makeTrack("a"), makeTrack("b"), makeTrack("c")], 1);
  queue.setRepeat("one");

  assert.equal(queue.advanceIndex(true), 1, "auto advance repeats the current track");
  assert.equal(queue.index, 1);
  assert.equal(queue.advanceIndex(false), 2, "a user next still moves forward");
  assert.equal(queue.index, 2);
  assert.equal(queue.advanceIndex(false), 0, "user next wraps like repeat all");
});

test("shuffle order is deterministic for the same random source", () => {
  const tracks = ["a", "b", "c", "d", "e", "f"].map((id) => makeTrack(id));
  const first = new Queue({ random: seededRandom(1234) });
  const second = new Queue({ random: seededRandom(1234) });
  first.setTracks(tracks);
  second.setTracks(tracks);
  first.setShuffle(true);
  second.setShuffle(true);
  first.setRepeat("all");
  second.setRepeat("all");

  for (let step = 0; step < 12; step++) {
    assert.equal(first.advanceIndex(true), second.advanceIndex(true));
  }
});

test("shuffle never repeats the current track immediately", () => {
  const tracks = ["a", "b", "c", "d", "e", "f"].map((id) => makeTrack(id));
  const queue = new Queue({ random: seededRandom(99) });
  queue.setTracks(tracks);
  queue.setShuffle(true);
  queue.setRepeat("all");

  let previous = queue.index;
  const visited: number[] = [];
  for (let step = 0; step < 24; step++) {
    const next = queue.advanceIndex(true);
    assert.notEqual(next, null);
    assert.notEqual(next, previous, "next track must differ from the current one");
    const current = next;
    if (current === null) break;
    visited.push(current);
    previous = current;
  }
  assert.equal(visited.length, 24);
});

test("turning shuffle off restores natural order", () => {
  const queue = new Queue({ random: seededRandom(7) });
  queue.setTracks([makeTrack("a"), makeTrack("b"), makeTrack("c")], 1);
  queue.setShuffle(true);
  assert.equal(queue.current?.id, "b");

  queue.setShuffle(false);
  assert.equal(queue.nextIndex(1), 2);
  assert.equal(queue.nextIndex(-1), 0);
});

test("mutations notify the change callback with a detached snapshot", () => {
  const states: Array<{ index: number; ids: string[] }> = [];
  const queue = new Queue({
    onChange: (state) => {
      states.push({ index: state.index, ids: state.items.map((track) => track.id) });
    },
  });

  queue.setTracks([makeTrack("a"), makeTrack("b")]);
  queue.add([makeTrack("c")]);

  assert.equal(states.length, 2);
  assert.deepEqual(states[1], { index: 0, ids: ["a", "b", "c"] });

  const serialized = queue.toJSON();
  assert.equal(serialized.index, 0);
  assert.equal(serialized.shuffle, false);
  assert.equal(serialized.repeat, "off");
  assert.notEqual(serialized.items, queue.items, "toJSON copies the item array");
});

test("clear resets items, cursor and shuffle bookkeeping", () => {
  const queue = new Queue({ random: seededRandom(5) });
  queue.setTracks([makeTrack("a"), makeTrack("b")], 1);
  queue.setShuffle(true);
  queue.clear();

  assert.equal(queue.length, 0);
  assert.equal(queue.index, -1);
  assert.equal(queue.current, null);
  assert.equal(queue.nextIndex(1), null);
  assert.equal(queue.advanceIndex(true), null);

  queue.add([makeTrack("x")]);
  assert.equal(queue.current?.id, "x");
  assert.equal(queue.nextIndex(1), null);
});
