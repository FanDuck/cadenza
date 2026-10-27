/**
 * The player: turns user intentions (`play`, `next`, `seek`, ...) into calls on
 * an injected {@link AudioSink}, and broadcasts the resulting state as
 * `player:snapshot` events.
 */

import { EventBus } from "./events.js";
import { Queue } from "./queue.js";
import type { AudioSink, CoreEvents, PlaybackState, PlayerSnapshot, RepeatMode, SinkEvent, Track } from "./types.js";

/** Options accepted by {@link Player}. */
export interface PlayerOptions {
  /** Maps a track to the URL handed to the sink. Defaults to `track.path`. */
  resolveUrl?: (track: Track) => string;
  /** Shared event bus. A private bus is created when omitted. */
  bus?: EventBus<CoreEvents>;
}

/** Minimum interval between position snapshots while playing. */
const SNAPSHOT_THROTTLE_MS = 250;
/** How often the player samples the sink for position updates while playing. */
const POSITION_TICK_MS = 250;

/**
 * Audio player driven by an {@link AudioSink}.
 *
 * The player owns the queue, tracks the playback state and emits snapshots on
 * its {@link bus}. It never touches the DOM or the filesystem itself.
 */
export class Player {
  readonly queue: Queue;
  readonly bus: EventBus<CoreEvents>;

  private readonly sink: AudioSink;
  private readonly resolveUrl: (track: Track) => string;
  private readonly sinkUnsubscribers: Array<() => void> = [];

  private state: PlaybackState = "idle";
  private track: Track | null = null;
  private error: string | null = null;
  private volume = 1;
  private muted = false;
  private position = 0;
  private duration = 0;
  private buffered = 0;
  private disposed = false;

  /** True while a load is in flight; used to ignore concurrent `play()` calls. */
  private loading = false;
  /** Incremented on every load so stale async results can be discarded. */
  private loadToken = 0;
  /** True while an advance (auto or user triggered) is in flight. */
  private advancing = false;

  private lastSnapshotAt = 0;
  private snapshotTimer: ReturnType<typeof setTimeout> | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;

  constructor(sink: AudioSink, options?: PlayerOptions) {
    this.sink = sink;
    this.bus = options?.bus ?? new EventBus<CoreEvents>();
    const resolve = options?.resolveUrl;
    this.resolveUrl = resolve ?? ((track) => track.path);

    this.queue = new Queue({
      onChange: (state) => {
        this.bus.emit("queue:change", state);
        this.emitSnapshot(true);
      },
    });

    this.bindSink();
    try {
      this.sink.setVolume(this.volume);
      this.sink.setMuted(this.muted);
    } catch {
      // A sink is allowed to refuse volume changes before it is loaded.
    }
  }

  /** Immutable view of the current playback state (fresh object on every read). */
  get snapshot(): PlayerSnapshot {
    this.syncFromSink(this.state === "playing" || this.state === "paused");
    return {
      state: this.state,
      track: this.track,
      position: this.position,
      duration: this.duration,
      buffered: this.buffered,
      volume: this.volume,
      muted: this.muted,
      shuffle: this.queue.shuffle,
      repeat: this.queue.repeat,
      error: this.error,
    };
  }

  /**
   * Load and play `track`, or resume the current queue track when omitted.
   *
   * A second call while a load is already in flight is ignored.
   */
  async play(track?: Track): Promise<void> {
    if (this.disposed || this.loading) return;
    const selected = this.selectTrack(track);
    if (!selected) return;

    if (this.track?.id === selected.id && this.state !== "error") {
      if (this.state === "playing") return;
      if (this.state === "stopped") this.seek(0);
      await this.startSink();
      return;
    }
    await this.loadTrack(selected, true);
  }

  /** Pause when playing, resume when paused/stopped/idle. */
  async toggle(): Promise<void> {
    if (this.disposed || this.loading) return;
    if (this.state === "playing") {
      this.pause();
      return;
    }
    await this.play();
  }

