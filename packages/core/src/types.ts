/**
 * Cadenza core contracts.
 *
 * Everything in the framework speaks these types. They are deliberately
 * runtime-agnostic: the same code powers the Electron desktop app, the browser
 * demo, and any custom host someone builds on top of the core package.
 */

/** Stable identifier for a track. Derived from the absolute file path. */
export type TrackId = string;

export type RepeatMode = "off" | "all" | "one";

export type PlaybackState = "idle" | "loading" | "playing" | "paused" | "stopped" | "error";

/** A single piece of audio Cadenza knows about. */
export interface Track {
  id: TrackId;
  /** Absolute path on disk (or a virtual path for plugin-provided tracks). */
  path: string;
  title: string;
  artist: string;
  album: string;
  albumArtist?: string;
  genre?: string;
  year?: number;
  trackNo?: number;
  discNo?: number;
  /** Seconds. `0` when the duration could not be determined. */
  duration: number;
  bitrate?: number;
  sampleRate?: number;
  channels?: number;
  /** Human friendly codec label, e.g. "MP3", "FLAC", "AAC". */
  codec?: string;
  /** Size in bytes. */
  size?: number;
  /** Key into the cover-art cache, when the file embeds artwork. */
  coverId?: string;
  /** Epoch millis when the track first entered the library. */
  addedAt: number;
  playCount?: number;
  lastPlayedAt?: number;
  /** Where the track came from: local file scan, playlist import, plugin. */
  origin?: "scan" | "playlist" | "plugin";
}

/** Fields a component may need without paying for the whole track. */
export type TrackSummary = Pick<Track, "id" | "title" | "artist" | "album" | "duration"> & {
  coverId?: string;
};

export interface QueueState {
  items: Track[];
  /** Index of the current track in `items`, or -1 when nothing is loaded. */
  index: number;
  shuffle: boolean;
  repeat: RepeatMode;
}

export interface PlayerSnapshot {
  state: PlaybackState;
  track: Track | null;
  /** Seconds. */
  position: number;
  /** Seconds. */
  duration: number;
  /** Seconds buffered ahead of the playhead. */
  buffered: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  /** Last error message, cleared on the next successful load. */
  error: string | null;
}

export interface LibrarySnapshot {
  tracks: Track[];
  total: number;
  /** Epoch millis of the last completed scan. */
  scannedAt: number | null;
}

export type SortKey = "title" | "artist" | "album" | "albumArtist" | "added" | "duration" | "year";

export interface LibraryQuery {
  /** Free text matched against title, artist, album and file name. */
  text?: string;
  artist?: string;
  album?: string;
  sortBy?: SortKey;
  sortDir?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export interface ScanProgress {
  phase: "discovering" | "reading" | "done" | "cancelled" | "error";
  filesFound: number;
  filesProcessed: number;
  /** Path currently being parsed. */
  currentFile?: string;
  /** Human readable errors; the scan never aborts because of a single bad file. */
  errors: string[];
}

export interface AppSettings {
  theme: string;
  accent: string;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  /** Folders the library scanner walks. */
  libraryRoots: string[];
  /** Restore the last queue on startup. */
  resumeSession: boolean;
  /** Global media-key handling. */
  mediaKeys: boolean;
}

/* ------------------------------------------------------------------ audio */

/**
 * The player is driven by an audio sink. The desktop app plugs in an
 * HTMLAudioElement adapter; tests use a silent in-memory sink; a plugin could
 * plug in a WebAudio graph.
 */
export interface AudioSink {
  /** Load a track. `url` is usually a custom protocol URL. */
  load(track: Track, url: string): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  stop(): void;
  /** Seek to an absolute position in seconds. */
  seek(seconds: number): void;
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
  /** Current playback position in seconds. */
  readonly currentTime: number;
  /** Duration in seconds, `0` until known. */
  readonly duration: number;
  /** Seconds buffered ahead of the playhead. */
  readonly buffered: number;
  /** Subscribe to sink-level events. Returns an unsubscribe function. */
  on(event: SinkEvent, listener: (payload?: unknown) => void): () => void;
  dispose(): void;
}

export type SinkEvent = "timeupdate" | "durationchange" | "progress" | "ended" | "error" | "playing" | "pause" | "canplay";

/* -------------------------------------------------------------- metadata */

export interface CoverArt {
  mime: string;
  data: Uint8Array;
}

export interface MetadataResult {
  title: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  genre?: string;
  year?: number;
  trackNo?: number;
  discNo?: number;
  duration: number;
  bitrate?: number;
  sampleRate?: number;
  channels?: number;
  codec?: string;
  cover?: CoverArt;
}

/** Byte source used by the metadata readers; lets the same code read a file or an in-memory buffer. */
export interface ByteSource {
  readonly size: number;
  /** Read up to `length` bytes starting at `offset`. */
  read(offset: number, length: number): Promise<Uint8Array>;
}

/* --------------------------------------------------------------- lyrics */

export interface LrcLine {
  /** Seconds from the start of the track. */
  time: number;
  text: string;
}

export interface LyricsDoc {
  lines: LrcLine[];
  /** Global offset in seconds, from the `[offset:]` tag. */
  offset: number;
  source: "sidecar" | "embedded" | "plugin";
  /** Raw LRC text, kept for debugging and export. */
  raw?: string;
}

/* ------------------------------------------------------------- playlist */

export interface PlaylistEntry {
  path: string;
  title?: string;
  /** Seconds, when the format carries it. */
  duration?: number;
}

export interface PlaylistFile {
  name: string;
  format: "m3u" | "m3u8" | "pls" | "cadenza";
  entries: PlaylistEntry[];
}

/* ---------------------------------------------------------------- store */

/** Minimal persistence contract. The desktop app backs it with a JSON file. */
export interface KeyValueStore {
  get<T>(key: string, fallback: T): T;
  set<T>(key: string, value: T): void;
  delete(key: string): void;
  flush(): Promise<void>;
}

/* -------------------------------------------------------------- plugins */

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  /** Entry file, relative to the plugin folder. */
  main: string;
  /** Semver range against the Cadenza version, e.g. "^0.1.0". */
  cadenza?: string;
  /** Optional theme id this plugin contributes. */
  contributesTheme?: string;
}

