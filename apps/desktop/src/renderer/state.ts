/**
 * The renderer's application state.
 *
 * Cadenza has no state library on purpose. A music player has two kinds of
 * state and only one of them belongs in a global store:
 *
 * - **App state** (current view, search text, sort order, open panels, theme,
 *    toasts, cached library data) changes when the user does something. It lives
 *    here, in one plain object, and views re-render when it changes.
 * - **Playback state** (position, analyser frames) changes up to 60 times per
 *    second. Pushing that through this store would re-render whole views for
 *    every frame, so `player-bar.ts` / `now-playing.ts` subscribe to
 *    `services.player` directly instead. The player snapshot is *not* stored
 *    here.
 *
 * The store API is deliberately three functions: `getState`, `setState`,
 * `subscribe`.
 */

import type {
  AppSettings,
  Command,
  KeyValueStore,
  LibrarySnapshot,
  PluginInfo,
  PlayerSnapshot,
  QueueState,
  RepeatMode,
  ScanProgress,
  SortKey,
  Track,
  TrackId,
} from "@fanduck/cadenza-core";
import type { CadenzaBridge } from "../shared/ipc.js";
import type { IconName } from "./dom.js";

/* ------------------------------------------------------------------ views */

export type ViewId = "library" | "albums" | "artists" | "playlists" | "settings" | "now-playing";

/** Which library subset a view is currently drilled into (album/artist click). */
export type LibraryFilter =
  | { kind: "album"; album: string; artist: string }
  | { kind: "artist"; artist: string };

export interface SortOrder {
  key: SortKey;
  dir: "asc" | "desc";
}

export type ToastKind = "info" | "success" | "error";

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

/** A user-created playlist. Track order is stored as ids, not copies. */
export interface SavedPlaylist {
  id: string;
  name: string;
  trackIds: TrackId[];
  /** Epoch millis. */
  createdAt: number;
}

/** One row of the app's context menus (track right-click, queue row, ...). */
export interface MenuItem {
  id: string;
  label: string;
  icon?: IconName;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  run(): void;
}

/** A context menu accepts items and separators. */
export type MenuEntry = MenuItem | { separator: true };

/** Sections of the Settings view, so other parts can deep-link into one. */
export type SettingsSection = "library" | "appearance" | "playback" | "plugins" | "about";

/** A mounted view. `update` is called on every state change while visible. */
export interface ViewPart {
  el: HTMLElement;
  update(state: AppState): void;
  /** Optional teardown (unsubscribes, cancelled cover loads). */
  destroy?(): void;
}

/**
 * The subset of `<cz-track-list>` the app drives. Typed structurally so views
 * stay readable even though the UI kit owns the implementation.
 */
export interface TrackListElement extends HTMLElement {
  tracks: Track[];
  currentId: string | null;
  playing: boolean;
  variant: "full" | "compact";
  emptyText: string;
  showHeader: boolean;
}

export interface AppState {
  /** The active main view. */
  view: ViewId;
  /** Global search text (also the top bar search field). */
  query: string;
  sort: SortOrder;
  /** Drill-down filter inside the library views. */
  filter: LibraryFilter | null;
  /** Currently focused/selected track row. */
  selectedId: TrackId | null;
  /** Multi-selection (Ctrl-click in the track list, future bulk actions). */
  selection: TrackId[];
  /** Full settings snapshot: theme, accent, roots, playback options. */
  settings: AppSettings;
  queueOpen: boolean;
  paletteOpen: boolean;
  sidebarCollapsed: boolean;
  /** Library cache, unsorted (the core `Library` owns the truth). */
  tracks: Track[];
  libraryTotal: number;
  scannedAt: number | null;
  /** User-created playlists (persisted through the settings store). */
  playlists: SavedPlaylist[];
  /** Latest scan progress, or null when no scan is running. */
  scan: ScanProgress | null;
  plugins: PluginInfo[];
  toasts: Toast[];
  /** False until the first library snapshot and settings have been restored. */
  ready: boolean;
}

/* ------------------------------------------------------------- player API */