  /** Pause playback, keeping the current track and position. */
  pause(): void {
    if (this.disposed || this.loading || this.state !== "playing") return;
    try {
      this.sink.pause();
    } catch {
      // Ignore sinks that cannot pause (e.g. already disposed).
    }
    this.syncFromSink(true);
    this.state = "paused";
    this.stopTicker();
    this.emitSnapshot(true);
  }

  /** Stop playback and reset the position to zero. */
  stop(): void {
    if (this.disposed || this.loading) return;
    try {
      this.sink.stop();
    } catch {
      // Ignore sinks that cannot stop.
    }
    this.stopTicker();
    this.state = "stopped";
    this.position = 0;
    this.buffered = 0;
    this.emitSnapshot(true);
  }

  /**
   * Advance the queue. `auto` is true when the current track ended: with
   * repeat "one" the same track is replayed instead of moving on.
   */
  async next(auto = false): Promise<void> {
    await this.runAdvance(auto);
  }

  /** Go back one track. Falls back to restarting the current track. */
  async previous(): Promise<void> {
    if (this.disposed || this.advancing) return;
    this.advancing = true;
    try {
      if (this.loading || this.queue.length === 0) return;
      const previousTrack = this.queue.current;
      const targetIndex = this.queue.nextIndex(-1);
      if (targetIndex === null) {
        this.seek(0);
        return;
      }
      this.queue.setIndex(targetIndex);
      const target = this.queue.current;
      if (!target) return;
      if (previousTrack?.id === target.id) {
        this.seek(0);
        return;
      }
      await this.loadTrack(target, true);
    } finally {
      this.advancing = false;
    }
  }

  /** Seek to an absolute position in seconds, clamped to `[0, duration]`. */
  seek(seconds: number): void {
    if (this.disposed || !Number.isFinite(seconds)) return;
    const duration = this.effectiveDuration();
    const clamped = duration > 0 ? Math.min(Math.max(seconds, 0), duration) : Math.max(seconds, 0);
    try {
      this.sink.seek(clamped);
    } catch {
      // Ignore sinks that cannot seek yet.
    }
    this.position = clamped;
    this.emitSnapshot(true);
  }

  /** Set the output volume (`0..1`, clamped). Pure state: nothing is persisted. */
  setVolume(volume: number): void {
    if (this.disposed || !Number.isFinite(volume)) return;
    const clamped = Math.min(Math.max(volume, 0), 1);
    this.volume = clamped;
    try {
      this.sink.setVolume(clamped);
    } catch {
      // Ignore sinks that refuse volume changes.
    }
    this.emitSnapshot(true);
  }

  setMuted(muted: boolean): void {
    if (this.disposed) return;
    this.muted = muted;
    try {
      this.sink.setMuted(muted);
    } catch {
      // Ignore sinks that refuse mute changes.
    }
    this.emitSnapshot(true);
  }

  setShuffle(shuffle: boolean): void {
    if (this.disposed) return;
    this.queue.setShuffle(shuffle);
  }

  setRepeat(mode: RepeatMode): void {
    if (this.disposed) return;
    this.queue.setRepeat(mode);
  }

  /** Append tracks to the queue. */
  enqueue(tracks: Track[]): void {
    if (this.disposed) return;
    this.queue.add(tracks);
  }

  /** Release the sink, stop timers and drop every subscription. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopTicker();
    if (this.snapshotTimer !== null) {
      clearTimeout(this.snapshotTimer);
      this.snapshotTimer = null;
    }
    for (const unsubscribe of this.sinkUnsubscribers) {
      try {
        unsubscribe();
      } catch {
        // Keep disposing the other subscriptions.
      }
    }
    this.sinkUnsubscribers.length = 0;
    try {
      this.sink.dispose();
    } catch {
      // The sink may already be gone.
    }
  }

  /* ------------------------------------------------------------ internals */

