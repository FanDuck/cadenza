/**
 * `AudioSink` backed by an `HTMLAudioElement`.
 *
 * This is the only file in the core that may touch the DOM. All other modules
 * receive an {@link AudioSink} so they stay runtime-agnostic.
 */

import type { AudioSink, SinkEvent, Track } from "../types.js";

/** How long a real network load may take before it is reported as failed. */
const LOAD_TIMEOUT_MS = 15_000;

const SINK_EVENTS: readonly SinkEvent[] = [
  "timeupdate",
  "durationchange",
  "progress",
  "ended",
  "error",
  "playing",
  "pause",
  "canplay",
];

type SinkListener = (payload?: unknown) => void;

/** Handle used to abort a pending `load()` call. */
interface PendingLoad {
  cancel(error: Error): void;
}

/**
 * Audio sink wrapping an `HTMLAudioElement`.
 *
 * An empty URL is treated as "silent playback": the load resolves immediately
 * and the sink reports the track duration with a synthetic position. That keeps
 * the browser demo alive without real media files (`bridge.mediaUrl()` returns
 * an empty string in demo mode) while the renderer drives the visible position.
 */
export class HtmlAudioSink implements AudioSink {
  private readonly audio: HTMLAudioElement;
  private readonly listeners = new Map<SinkEvent, Set<SinkListener>>();
  private readonly domListeners: Array<{ event: SinkEvent; handler: () => void }> = [];
  private pendingLoad: PendingLoad | null = null;
  private disposed = false;

  /** True between `load(track, "")` and the next real load. */
  private silent = false;
  private silentTrack: Track | null = null;
  private silentPosition = 0;

  /**
   * @param audio - Element to wrap. A fresh `new Audio()` with
   * `preload = "metadata"` is created when omitted.
   */
  constructor(audio?: HTMLAudioElement) {
    this.audio = audio ?? new Audio();
    if (!audio) this.audio.preload = "metadata";

    for (const event of SINK_EVENTS) {
      const handler = (): void => {
        this.dispatch(event);
      };
      this.audio.addEventListener(event, handler);
      this.domListeners.push({ event, handler });
    }
  }

  /** The wrapped element, e.g. for attaching an `AnalyserNode`. */
  get element(): HTMLAudioElement {
    return this.audio;
  }

  /**
   * Load a track. Resolves once metadata is available; rejects on a media
   * error or after 15 seconds. An empty `url` resolves immediately in silent
   * mode.
   */
  load(track: Track, url: string): Promise<void> {
    this.cancelPendingLoad(new Error("Playback load was superseded"));
    if (this.disposed) return Promise.reject(new Error("The audio sink has been disposed"));

    if (url.trim().length === 0) {
      this.enterSilentMode(track);
      return Promise.resolve();
    }
    this.leaveSilentMode();

    const label = track.title.trim().length > 0 ? track.title : url;
    return new Promise<void>((resolve, reject) => {
      const sink = this;
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let pendingRef: PendingLoad | null = null;

      function finish(error: Error | null): void {
        if (settled) return;
        settled = true;
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
        sink.audio.removeEventListener("canplay", onReady);
        sink.audio.removeEventListener("loadedmetadata", onReady);
        sink.audio.removeEventListener("error", onError);
        if (pendingRef !== null && sink.pendingLoad === pendingRef) sink.pendingLoad = null;
        if (error !== null) reject(error);
        else resolve();
      }

      function onReady(): void {
        finish(null);
      }

      function onError(): void {
        finish(new Error(sink.describeMediaError()));
      }

      pendingRef = { cancel: (error: Error): void => finish(error) };
      sink.pendingLoad = pendingRef;
      timer = setTimeout(() => {
        finish(new Error(`Timed out after ${LOAD_TIMEOUT_MS / 1000}s while loading "${label}"`));
      }, LOAD_TIMEOUT_MS);

      sink.audio.addEventListener("canplay", onReady);
      sink.audio.addEventListener("loadedmetadata", onReady);
      sink.audio.addEventListener("error", onError);
      sink.audio.src = url;
      sink.audio.load();
    });
  }