/**
 * The narrow slice of `@fanduck/cadenza-core`'s `Player` the UI uses.
 * `main.ts` wraps the real player in this interface, which keeps every view
 * decoupled from the engine (and easy to test with a fake).
 */
export interface PlayerApi {
  /** Live snapshot; every access returns a fresh object. */
  readonly snapshot: PlayerSnapshot;
  /** Current queue state (items, index, shuffle, repeat). */
  readonly queue: QueueState;
  onSnapshot(listener: (snapshot: PlayerSnapshot) => void): () => void;
  onQueueChange(listener: (queue: QueueState) => void): () => void;
  play(track?: Track): void;
  pause(): void;
  toggle(): void;
  stop(): void;
  next(): void;
  previous(): void;
  seek(seconds: number): void;
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
  setShuffle(shuffle: boolean): void;
  setRepeat(repeat: RepeatMode): void;
  /** Append to the play queue. */
  enqueue(tracks: Track[]): void;
  /** Replace the queue and start at `index` (0 = play now). */
  playNow(tracks: Track[], index?: number): void;
  /** Replace the queue without changing playback. */
  setQueue(tracks: Track[], index?: number): void;
  clearQueue(): void;
}

export interface LibraryApi {
  tracks(): Track[];
  upsert(tracks: Track[]): void;
  remove(id: TrackId): void;
  onChange(listener: (snapshot: LibrarySnapshot) => void): () => void;
}

export interface PluginApi {
  list(): PluginInfo[];
  reload(): Promise<PluginInfo[]>;
  openFolder(): Promise<void>;
  onChange(listener: (plugins: PluginInfo[]) => void): () => void;
  /** Mount plugins into `data-slot` hosts. No-op when the host has no slot support. */
  mountSlots?(): void;
}

export interface SettingsApi {
  current(): AppSettings;
  update(patch: Partial<AppSettings>): Promise<void>;
}

/** Everything a view/part may use. Built once in `main.ts`. */
export interface AppServices {
  bridge: CadenzaBridge;
  player: PlayerApi;
  library: LibraryApi;
  plugins: PluginApi;
  settings: SettingsApi;
  /** Persistence shared with the core `Library` (backed by `bridge.settings`). */
  store: KeyValueStore;
  /** App-level commands shown in the command palette (not the player ones). */
  commands: Command[];
  /** The `<audio>` element behind the sink, when there is one (for the analyser). */
  audioElement: HTMLAudioElement | null;
}

/**
 * Everything the app shell can do. `App` implements this interface and hands it
 * to views/parts, so a part never needs to know how the shell is built.
 */
export interface AppActions {
  navigate(view: ViewId): void;
  setQuery(query: string): void;
  setFilter(filter: LibraryFilter | null): void;
  setSort(key: SortKey): void;
  toggleSortDirection(): void;
  openPalette(open: boolean): void;
  openSettings(section?: SettingsSection): void;
  toggleQueue(open?: boolean): void;
  toggleSidebar(): void;
  playTracks(tracks: Track[], index?: number): void;
  shuffleTracks(tracks: Track[]): void;
  enqueueTracks(tracks: Track[]): void;
  showTrackMenu(track: Track, x: number, y: number): void;
  showMenu(items: MenuEntry[], x: number, y: number): void;
  applyTheme(themeId: string, accentId: string): Promise<void>;
  scanLibrary(roots: string[]): Promise<void>;
  addMusicFolder(): Promise<void>;
  rescan(): Promise<void>;
  focusSearch(): void;
  toast(message: string, kind?: ToastKind): void;
  /** Called from a user gesture: creates/returns the WebAudio analyser. */
  ensureAudio(): AnalyserNode | null;
  getAnalyser(): AnalyserNode | null;
  /** The version string shown in Settings > About. */
  version(): string;
}

/** Services + actions: what every view and part receives. */
export interface UiContext extends AppServices {
  actions: AppActions;
}