  private bindSink(): void {
    const bind = (event: SinkEvent, listener: (payload?: unknown) => void): void => {
      this.sinkUnsubscribers.push(this.sink.on(event, listener));
    };

    bind("timeupdate", () => {
      this.syncFromSink(true);
      this.emitSnapshot(false);
    });
    bind("durationchange", () => {
      this.syncFromSink(false);
      this.emitSnapshot(true);
    });
    bind("progress", () => {
      this.syncFromSink(false);
      this.emitSnapshot(false);
    });
    bind("ended", () => {
      void this.next(true);
    });
    bind("error", (payload) => {
      this.fail(describeError(payload, "Playback failed"));
    });
    bind("playing", () => {
      if (this.state === "playing") return;
      this.state = "playing";
      this.startTicker();
      this.emitSnapshot(true);
    });
    bind("pause", () => {
      if (this.state !== "playing") return;
      this.syncFromSink(true);
      this.state = "paused";
      this.stopTicker();
      this.emitSnapshot(true);
    });
    bind("canplay", () => {
      this.syncFromSink(false);
    });
  }

  /** Make sure the queue points at `track` before loading it. */
  private selectTrack(track?: Track): Track | null {
    if (track) {
      const existing = this.queue.items.findIndex((item) => item.id === track.id);
      if (existing >= 0) {
        if (this.queue.index !== existing) this.queue.setIndex(existing);
      } else if (this.queue.items.length === 0) {
        this.queue.setTracks([track], 0);
      } else {
        const at = this.queue.index >= 0 ? this.queue.index + 1 : this.queue.items.length;
        this.queue.insertAt([track], at);
        this.queue.setIndex(at);
      }
    }
    return this.queue.current ?? track ?? null;
  }

  private async loadTrack(track: Track, autoplay: boolean): Promise<void> {
    if (this.disposed || this.loading) return;
    this.loading = true;
    const token = ++this.loadToken;

    this.state = "loading";
    this.track = track;
    this.position = 0;
    this.buffered = 0;
    this.duration = track.duration > 0 ? track.duration : 0;
    this.error = null;
    this.stopTicker();
    this.emitSnapshot(true);

    try {
      const url = this.resolveUrl(track);
      await this.sink.load(track, url);
      if (this.disposed || token !== this.loadToken) return;
      this.syncFromSink(false);
      this.state = "paused";
      this.emitSnapshot(true);
      if (autoplay) await this.startSink();
    } catch (error) {
      if (this.disposed || token !== this.loadToken) return;
      this.fail(describeError(error, `Could not load "${track.title}"`));
    } finally {
      if (token === this.loadToken) this.loading = false;
    }
  }

  private async startSink(): Promise<void> {
    try {
      await this.sink.play();
      if (this.disposed) return;
      this.state = "playing";
      this.syncFromSink(true);
      this.startTicker();
      this.emitSnapshot(true);
    } catch (error) {
      if (this.disposed) return;
      this.fail(describeError(error, "Could not start playback"));
    }
  }

  private async runAdvance(auto: boolean): Promise<void> {
    if (this.disposed || this.advancing) return;
    this.advancing = true;
    try {
      await this.doAdvance(auto);
    } finally {
      this.advancing = false;
    }
  }

  private async doAdvance(auto: boolean): Promise<void> {
    if (this.disposed || this.loading || this.queue.length === 0) return;

    if (auto && this.queue.repeat === "one") {
      // Automatic advance with repeat-one: replay the current track from zero.
      this.seek(0);
      try {
        await this.sink.play();
      } catch (error) {
        this.fail(describeError(error, "Could not restart playback"));
        return;
      }
      if (this.disposed) return;
      this.state = "playing";
      this.startTicker();
      this.emitSnapshot(true);
      return;
    }

    const previousTrack = this.queue.current;
    const targetIndex = this.queue.advanceIndex(auto);
    if (targetIndex === null) {
      // Nothing left to play: stop at the end of the queue.
      this.finishQueue();
      return;
    }
    const target = this.queue.current;
    if (!target) return;

    if (previousTrack?.id === target.id) {
      // A single-track queue (or a shuffle edge case): restart the same item.
      this.track = target;
      this.seek(0);
      try {
        await this.sink.play();
      } catch (error) {
        this.fail(describeError(error, "Could not restart playback"));
        return;
      }
      if (this.disposed) return;
      this.state = "playing";
      this.startTicker();
      this.emitSnapshot(true);
      return;
    }

    await this.loadTrack(target, true);
  }