export interface PluginInfo {
  manifest: PluginManifest;
  /** URL the host used to import the plugin entry. */
  entryUrl: string;
  status: "discovered" | "loaded" | "active" | "error" | "disabled";
  error?: string;
}

/**
 * UI regions a plugin may render into. Track rows live inside the UI kit's
 * shadow DOM, so there is deliberately no per-row slot.
 */
export type SlotName = "sidebar:footer" | "now-playing:action" | "settings:section";

export interface Command {
  id: string;
  title: string;
  /** Extra search terms for the command palette. */
  keywords?: string[];
  /** Suggested shortcut, shown in the palette (not bound automatically). */
  shortcut?: string;
  run(): void | Promise<void>;
}

export interface Disposable {
  dispose(): void;
}

/** The slice of the app a plugin is allowed to touch. */
export interface PluginContext {
  readonly pluginId: string;
  readonly version: string;
  player: {
    snapshot(): PlayerSnapshot;
    play(track?: Track): Promise<void>;
    pause(): void;
    next(): Promise<void>;
    previous(): Promise<void>;
    seek(seconds: number): void;
    setVolume(volume: number): void;
    enqueue(tracks: Track[]): void;
    on(event: "trackchange" | "statechange" | "position", listener: (snapshot: PlayerSnapshot) => void): Disposable;
  };
  library: {
    tracks(): Track[];
    search(text: string): Track[];
    on(event: "change", listener: (snapshot: LibrarySnapshot) => void): Disposable;
  };
  commands: {
    register(command: Command): Disposable;
  };
  ui: {
    /** Mount DOM into a named slot. The element is removed on dispose. */
    slot(name: SlotName, render: (host: HTMLElement) => void): Disposable;
  };
  settings: {
    get<T>(key: string, fallback: T): T;
    set<T>(key: string, value: T): void;
  };
  theme: {
    /** Override a theme token, e.g. `--cz-accent`. */
    setVar(name: string, value: string): Disposable;
  };
  log(...args: unknown[]): void;
}

export interface CadenzaPlugin {
  manifest: PluginManifest;
  activate(context: PluginContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}

/* --------------------------------------------------------------- events */

/** Typed event map used by the core `EventBus`. */
export interface CoreEvents {
  "player:snapshot": PlayerSnapshot;
  "queue:change": QueueState;
  "library:change": LibrarySnapshot;
  "scan:progress": ScanProgress;
  "lyrics:change": LyricsDoc | null;
  "plugins:change": PluginInfo[];
  "plugin:error": { id: string; message: string };
  "app:error": { scope: string; message: string };
}