/* ----------------------------------------------------------- default data */

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "midnight",
  accent: "duck",
  volume: 0.8,
  muted: false,
  shuffle: false,
  repeat: "off",
  libraryRoots: [],
  resumeSession: true,
  mediaKeys: true,
};

/* --------------------------------------------------------------- the store */

let state: AppState = createInitialState();
const listeners = new Set<(next: AppState, previous: AppState) => void>();

function createInitialState(): AppState {
  return {
    view: "library",
    query: "",
    sort: { key: "artist", dir: "asc" },
    filter: null,
    selectedId: null,
    selection: [],
    settings: { ...DEFAULT_SETTINGS },
    queueOpen: false,
    paletteOpen: false,
    sidebarCollapsed: false,
    tracks: [],
    libraryTotal: 0,
    scannedAt: null,
    playlists: [],
    scan: null,
    plugins: [],
    toasts: [],
    ready: false,
  };
}

export function getState(): AppState {
  return state;
}

type Patch = Partial<AppState> | ((current: AppState) => Partial<AppState>);

/** Merge a patch into the state and notify subscribers. */
export function setState(patch: Patch): void {
  const previous = state;
  const resolved = typeof patch === "function" ? patch(previous) : patch;
  state = { ...previous, ...resolved };
  for (const listener of listeners) listener(state, previous);
}