  play(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error("The audio sink has been disposed"));
    if (this.silent) return Promise.resolve();
    try {
      return this.audio.play();
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  pause(): void {
    if (this.disposed || this.silent) return;
    this.audio.pause();
  }

  stop(): void {
    if (this.disposed) return;
    if (this.silent) {
      this.silentPosition = 0;
      return;
    }
    this.audio.pause();
    try {
      this.audio.currentTime = 0;
    } catch {
      // Metadata may not be available yet.
    }
  }

  seek(seconds: number): void {
    if (this.disposed || !Number.isFinite(seconds)) return;
    if (this.silent) {
      this.silentPosition = clampToDuration(seconds, this.duration);
      return;
    }
    try {
      this.audio.currentTime = clampToDuration(seconds, this.duration);
    } catch {
      // Seeking before metadata is ready throws; ignore it.
    }
  }

  setVolume(volume: number): void {
    if (this.disposed || !Number.isFinite(volume)) return;
    this.audio.volume = Math.min(Math.max(volume, 0), 1);
  }

  setMuted(muted: boolean): void {
    if (this.disposed) return;
    this.audio.muted = muted;
  }

  get currentTime(): number {
    if (this.silent) return this.silentPosition;
    const value = this.audio.currentTime;
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  get duration(): number {
    if (this.silent) return this.silentTrack?.duration ?? 0;
    const value = this.audio.duration;
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  /** Seconds buffered ahead of the playhead, from the range containing it. */
  get buffered(): number {
    if (this.silent) return 0;
    const position = this.currentTime;
    const ranges = this.audio.buffered;
    for (let i = 0; i < ranges.length; i++) {
      const start = ranges.start(i);
      const end = ranges.end(i);
      if (Number.isFinite(start) && Number.isFinite(end) && position >= start && position <= end) {
        return Math.max(0, end - position);
      }
    }
    return 0;
  }

  /** Subscribe to a sink event. Returns an unsubscribe function. */
  on(event: SinkEvent, listener: SinkListener): () => void {
    if (this.disposed) return () => {};
    let listeners = this.listeners.get(event);
    if (!listeners) {
      listeners = new Set<SinkListener>();
      this.listeners.set(event, listeners);
    }
    listeners.add(listener);
    return () => {
      const current = this.listeners.get(event);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) this.listeners.delete(event);
    };
  }

  /** Pause, remove every listener and abort a pending load. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelPendingLoad(new Error("The audio sink was disposed"));
    try {
      this.audio.pause();
    } catch {
      // Ignore a detached element.
    }
    for (const { event, handler } of this.domListeners) {
      this.audio.removeEventListener(event, handler);
    }
    this.domListeners.length = 0;
    this.listeners.clear();
    this.silent = false;
    this.silentTrack = null;
    this.silentPosition = 0;
  }

  /* ------------------------------------------------------------ internals */

  private enterSilentMode(track: Track): void {
    // Flag first: the pause event of a previously playing element is then
    // suppressed instead of leaking into the player.
    this.silent = true;
    this.silentTrack = track;
    this.silentPosition = 0;
    try {
      this.audio.pause();
    } catch {
      // Ignore elements that cannot pause.
    }
  }

  private leaveSilentMode(): void {
    this.silent = false;
    this.silentTrack = null;
    this.silentPosition = 0;
  }

  private dispatch(event: SinkEvent): void {
    // Real element events are meaningless while the sink is in silent mode.
    if (this.disposed || this.silent) return;
    const listeners = this.listeners.get(event);
    if (!listeners || listeners.size === 0) return;
    const payload = event === "error" ? new Error(this.describeMediaError()) : undefined;
    for (const listener of [...listeners]) {
      try {
        listener(payload);
      } catch {
        // A broken sink listener must not break audio playback.
      }
    }
  }

  private cancelPendingLoad(reason: Error): void {
    const pending = this.pendingLoad;
    if (!pending) return;
    this.pendingLoad = null;
    pending.cancel(reason);
  }

  private describeMediaError(): string {
    const error = this.audio.error as (MediaError & { message?: string }) | null;
    if (!error) return "Unknown audio error";
    const message = typeof error.message === "string" ? error.message : "";
    if (message.length > 0) return message;
    switch (error.code) {
      case 1:
        return "Audio playback was aborted";
      case 2:
        return "A network error occurred while loading audio";
      case 3:
        return "Audio decoding failed";
      case 4:
        return "The audio source is not supported";
      default:
        return "Unknown audio error";
    }
  }
}

function clampToDuration(seconds: number, duration: number): number {
  if (!(duration > 0)) return Math.max(seconds, 0);
  return Math.min(Math.max(seconds, 0), duration);
}