  /** Reached the end of the queue with repeat off. */
  private finishQueue(): void {
    this.stopTicker();
    try {
      this.sink.pause();
    } catch {
      // The sink may already have stopped on its own ("ended").
    }
    this.state = "stopped";
    this.position = 0;
    this.buffered = 0;
    this.emitSnapshot(true);
  }

  private fail(message: string): void {
    if (this.disposed) return;
    const isNewError = this.state !== "error" || this.error !== message;
    this.state = "error";
    this.error = message;
    this.stopTicker();
    if (!isNewError) return;
    this.bus.emit("app:error", { scope: "player", message });
    this.emitSnapshot(true);
  }

  /** Read position/duration/buffered from the sink. */
  private syncFromSink(includePosition: boolean): void {
    if (this.disposed) return;
    if (includePosition) {
      const position = readFinite(() => this.sink.currentTime);
      if (position !== null && position >= 0) this.position = position;
    }
    const duration = readFinite(() => this.sink.duration);
    if (duration !== null && duration > 0) this.duration = duration;
    const buffered = readFinite(() => this.sink.buffered);
    if (buffered !== null) this.buffered = Math.max(0, buffered);
  }

  private effectiveDuration(): number {
    if (this.duration > 0) return this.duration;
    return readFinite(() => this.sink.duration) ?? 0;
  }

  private startTicker(): void {
    if (this.tickTimer !== null) return;
    const timer = setInterval(() => {
      if (this.disposed || this.state !== "playing") {
        this.stopTicker();
        return;
      }
      this.syncFromSink(true);
      this.emitSnapshot(false);
    }, POSITION_TICK_MS);
    // Keep a browser `number` timer and a Node `Timeout` both usable, and make
    // sure a forgotten `dispose()` never keeps a process alive.
    (timer as unknown as { unref?: () => void }).unref?.();
    this.tickTimer = timer;
  }

  private stopTicker(): void {
    if (this.tickTimer === null) return;
    clearInterval(this.tickTimer);
    this.tickTimer = null;
  }

  /**
   * Emit a snapshot now (when forced or when the throttle window elapsed) or
   * schedule a trailing emission for the end of the window.
   */
  private emitSnapshot(force: boolean): void {
    if (this.disposed) return;
    const now = Date.now();
    const elapsed = now - this.lastSnapshotAt;
    if (!force && elapsed < SNAPSHOT_THROTTLE_MS) {
      if (this.snapshotTimer === null) {
        this.snapshotTimer = setTimeout(() => {
          this.snapshotTimer = null;
          this.flushSnapshot();
        }, SNAPSHOT_THROTTLE_MS - elapsed);
      }
      return;
    }
    if (this.snapshotTimer !== null) {
      clearTimeout(this.snapshotTimer);
      this.snapshotTimer = null;
    }
    this.flushSnapshot();
  }

  private flushSnapshot(): void {
    if (this.disposed) return;
    this.lastSnapshotAt = Date.now();
    this.bus.emit("player:snapshot", this.snapshot);
  }
}

/** Read a number from the sink, treating exceptions and non-finite values as unknown. */
function readFinite(read: () => number): number | null {
  try {
    const value = read();
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

/** Normalise an unknown error/event payload to a human readable message. */
function describeError(payload: unknown, fallback: string): string {
  if (typeof payload === "string" && payload.length > 0) return payload;
  if (payload instanceof Error && payload.message.length > 0) return payload.message;
  if (typeof payload === "object" && payload !== null && "message" in payload) {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return fallback;
}