/** Subscribe to state changes. Returns an unsubscribe function. */
export function subscribe(listener: (next: AppState, previous: AppState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reset to the initial state (used by tests and the demo "reset" command). */
export function resetState(patch: Partial<AppState> = {}): void {
  state = { ...createInitialState(), ...patch };
  for (const listener of listeners) listener(state, state);
}

/* --------------------------------------------------------------- toasts */

let toastSeq = 0;
const toastTimers = new Map<number, number>();

export function pushToast(message: string, kind: ToastKind = "info", timeoutMs = 4200): number {
  toastSeq += 1;
  const toast: Toast = { id: toastSeq, kind, message };
  setState((current) => ({ toasts: [...current.toasts.slice(-3), toast] }));
  const timer = window.setTimeout(() => dismissToast(toast.id), timeoutMs);
  toastTimers.set(toast.id, timer);
  return toast.id;
}

export function dismissToast(id: number): void {
  const timer = toastTimers.get(id);
  if (timer !== undefined) {
    window.clearTimeout(timer);
    toastTimers.delete(id);
  }
  setState((current) => ({ toasts: current.toasts.filter((toast) => toast.id !== id) }));
}

/* ------------------------------------------------------- library selectors */

/** Case-insensitive free-text match over the fields the UI shows. */
export function matchesQuery(track: Track, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;
  const haystack = `${track.title}\n${track.artist}\n${track.album}\n${track.albumArtist ?? ""}\n${fileName(track.path)}`;
  return haystack.toLowerCase().includes(needle);
}

export function fileName(path: string): string {
  const parts = path.split(/[\\/]/u);
  return parts[parts.length - 1] ?? path;
}

/** Apply the current query and drill-down filter to a track list (unsorted). */
export function filterTracks(tracks: readonly Track[], current: AppState): Track[] {
  const filter = current.filter;
  return tracks.filter((track) => {
    if (!matchesQuery(track, current.query)) return false;
    if (!filter) return true;
    if (filter.kind === "album") return track.album === filter.album && track.artist === filter.artist;
    return track.artist === filter.artist;
  });
}

/** Compare two tracks for the current sort order. */
export function compareTracks(a: Track, b: Track, sort: SortOrder): number {
  const direction = sort.dir === "asc" ? 1 : -1;
  switch (sort.key) {
    case "title":
      return a.title.localeCompare(b.title, undefined, { sensitivity: "base" }) * direction;
    case "artist":
      return a.artist.localeCompare(b.artist, undefined, { sensitivity: "base" }) * direction;
    case "album":
      return a.album.localeCompare(b.album, undefined, { sensitivity: "base" }) * direction;
    case "albumArtist":
      return (a.albumArtist ?? a.artist).localeCompare(b.albumArtist ?? b.artist, undefined, { sensitivity: "base" }) * direction;
    case "added":
      return ((a.addedAt ?? 0) - (b.addedAt ?? 0)) * direction;
    case "duration":
      return (a.duration - b.duration) * direction;
    case "year":
      return ((a.year ?? 0) - (b.year ?? 0)) * direction;
    default:
      return 0;
  }
}

/** The sorted + filtered track list for the current app state. */
export function visibleTracks(current: AppState = state): Track[] {
  return filterTracks(current.tracks, current).sort((a, b) => compareTracks(a, b, current.sort));
}

/* --------------------------------------------------------- grouping for UI */

export interface AlbumView {
  /** Stable key: album artist + album name. */
  id: string;
  album: string;
  artist: string;
  tracks: Track[];
  year?: number;
  coverId?: string;
  duration: number;
}

export interface ArtistView {
  id: string;
  artist: string;
  tracks: Track[];
  albumCount: number;
  coverId?: string;
  duration: number;
}

/** Group tracks into album cards. */
export function albumViews(tracks: readonly Track[]): AlbumView[] {
  const groups = new Map<string, AlbumView>();
  for (const track of tracks) {
    const artist = track.albumArtist ?? track.artist;
    const id = `${artist}\u0000${track.album}`;
    let group = groups.get(id);
    if (!group) {
      group = {
        id,
        album: track.album,
        artist,
        tracks: [],
        duration: 0,
        ...(track.year !== undefined ? { year: track.year } : {}),
        ...(track.coverId !== undefined ? { coverId: track.coverId } : {}),
      };
      groups.set(id, group);
    }
    group.tracks.push(track);
    group.duration += track.duration;
    if (group.coverId === undefined && track.coverId !== undefined) group.coverId = track.coverId;
    if (group.year === undefined && track.year !== undefined) group.year = track.year;
  }
  return [...groups.values()].sort((a, b) => a.album.localeCompare(b.album, undefined, { sensitivity: "base" }));
}

/** Group tracks into artist rows. */
export function artistViews(tracks: readonly Track[]): ArtistView[] {
  const groups = new Map<string, ArtistView>();
  for (const track of tracks) {
    const artist = track.artist;
    let group = groups.get(artist);
    if (!group) {
      group = {
        id: artist,
        artist,
        tracks: [],
        albumCount: 0,
        duration: 0,
        ...(track.coverId !== undefined ? { coverId: track.coverId } : {}),
      };
      groups.set(artist, group);
    }
    group.tracks.push(track);
    group.duration += track.duration;
    if (group.coverId === undefined && track.coverId !== undefined) group.coverId = track.coverId;
  }
  const albumsByArtist = new Map<string, Set<string>>();
  for (const track of tracks) {
    const set = albumsByArtist.get(track.artist) ?? new Set<string>();
    set.add(`${track.albumArtist ?? track.artist}\u0000${track.album}`);
    albumsByArtist.set(track.artist, set);
  }
  for (const group of groups.values()) group.albumCount = albumsByArtist.get(group.artist)?.size ?? 0;
  return [...groups.values()].sort((a, b) => a.artist.localeCompare(b.artist, undefined, { sensitivity: "base" }));
}

/** "1 hr 04 min" for view subtitles. */
export function describeDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0 min";
  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours} hr` : `${hours} hr ${String(minutes).padStart(2, "0")} min`;
}

/** "18 songs" / "1 song". */
export function describeCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/* ------------------------------------------------------ persistent store */

/**
 * Cover art cache.
 *
 * `bridge.library.cover()` is an async IPC round-trip (or a generated data URL
 * in the demo). Covers never change for a given id, so caching them for the
 * lifetime of the window is safe and keeps scrolling smooth.
 */
const coverCache = new Map<string, string | null>();

/** Resolve a `coverId` to an image URL, or null when the track has no art. */
export async function resolveCover(bridge: CadenzaBridge, coverId: string | undefined): Promise<string | null> {
  if (!coverId) return null;
  if (coverCache.has(coverId)) return coverCache.get(coverId) ?? null;
  try {
    const url = await bridge.library.cover(coverId);
    coverCache.set(coverId, url);
    return url;
  } catch (error) {
    console.warn(`Cadenza: could not load cover ${coverId}`, error);
    coverCache.set(coverId, null);
    return null;
  }
}

/* ---------------------------------------------------------------- playlists */

/** Store key for the user's playlists (shared with the settings store). */
export const PLAYLISTS_KEY = "playlists";

export function createPlaylist(name: string, trackIds: TrackId[] = []): SavedPlaylist {
  return {
    id: `playlist-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    trackIds: [...trackIds],
    createdAt: Date.now(),
  };
}

