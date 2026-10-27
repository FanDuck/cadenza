/**
 * Player behaviour against a fake in-memory AudioSink: state transitions,
 * transport controls, repeat handling, clamping and error surfacing.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { EventBus } from "../dist/events.js";
import { Player } from "../dist/player.js";
import type { SinkEvent, Track } from "../dist/types.js";

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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

class FakeSink {
  currentTime = 0;
  duration = 0;
  buffered = 0;
  volume = 1;
  muted = false;
  playCalls = 0;
  pauseCalls = 0;
  stopCalls = 0;
  disposeCalls = 0;
  loadCalls: Array<{ track: Track; url: string }> = [];
  loadError: Error | null = null;
  loadGate: Promise<void> | null = null;

  private listeners = new Map<SinkEvent, Set<(payload?: unknown) => void>>();

  async load(track: Track, url: string): Promise<void> {
    this.loadCalls.push({ track, url });
    this.duration = track.duration;
    if (this.loadGate) await this.loadGate;
    if (this.loadError) throw this.loadError;
  }

  async play(): Promise<void> {
    this.playCalls += 1;
  }

  pause(): void {
    this.pauseCalls += 1;
  }

  stop(): void {
    this.stopCalls += 1;
    this.currentTime = 0;
  }

  seek(seconds: number): void {
    this.currentTime = seconds;
  }

  setVolume(volume: number): void {
    this.volume = volume;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  on(event: SinkEvent, listener: (payload?: unknown) => void): () => void {
    let listeners = this.listeners.get(event);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(event, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners?.delete(listener);
    };
  }

  emit(event: SinkEvent, payload?: unknown): void {
    const listeners = this.listeners.get(event);
    if (!listeners) return;
    for (const listener of [...listeners]) listener(payload);
  }

  dispose(): void {
    this.disposeCalls += 1;
    this.listeners.clear();
  }
}

test("state transitions idle -> loading -> playing -> paused", async (t) => {
  const sink = new FakeSink();
  const bus = new EventBus();
  const player = new Player(sink, { bus });
  t.after(() => player.dispose());

  const states: string[] = [];
  bus.on("player:snapshot", (snapshot: { state: string }) => states.push(snapshot.state));

  assert.equal(player.snapshot.state, "idle");

  const playing = player.play(makeTrack("a"));
  assert.equal(player.snapshot.state, "loading");
  assert.equal(sink.loadCalls[0]?.url, "C:/music/a.mp3");

  await playing;
  assert.equal(player.snapshot.state, "playing");
  assert.equal(player.snapshot.track?.id, "a");
  assert.equal(player.snapshot.duration, 200);
  assert.equal(sink.playCalls, 1);

  player.pause();
  assert.equal(player.snapshot.state, "paused");
  assert.equal(sink.pauseCalls, 1);

  await player.toggle();
  assert.equal(player.snapshot.state, "playing");

  await player.toggle();
  assert.equal(player.snapshot.state, "paused");

  assert.deepEqual(states, ["idle", "loading", "paused", "playing", "paused", "playing", "paused"]);
});

test("play selects a track that is already in the queue", async (t) => {
  const sink = new FakeSink();
  const player = new Player(sink);
  t.after(() => player.dispose());

  player.queue.setTracks([makeTrack("a"), makeTrack("b"), makeTrack("c")]);
  await player.play(makeTrack("b"));

  assert.equal(player.queue.index, 1);
  assert.equal(player.snapshot.track?.id, "b");
});

test("play inserts an unknown track after the current one", async (t) => {
  const sink = new FakeSink();
  const player = new Player(sink);
  t.after(() => player.dispose());

  player.queue.setTracks([makeTrack("a"), makeTrack("b")], 0);
  await player.play(makeTrack("z"));

  assert.deepEqual(player.queue.items.map((track) => track.id), ["a", "z", "b"]);
  assert.equal(player.snapshot.track?.id, "z");
});

test("concurrent play calls are ignored while loading", async (t) => {
  const sink = new FakeSink();
  const player = new Player(sink);
  t.after(() => player.dispose());

  let release = (): void => {};
  sink.loadGate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const first = player.play(makeTrack("a"));
  const second = player.play(makeTrack("b"));
  await delay(0);
  assert.equal(sink.loadCalls.length, 1, "second load must be ignored");

  release();
  await first;
  await second;
  assert.equal(player.snapshot.track?.id, "a");
});

test("next and previous honour repeat off/all and queue boundaries", async (t) => {
  const sink = new FakeSink();
  const player = new Player(sink);
  t.after(() => player.dispose());

  player.queue.setTracks([makeTrack("a"), makeTrack("b"), makeTrack("c")], 0);
  await player.play();
  assert.equal(player.snapshot.track?.id, "a");

  await player.next();
  assert.equal(player.snapshot.track?.id, "b");

  await player.previous();
  assert.equal(player.snapshot.track?.id, "a");

  // repeat off, first track: previous restarts instead of stopping.
  await player.previous();
  assert.equal(player.snapshot.track?.id, "a");
  assert.equal(player.snapshot.position, 0);

  // repeat off, last track: next stops at the end.
  player.queue.setIndex(2);
  await player.play();
  await player.next();
  assert.equal(player.snapshot.state, "stopped");

  // repeat all wraps around.
  player.setRepeat("all");
  player.queue.setIndex(2);
  await player.play();
  await player.next();
  assert.equal(player.snapshot.track?.id, "a");
});

test("repeat one: automatic advance replays the same track", async (t) => {
  const sink = new FakeSink();
  const player = new Player(sink);
  t.after(() => player.dispose());

  player.queue.setTracks([makeTrack("a"), makeTrack("b"), makeTrack("c")], 1);
  player.setRepeat("one");
  await player.play();
  assert.equal(player.snapshot.track?.id, "b");

  const playsBefore = sink.playCalls;
  sink.emit("ended");
  await delay(0);

  assert.equal(player.queue.index, 1);
  assert.equal(player.snapshot.track?.id, "b");
  assert.equal(player.snapshot.state, "playing");
  assert.equal(sink.playCalls, playsBefore + 1);

  // A user next still moves on despite repeat one.
  await player.next();
  assert.equal(player.snapshot.track?.id, "c");
});

test("automatic advance moves to the next track and respects racing next()", async (t) => {
  const sink = new FakeSink();
  const player = new Player(sink);
  t.after(() => player.dispose());

  player.queue.setTracks([makeTrack("a"), makeTrack("b"), makeTrack("c")], 0);
  await player.play();

  sink.emit("ended");
  // The ended handler already started loading track b; this must not skip to c.
  await player.next();
  await delay(0);

  assert.equal(player.queue.index, 1);
  assert.equal(player.snapshot.track?.id, "b");
  assert.equal(sink.loadCalls[sink.loadCalls.length - 1]?.track.id, "b");
});

test("seek clamps to [0, duration] and volume clamps to [0, 1]", async (t) => {
  const sink = new FakeSink();
  const player = new Player(sink);
  t.after(() => player.dispose());

  await player.play(makeTrack("a", { duration: 180 }));
  assert.equal(player.snapshot.duration, 180);

  player.seek(-20);
  assert.equal(sink.currentTime, 0);
  assert.equal(player.snapshot.position, 0);

  player.seek(999);
  assert.equal(sink.currentTime, 180);
  assert.equal(player.snapshot.position, 180);

  player.seek(90);
  assert.equal(sink.currentTime, 90);

  player.setVolume(2);
  assert.equal(player.snapshot.volume, 1);
  assert.equal(sink.volume, 1);

  player.setVolume(-1);
  assert.equal(player.snapshot.volume, 0);
  assert.equal(sink.volume, 0);

  player.setVolume(0.35);
  assert.equal(player.snapshot.volume, 0.35);

  player.setMuted(true);
  assert.equal(player.snapshot.muted, true);
  assert.equal(sink.muted, true);
});

test("sink load errors surface as state error and app:error", async (t) => {
  const sink = new FakeSink();
  const bus = new EventBus();
  const player = new Player(sink, { bus });
  t.after(() => player.dispose());

  const errors: Array<{ scope: string; message: string }> = [];
  bus.on("app:error", (payload: { scope: string; message: string }) => errors.push(payload));

  sink.loadError = new Error("bad file");
  await player.play(makeTrack("a"));

  assert.equal(player.snapshot.state, "error");
  assert.equal(player.snapshot.error, "bad file");
  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.scope, "player");

  // The next successful load clears the error.
  sink.loadError = null;
  await player.play(makeTrack("a"));
  assert.equal(player.snapshot.state, "playing");
  assert.equal(player.snapshot.error, null);
});

test("sink error events set the error state", async (t) => {
  const sink = new FakeSink();
  const player = new Player(sink);
  t.after(() => player.dispose());

  await player.play(makeTrack("a"));
  sink.emit("error", new Error("decoder exploded"));

  assert.equal(player.snapshot.state, "error");
  assert.equal(player.snapshot.error, "decoder exploded");
});

test("queue mutations are reported on the bus and reflected in snapshots", async (t) => {
  const sink = new FakeSink();
  const bus = new EventBus();
  const player = new Player(sink, { bus });
  t.after(() => player.dispose());

  const queueStates: Array<{ index: number; ids: string[] }> = [];
  bus.on("queue:change", (state: { index: number; items: Track[] }) => {
    queueStates.push({ index: state.index, ids: state.items.map((track) => track.id) });
  });

  player.enqueue([makeTrack("a"), makeTrack("b")]);
  assert.equal(queueStates.length, 1);
  assert.deepEqual(queueStates[0]?.ids, ["a", "b"]);

  player.setShuffle(true);
  player.setRepeat("all");
  assert.equal(player.snapshot.shuffle, true);
  assert.equal(player.snapshot.repeat, "all");

  assert.ok(queueStates.length >= 3);
});

test("throttled position updates are delivered while playing", async (t) => {
  const sink = new FakeSink();
  const bus = new EventBus();
  const player = new Player(sink, { bus });
  t.after(() => player.dispose());

  const snapshots: Array<{ position: number }> = [];
  bus.on("player:snapshot", (snapshot: { position: number }) => snapshots.push(snapshot));

  await player.play(makeTrack("a"));
  const before = snapshots.length;

  sink.currentTime = 10;
  sink.emit("timeupdate");
  sink.currentTime = 20;
  sink.emit("timeupdate");
  sink.currentTime = 30;
  sink.emit("timeupdate");

  // Within the 250ms window at most the trailing snapshot is scheduled later.
  assert.ok(snapshots.length - before <= 1);

  await delay(300);
  assert.equal(snapshots[snapshots.length - 1]?.position, 30);
});

test("dispose releases the sink and ignores later commands", async (t) => {
  const sink = new FakeSink();
  const player = new Player(sink);
  t.after(() => player.dispose());

  await player.play(makeTrack("a"));
  player.dispose();
  assert.equal(sink.disposeCalls, 1);

  await player.play(makeTrack("b"));
  assert.equal(player.snapshot.track?.id, "a");
});