/** Read playlists defensively: the settings file is just JSON on disk. */
export function readPlaylists(store: KeyValueStore): SavedPlaylist[] {
  const raw: unknown = store.get<unknown>(PLAYLISTS_KEY, []);
  const list: unknown[] = Array.isArray(raw) ? raw : [];
  const playlists: SavedPlaylist[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const candidate = item as Partial<SavedPlaylist>;
    if (typeof candidate.id !== "string" || typeof candidate.name !== "string") continue;
    playlists.push({
      id: candidate.id,
      name: candidate.name,
      trackIds: Array.isArray(candidate.trackIds) ? candidate.trackIds.filter((id): id is string => typeof id === "string") : [],
      createdAt: typeof candidate.createdAt === "number" ? candidate.createdAt : Date.now(),
    });
  }
  return playlists;
}

/** Persist playlists and flush immediately (playlist edits are rare). */
export function writePlaylists(store: KeyValueStore, playlists: SavedPlaylist[]): void {
  store.set(PLAYLISTS_KEY, playlists);
  void store.flush();
}

/* ------------------------------------------------------ persistent store */

/**
 * A synchronous `KeyValueStore` for the core `Library`, backed by the main
 * process settings file.
 *
 * Why this shape: `KeyValueStore` is synchronous (core reads it during
 * construction), but the only persistent storage in Electron is async IPC.
 * So values are read once at boot into a `Map`, written synchronously there,
 * and pushed back to the host with a small debounce. The demo bridge backs
 * `settings.*` with localStorage, so the exact same code works in a browser.
 */
export class PersistentStore implements KeyValueStore {
  private readonly data = new Map<string, unknown>();
  private readonly dirty = new Set<string>();
  private timer: number | null = null;
  private closed = false;

  private constructor(private readonly bridge: CadenzaBridge, initial: Record<string, unknown>) {
    for (const [key, value] of Object.entries(initial)) this.data.set(key, value);
  }

  /** Read the current settings file and wrap it in a store. */
  static async open(bridge: CadenzaBridge): Promise<PersistentStore> {
    let existing: Record<string, unknown> = {};
    try {
      existing = await bridge.settings.all() as Record<string, unknown>;
    } catch (error) {
      console.warn("Cadenza: could not read persisted settings", error);
    }
    return new PersistentStore(bridge, existing);
  }

  get<T>(key: string, fallback: T): T {
    if (!this.data.has(key)) return fallback;
    return this.data.get(key) as T;
  }

  set<T>(key: string, value: T): void {
    this.data.set(key, value);
    this.markDirty(key);
  }

  delete(key: string): void {
    this.data.delete(key);
    this.markDirty(key);
  }

  /** Push pending writes now. Resolves once every write has been sent. */
  async flush(): Promise<void> {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.closed) return;
    const keys = [...this.dirty];
    this.dirty.clear();
    await Promise.all(
      keys.map(async (key) => {
        try {
          await this.bridge.settings.set(key, this.data.has(key) ? this.data.get(key) : null);
        } catch (error) {
          console.warn(`Cadenza: could not persist "${key}"`, error);
          this.dirty.add(key);
        }
      }),
    );
  }

  /** Stop the debounce timer (the app calls `flush()` first). */
  close(): void {
    this.closed = true;
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private markDirty(key: string): void {
    this.dirty.add(key);
    if (this.closed) return;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, 400);
  }
}
